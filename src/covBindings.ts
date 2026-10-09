import type { SpinalNode } from 'spinal-env-viewer-graph-service';

/**
 * Bookkeeping for COV binds, kept free of side effects so it can be checked on its own.
 *
 * An analysis's work nodes change while the organ runs — e.g. tickets are created and deleted —
 * so its binds are not set up once: each sync compares them with the CURRENT work nodes.
 */

/** The part of a trigger that identifies what a bind watches. */
export interface CovTriggerRef {
  id?: string;
  inputRegister?: string;
}

/** The part of a bind that identifies it. */
export interface CovBindingRef {
  workNode: SpinalNode<any>;
  triggerId?: string;
  inputRegister: string;
}

/** One bind = one work node watched by one COV trigger. */
export function covBindingKey(workNode: SpinalNode<any>, trigger: CovTriggerRef): string {
  return `${workNode.getId().get()}|${trigger.id ?? ''}|${trigger.inputRegister ?? ''}`;
}

/**
 * Compares the binds an analysis holds with its current work nodes:
 * - `drop`: binds whose work node is gone (e.g. a deleted ticket) — to unbind;
 * - `keep`: the other binds;
 * - `toBind`: work nodes still missing a bind for at least one COV trigger — new since the last
 *   pass (e.g. a ticket created after the organ started), or not bindable yet last time.
 */
export function planCOVRefresh<B extends CovBindingRef>(
  bindings: B[],
  workNodes: SpinalNode<any>[],
  covTriggers: CovTriggerRef[]
): { keep: B[]; drop: B[]; toBind: SpinalNode<any>[] } {
  const current = new Map<string, SpinalNode<any>>();
  for (const node of workNodes) current.set(node.getId().get(), node);

  const keep: B[] = [];
  const drop: B[] = [];
  for (const binding of bindings) {
    (current.has(binding.workNode.getId().get()) ? keep : drop).push(binding);
  }

  const bound = new Set(
    keep.map((b) => covBindingKey(b.workNode, { id: b.triggerId, inputRegister: b.inputRegister }))
  );
  const toBind = [...current.values()].filter((node) =>
    covTriggers.some((trigger) => !bound.has(covBindingKey(node, trigger)))
  );
  return { keep, drop, toBind };
}

/**
 * The value a bind compares to decide whether its model really changed. A model with children
 * (e.g. a SpinalAttribute) returns a NEW object from get() each time, so comparing those by
 * reference would treat every notification as a change; their content is compared instead.
 */
export function modelSnapshot(model: { get?: () => unknown }): unknown {
  const value = typeof model.get === 'function' ? model.get() : undefined;
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return value;
  }
}
