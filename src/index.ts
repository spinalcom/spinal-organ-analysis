import ConfigFile from 'spinal-lib-organ-monitoring';
import {
  Process,
  spinalCore,
  FileSystem,
  Model,
} from 'spinal-core-connectorjs_type';
import {
  SpinalGraphService,
  SpinalNode,
  SpinalGraph,
} from 'spinal-env-viewer-graph-service';
import {
  spinalAnalyticNodeManagerService,
  spinalAnalysisExecutionService,
  spinalAnalysisTriggerService,
  TRIGGER_TYPE,
  loadOrCreateAssignmentFile,
  readAssignment,
} from 'spinal-model-analysis';
import type {
  IResolvedTrigger,
  ICOVBindingResult,
  AnalysisExecutionResult,
  ExecutionMetadata,
  AnalysisAssignmentModel,
} from 'spinal-model-analysis';
import { CronJob } from 'cron';
import { performance } from 'perf_hooks';

require('dotenv').config();

// ─────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────

interface COVBinding {
  triggerId?: string;
  inputRegister: string;
  workNode: SpinalNode<any>;
  model: Model;
  bindProcess: Process;
  threshold?: number;
  previousValue: unknown;
}

interface AnalyticHandle {
  intervals: NodeJS.Timeout[];
  cronJobs: CronJob[];
  bindings: COVBinding[];
  /** lastUpdate revision the analysis was set up with; used to detect config changes. */
  revision: number;
}

type HandledAnalytics = Map<string, AnalyticHandle>;

// ─────────────────────────────────────────────────────────
//  CONNECTION ERROR HANDLER
// ─────────────────────────────────────────────────────────

//@ts-ignore
FileSystem.onConnectionError = (error_code: number) => {
  console.error(`[Organ] Connection error (code: ${error_code}). Exiting.`);
  process.exit(error_code);
};

// ─────────────────────────────────────────────────────────
//  MAIN CLASS
// ─────────────────────────────────────────────────────────

class SpinalOrganAnalysis {
  private handledAnalytics: HandledAnalytics = new Map();
  private graph!: SpinalGraph<any>;

  /** This organ's name = key of its assignment file in the hub (/etc/Organs/Analysis/<name>). */
  private readonly organName: string = process.env.ORGAN_NAME ?? 'spinal-organ-analysis';
  /**
   * Live assignment record for this organ, or null if it couldn't be loaded (in which case
   * the organ falls back to running everything). When the record's `enabled` is false, the
   * organ also runs everything — assignment is fully opt-in.
   */
  private assignment: AnalysisAssignmentModel | null = null;

  // ─── INITIALIZATION ──────────────────────────────────

  public async init(): Promise<void> {
    console.log('[Organ] Connecting to hub...');
    const host = process.env.SPINALHUB_PORT
      ? `${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}`
      : process.env.SPINALHUB_IP;
    const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${host}/`;
    const conn = spinalCore.connect(url);

    ConfigFile.init(
      conn,
      process.env.ORGAN_NAME ?? 'spinal-organ-analysis',
      process.env.ORGAN_TYPE ?? 'analysis',
      process.env.SPINALHUB_IP!,
      parseInt(process.env.SPINALHUB_PORT ?? '7777')
    );

    this.graph = await new Promise<SpinalGraph<any>>((resolve, reject) => {
      spinalCore.load(
        conn,
        process.env.DIGITALTWIN_PATH ?? '/__users__/admin/Digital twin',
        (graph: any) => resolve(graph),
        () => {
          console.error('[Organ] Failed to load graph. Check config.');
          reject(new Error('Graph load failed'));
        }
      );
    });

    await SpinalGraphService.setGraph(this.graph);
    console.log('[Organ] Graph loaded.');

    // Load (or create) this organ's assignment file. Absent/disabled → run everything.
    try {
      this.assignment = await loadOrCreateAssignmentFile(this.organName, conn);
      const state = readAssignment(this.assignment);
      console.log(
        `[Organ] Assignment ready for "${this.organName}": ` +
        (state.enabled
          ? `ASSIGNED mode — ${state.analytics.length} analytic(s) assigned.`
          : 'run-all mode (assignment disabled).')
      );
    } catch (e: any) {
      console.error(
        `[Organ] Could not load assignment file for "${this.organName}"; running in run-all mode. ${e?.message ?? e}`
      );
      this.assignment = null;
    }
  }

  // ─── POLLING LOOP ─────────────────────────────────────

  /**
   * Scans all analysis contexts and sets up triggers for new/active analyses.
   * Clears triggers for analyses that have been removed or deactivated.
   *
   * Only analyses whose lifecycle status is "Active" are started/bound. Analyses
   * that are "Inactive" (the default) are left parked — present in the database
   * but not running. Flipping the status attribute takes effect on the next sync.
   */
  public async syncAnalytics(): Promise<void> {
    const contexts = await spinalAnalyticNodeManagerService.getContexts(this.graph);
    // Tracks analyses that should currently be running (exist AND status=Active AND assigned).
    const runningIds = new Set<string>();

    // Read the assignment record fresh each sync so api-server changes (enable/disable, add/
    // remove) take effect on the next poll without a restart. Disabled or unloaded → run all.
    const assignment = readAssignment(this.assignment);
    const assignedSet = new Set(assignment.analytics);
    if (assignment.enabled) {
      console.log(
        `[Organ] Assignment mode ON — will handle ${assignedSet.size} assigned Active analytic(s).`
      );
    }

    for (const context of contexts) {
      const analysisNodes = await spinalAnalyticNodeManagerService.getAnalysisNodesByContextNode(context);

      for (const analysisNode of analysisNodes) {
        const id = analysisNode.getId().get();

        // Gate on lifecycle status — only run Active analyses.
        const isActive = await spinalAnalyticNodeManagerService.isAnalysisActive(analysisNode);
        if (!isActive) continue; // Inactive → leave parked (cleanup below stops it if it was running)

        // Assignment gate (opt-in load splitting): when enabled, only handle assigned analyses.
        // Not added to runningIds when skipped, so the cleanup pass stops it if it was running
        // here before being reassigned to another organ.
        if (assignment.enabled && !assignedSet.has(id)) continue;

        runningIds.add(id);

        const revision = spinalAnalyticNodeManagerService.getLastUpdate(analysisNode);
        const handle = this.handledAnalytics.get(id);

        if (handle) {
          // Already running — re-setup only if the analysis was updated since.
          if (handle.revision !== revision) {
            console.log(
              `[Organ] Analysis "${analysisNode.getName().get()}" (${id}) changed ` +
              `(rev ${handle.revision} → ${revision}). Re-assessing.`
            );
            this.clearAnalytic(id);
            await this.setupAnalysis(analysisNode, revision);
          }
          continue;
        }

        await this.setupAnalysis(analysisNode, revision);
      }
    }

    // Cleanup: stop analyses no longer running — either removed from the graph
    // or deactivated (status flipped to Inactive).
    for (const [id] of this.handledAnalytics) {
      if (!runningIds.has(id)) {
        console.log(`[Organ] Analysis ${id} removed or deactivated. Clearing triggers.`);
        this.clearAnalytic(id);
      }
    }
  }

  // ─── ANALYSIS SETUP ───────────────────────────────────

  private async setupAnalysis(analysisNode: SpinalNode<any>, revision: number = 0): Promise<void> {
    const id = analysisNode.getId().get();
    const name = analysisNode.getName().get();
    console.log(`[Organ] Setting up analysis: ${name} (${id})`);

    const handle: AnalyticHandle = {
      intervals: [],
      cronJobs: [],
      bindings: [],
      revision,
    };
    this.handledAnalytics.set(id, handle);

    let triggers: IResolvedTrigger[];
    try {
      triggers = await spinalAnalysisTriggerService.getTriggerConfig(analysisNode);
    } catch (e: any) {
      console.error(`[Organ] Failed to load triggers for ${name}: ${e.message}`);
      return;
    }

    if (triggers.length === 0) {
      console.log(`[Organ] No triggers configured for ${name}. Skipping.`);
      return;
    }

    for (const trigger of triggers) {
      switch (trigger.type) {
        case TRIGGER_TYPE.INTERVAL_TIME:
          this.setupIntervalTrigger(analysisNode, trigger, handle);
          break;
        case TRIGGER_TYPE.CRON:
          this.setupCronTrigger(analysisNode, trigger, handle);
          break;
        case TRIGGER_TYPE.COV:
          await this.setupCOVTrigger(analysisNode, trigger, handle);
          break;
        default:
          console.warn(`[Organ] Unknown trigger type: ${(trigger as any).type}`);
      }
    }
  }

  // ─── INTERVAL TRIGGER ─────────────────────────────────

  private setupIntervalTrigger(
    analysisNode: SpinalNode<any>,
    trigger: IResolvedTrigger,
    handle: AnalyticHandle
  ): void {
    const ms = trigger.intervalTimeMs;
    if (!ms || ms <= 0) {
      console.warn(`[Organ] Invalid interval for ${analysisNode.getName().get()}`);
      return;
    }
    console.log(`[Organ]   → Interval trigger: ${ms}ms${trigger.id ? ` (${trigger.id})` : ''}`);

    const interval = setInterval(() => {
      this.executeAnalysis(analysisNode, {
        referenceTime: Date.now(),
        trigger: {
          id: trigger.id,
          type: TRIGGER_TYPE.INTERVAL_TIME,
        },
      });
    }, ms);

    handle.intervals.push(interval);
  }

  // ─── CRON TRIGGER ─────────────────────────────────────

  private setupCronTrigger(
    analysisNode: SpinalNode<any>,
    trigger: IResolvedTrigger,
    handle: AnalyticHandle
  ): void {
    const expression = trigger.cronExpression;
    if (!expression) {
      console.warn(`[Organ] Invalid cron expression for ${analysisNode.getName().get()}`);
      return;
    }
    console.log(`[Organ]   → Cron trigger: "${expression}"${trigger.id ? ` (${trigger.id})` : ''}`);

    const cronJob = new CronJob(expression, () => {
      this.executeAnalysis(analysisNode, {
        referenceTime: Date.now(),
        trigger: {
          id: trigger.id,
          type: TRIGGER_TYPE.CRON,
        },
      });
    });
    cronJob.start();
    handle.cronJobs.push(cronJob);
  }

  // ─── COV TRIGGER ──────────────────────────────────────

  private async setupCOVTrigger(
    analysisNode: SpinalNode<any>,
    trigger: IResolvedTrigger,
    handle: AnalyticHandle
  ): Promise<void> {
    const registerName = trigger.inputRegister;
    if (!registerName) {
      console.warn(`[Organ] COV trigger missing inputRegister for ${analysisNode.getName().get()}`);
      return;
    }
    console.log(
      `[Organ]   → COV trigger on register "${registerName}"` +
      (trigger.threshold !== undefined ? ` (threshold: ${trigger.threshold})` : '') +
      (trigger.id ? ` (${trigger.id})` : '')
    );

    let bindings: ICOVBindingResult[];
    try {
      bindings = await spinalAnalysisTriggerService.resolveInputRegistersForBinding(analysisNode);
    } catch (e: any) {
      console.error(`[Organ] COV resolution failed for ${analysisNode.getName().get()}: ${e.message}`);
      return;
    }

    // Filter only bindings matching this trigger's register
    const matchingBindings = bindings.filter((b) => b.inputRegister === registerName);

    for (const binding of matchingBindings) {
      const model = binding.model as Model;
      if (!model || typeof model.bind !== 'function') {
        console.warn(`[Organ] COV model for register "${registerName}" is not bindable. Skipping.`);
        continue;
      }

      let previousValue: unknown = typeof model.get === 'function' ? model.get() : undefined;

      const bindProcess = model.bind(() => {
        const currentValue = typeof model.get === 'function' ? model.get() : undefined;

        // Threshold check
        if (trigger.threshold !== undefined) {
          const prev = Number(previousValue);
          const curr = Number(currentValue);
          if (!isNaN(prev) && !isNaN(curr) && Math.abs(curr - prev) <= trigger.threshold) {
            return; // Change below threshold, skip
          }
        }

        // Skip if value unchanged
        if (currentValue === previousValue) return;

        previousValue = currentValue;
        // COV fires per bound model, so only run the work node that owns it —
        // not the whole analysis (which would re-run every work node).
        this.executeAnalysisForWorkNode(analysisNode, binding.workNode, {
          referenceTime: Date.now(),
          trigger: {
            id: trigger.id,
            type: TRIGGER_TYPE.COV,
            inputRegister: registerName,
            threshold: trigger.threshold,
          },
        });
      }, false);

      handle.bindings.push({
        triggerId: trigger.id,
        inputRegister: registerName,
        workNode: binding.workNode,
        model,
        bindProcess,
        threshold: trigger.threshold,
        previousValue,
      });
    }
  }

  // ─── EXECUTION ────────────────────────────────────────

  private async executeAnalysis(
    analysisNode: SpinalNode<any>,
    metadata: ExecutionMetadata
  ): Promise<void> {
    const name = analysisNode.getName().get();
    const startTime = performance.now();

    try {
      const result: AnalysisExecutionResult =
        await spinalAnalysisExecutionService.executeAnalysis(analysisNode, metadata);

      const elapsed = (performance.now() - startTime).toFixed(2);
      const succeeded = result.results.filter((r) => r.success).length;
      console.log(
        `[Organ] Analysis "${name}" complete: ${succeeded}/${result.totalWorkNodes} succeeded (${elapsed}ms)`
      );

      // Log failures
      for (const r of result.results) {
        if (!r.success) {
          console.error(`[Organ]   ✗ ${r.workNodeName}: ${r.error}`);
        }
      }
    } catch (e: any) {
      const elapsed = (performance.now() - startTime).toFixed(2);
      console.error(`[Organ] Analysis "${name}" failed after ${elapsed}ms: ${e.message}`);
    }
  }

  /**
   * Runs the analysis pipeline for a single work node (used by COV triggers,
   * which fire per bound model rather than for the whole analysis).
   */
  private async executeAnalysisForWorkNode(
    analysisNode: SpinalNode<any>,
    workNode: SpinalNode<any>,
    metadata: ExecutionMetadata
  ): Promise<void> {
    const name = analysisNode.getName().get();
    const workNodeName = workNode.getName().get();
    const startTime = performance.now();

    try {
      const result: AnalysisExecutionResult =
        await spinalAnalysisExecutionService.executeAnalysisForWorkNode(
          analysisNode,
          workNode,
          metadata
        );

      const elapsed = (performance.now() - startTime).toFixed(2);
      const r = result.results[0];
      if (r?.success) {
        console.log(
          `[Organ] Analysis "${name}" on "${workNodeName}" complete (${elapsed}ms)`
        );
      } else {
        console.error(
          `[Organ] Analysis "${name}" on "${workNodeName}" failed (${elapsed}ms): ${r?.error}`
        );
      }
    } catch (e: any) {
      const elapsed = (performance.now() - startTime).toFixed(2);
      console.error(
        `[Organ] Analysis "${name}" on "${workNodeName}" failed after ${elapsed}ms: ${e.message}`
      );
    }
  }

  // ─── CLEANUP ──────────────────────────────────────────

  private clearAnalytic(id: string): void {
    const handle = this.handledAnalytics.get(id);
    if (!handle) return;

    for (const interval of handle.intervals) clearInterval(interval);
    for (const cronJob of handle.cronJobs) cronJob.stop();
    for (const binding of handle.bindings) {
      binding.model.unbind(binding.bindProcess);
    }

    this.handledAnalytics.delete(id);
  }
}

// ─────────────────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────────────────

async function main() {
  const organ = new SpinalOrganAnalysis();
  await organ.init();
  await organ.syncAnalytics();

  // Periodically re-sync to pick up new/removed analyses
  const pollInterval = parseInt(process.env.UPDATE_ANALYTIC_QUEUE_TIMER ?? '30000');
  setInterval(async () => {
    try {
      await organ.syncAnalytics();
    } catch (e: any) {
      console.error(`[Organ] Sync error: ${e.message}`);
    }
  }, pollInterval);
}

main().catch((e) => {
  console.error('[Organ] Fatal error:', e);
  process.exit(1);
});
