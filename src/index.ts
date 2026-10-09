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
  ICOVBindingResolution,
  AnalysisExecutionResult,
  ExecutionMetadata,
  AnalysisAssignmentModel,
} from 'spinal-model-analysis';
import { CronJob } from 'cron';
import { performance } from 'perf_hooks';
import { covBindingKey, modelSnapshot, planCOVRefresh } from './covBindings';

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
  /** The analysis's COV triggers; its binds are re-synced with its work nodes on every sync. */
  covTriggers: IResolvedTrigger[];
  /** Work nodes already reported as not bindable, so a retry each sync doesn't repeat the warning. */
  warnedSkips: Set<string>;
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
        // server_id is stable per-node across processes in modern BOS — the key assignment
        // uses (matches what the api-server/front send) and our internal handledAnalytics key.
        const id = String(analysisNode._server_id);

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
            continue;
          }
          // Same definition, but its work nodes may have changed (e.g. tickets created or
          // deleted since): bind the new ones, unbind the removed ones.
          await this.refreshCOVBindings(analysisNode, handle);
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
    const id = String(analysisNode._server_id);
    const name = analysisNode.getName().get();
    console.log(`[Organ] Setting up analysis: ${name} (${id})`);

    const handle: AnalyticHandle = {
      intervals: [],
      cronJobs: [],
      bindings: [],
      covTriggers: [],
      warnedSkips: new Set(),
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
          this.registerCOVTrigger(analysisNode, trigger, handle);
          break;
        default:
          console.warn(`[Organ] Unknown trigger type: ${(trigger as any).type}`);
      }
    }

    // Bind every COV trigger on the current work nodes (later syncs keep these binds up to date).
    await this.refreshCOVBindings(analysisNode, handle);
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

  private registerCOVTrigger(
    analysisNode: SpinalNode<any>,
    trigger: IResolvedTrigger,
    handle: AnalyticHandle
  ): void {
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
    handle.covTriggers.push(trigger);
  }

  /**
   * Brings an analysis's COV binds in line with its CURRENT work nodes. Runs at setup and on every
   * sync, so a work node that appears later (e.g. a ticket created after the organ started) is
   * bound within one poll interval, and one that disappears (a deleted ticket) is unbound. Only the
   * work nodes missing a bind run the input workflow. If the work nodes can't be resolved, the
   * existing binds are kept as they are.
   */
  private async refreshCOVBindings(analysisNode: SpinalNode<any>, handle: AnalyticHandle): Promise<void> {
    if (handle.covTriggers.length === 0) return;
    const name = analysisNode.getName().get();

    let workNodes: SpinalNode<any>[];
    try {
      workNodes = await spinalAnalysisTriggerService.resolveCOVWorkNodes(analysisNode);
    } catch (e: any) {
      console.error(`[Organ] COV work-node resolution failed for ${name}: ${e.message}. Keeping the current binds.`);
      return;
    }

    const { keep, drop, toBind } = planCOVRefresh(handle.bindings, workNodes, handle.covTriggers);
    for (const binding of drop) binding.model.unbind(binding.bindProcess);
    handle.bindings = keep;

    let added = 0;
    if (toBind.length > 0) {
      let resolution: ICOVBindingResolution;
      try {
        resolution = await spinalAnalysisTriggerService.resolveCOVBindings(analysisNode, toBind);
      } catch (e: any) {
        console.error(`[Organ] COV binding resolution failed for ${name}: ${e.message}`);
        resolution = { bindings: [], skipped: [] };
      }

      const bound = new Set(
        handle.bindings.map((b) => covBindingKey(b.workNode, { id: b.triggerId, inputRegister: b.inputRegister }))
      );
      for (const binding of resolution.bindings) {
        const trigger = handle.covTriggers.find(
          (t) => t.id === binding.triggerId && t.inputRegister === binding.inputRegister
        );
        if (!trigger) continue;
        const key = covBindingKey(binding.workNode, trigger);
        if (bound.has(key)) continue;
        if (this.bindCOV(analysisNode, trigger, binding, handle)) {
          bound.add(key);
          added++;
        }
      }
      for (const skip of resolution.skipped) {
        this.warnOnce(
          handle,
          `${skip.workNode.getId().get()}|${skip.triggerId ?? ''}|${skip.inputRegister ?? ''}|${skip.reason}`,
          `[Organ] "${name}": not binding "${skip.workNode.getName().get()}" yet — ${skip.reason}. Retried on every sync.`
        );
      }
    }

    if (added > 0 || drop.length > 0) {
      console.log(`[Organ] "${name}": COV binds +${added} / -${drop.length} → ${handle.bindings.length} active`);
    }
  }

  /** Binds one work node's model for one COV trigger. Returns false if the model can't be bound. */
  private bindCOV(
    analysisNode: SpinalNode<any>,
    trigger: IResolvedTrigger,
    binding: ICOVBindingResult,
    handle: AnalyticHandle
  ): boolean {
    const registerName = trigger.inputRegister!;
    const model = binding.model as Model;
    if (!model || typeof model.bind !== 'function') {
      this.warnOnce(
        handle,
        `${binding.workNode.getId().get()}|${trigger.id ?? ''}|${registerName}|not bindable`,
        `[Organ] COV model for register "${registerName}" on "${binding.workNode.getName().get()}" is not bindable. Skipping.`
      );
      return false;
    }

    // Compared by content: an attribute model's get() returns a new object on every call.
    let previousValue: unknown = modelSnapshot(model);

    const bindProcess = model.bind(() => {
      const currentValue = modelSnapshot(model);

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
    return true;
  }

  private warnOnce(handle: AnalyticHandle, key: string, message: string): void {
    if (handle.warnedSkips.has(key)) return;
    handle.warnedSkips.add(key);
    console.warn(message);
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
  // Two syncs running at once would both set up a new analysis, and the first
  // setup's intervals and binds would keep running alongside the second's. A sync
  // can outlast the interval: a large graph, or loads waiting for the hub to come back.
  let syncing = false;
  setInterval(async () => {
    if (syncing) return;
    syncing = true;
    try {
      await organ.syncAnalytics();
    } catch (e: any) {
      console.error(`[Organ] Sync error: ${e.message}`);
    } finally {
      syncing = false;
    }
  }, pollInterval);
}

main().catch((e) => {
  console.error('[Organ] Fatal error:', e);
  process.exit(1);
});
