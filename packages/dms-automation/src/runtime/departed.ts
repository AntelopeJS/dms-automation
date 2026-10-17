import { MODULE_CONTEXT_INVALIDATED_CODE } from "@antelopejs/interface-core";
import type { GraphNode } from "../types/graph";
import { registry } from "./registry";

/**
 * A module the automation relies on went away: a module stopping, or a hot
 * reload replacing it. The core invalidates its context, so its trigger, action
 * and data node types can no longer run, and the work it started stops with a
 * `ModuleContextInvalidatedError`.
 */

// How deep a wrapped error is searched for its cause.
const MAX_CAUSES = 8;

/** Whether `err`, or an error it wraps, is a departed module's. */
export function isModuleGone(err: unknown): boolean {
  let current = err;
  for (let depth = 0; current && depth < MAX_CAUSES; depth++) {
    // The code, not the class: the module that threw may hold its own copy of
    // interface-core.
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === MODULE_CONTEXT_INVALIDATED_CODE) return true;
    current = cause;
  }
  return false;
}

/**
 * Why a run stopped short without failing: a step it reached belongs to a
 * module that went away while it ran. The run is stored as `cancelled`.
 */
export class RunCancelledError extends Error {
  override name = "RunCancelledError";
}

/**
 * Why `node` cannot go on when a module it relies on went away during the
 * run: its type (or a data node it reads) ran in a module whose context is
 * now invalid, or was unregistered after `typesMark` (the registry's
 * `removalMark()` when the run started). Undefined for any other failure.
 */
export function departure(
  err: unknown,
  node: GraphNode,
  typesMark: number,
): RunCancelledError | undefined {
  if (err instanceof RunCancelledError) return err;
  const step = node.typeId ?? node.kind;
  if (isModuleGone(err)) {
    return new RunCancelledError(
      `the module behind "${step}" was unloaded while the run was on`,
      { cause: err },
    );
  }
  if (
    node.kind === "action" &&
    node.typeId &&
    !registry.getAction(node.typeId) &&
    registry.removedSince("action", node.typeId, typesMark)
  ) {
    return new RunCancelledError(
      `"${step}" was unregistered while the run was on`,
      { cause: err },
    );
  }
  return undefined;
}
