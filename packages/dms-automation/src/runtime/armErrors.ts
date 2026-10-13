import { GetModel } from "@antelopejs/interface-database-decorators";
import { ProcedureModel } from "../db/models/procedure.model";
import type { Procedure } from "../db/tables/procedure.table";
import { DATABASE_NAME } from "../types/constants";
import type { ProcedureGraph } from "../types/graph";
import type { ConfigProblem } from "./validate";

/**
 * Why a trigger of an enabled procedure could not be armed: a code the UI
 * translates (`dms_automation.editor.problems.codes.<code>`) with its params,
 * and the English message the log carries.
 */
export type ArmError = ConfigProblem;

/** A refusal to arm a trigger, worded like a graph problem. */
export class TriggerArmError extends Error {
  readonly problem: ArmError;

  constructor(problem: ArmError) {
    super(problem.message);
    this.problem = problem;
  }
}

/** What an activation failure says, whatever threw it. */
export function armErrorFrom(err: unknown): ArmError {
  if (err instanceof TriggerArmError) return err.problem;
  const error = err instanceof Error ? err.message : String(err);
  return { code: "armFailed", params: { error }, message: error };
}

/** The arm errors stored on a procedure, by trigger node id. */
function readArmErrors(procedure: Procedure): Record<string, ArmError> {
  if (!procedure.armErrors) return {};
  try {
    return JSON.parse(procedure.armErrors) as Record<string, ArmError>;
  } catch {
    return {};
  }
}

/** A trigger this instance arms, keyed like the subscriptions keep it. */
export interface ArmedTrigger {
  procedure: Procedure;
  graph: ProcedureGraph;
  nodeId: string;
}

/**
 * Write on each procedure why its triggers failed to arm on this instance
 * (`errors`, by trigger key), when that changed. Only the triggers this
 * instance arms (`armed`) are rewritten: a follower leaves the leader's
 * word on a singleton trigger alone. Entries for removed triggers go.
 */
export async function storeArmErrors(
  armed: ReadonlyMap<string, ArmedTrigger>,
  errors: ReadonlyMap<string, ArmError>,
): Promise<void> {
  const byProcedure = new Map<string, [string, ArmedTrigger][]>();
  for (const entry of armed) {
    const id = entry[1].procedure._id;
    byProcedure.set(id, [...(byProcedure.get(id) ?? []), entry]);
  }
  const model = GetModel(ProcedureModel, DATABASE_NAME);
  for (const [id, entries] of byProcedure) {
    const [, first] = entries[0] ?? [];
    if (!first) continue;
    const triggers = new Set(
      first.graph.nodes.filter((n) => n.kind === "trigger").map((n) => n.id),
    );
    const next: Record<string, ArmError> = {};
    for (const [nodeId, error] of Object.entries(
      readArmErrors(first.procedure),
    )) {
      if (triggers.has(nodeId)) next[nodeId] = error;
    }
    for (const [key, { nodeId }] of entries) {
      const error = errors.get(key);
      if (error) next[nodeId] = error;
      else delete next[nodeId];
    }
    const stored = Object.keys(next).length > 0 ? JSON.stringify(next) : "";
    if (stored !== (first.procedure.armErrors ?? "")) {
      await model.update(id, { armErrors: stored });
    }
  }
}

/**
 * Why a trigger of an enabled procedure is not armed, or undefined when all
 * of them are (or the procedure is paused: nothing has to be armed). Read
 * from the procedure, so every instance of a cluster tells the same.
 */
export function armErrorOf(procedure: Procedure): ArmError | undefined {
  if (!procedure.enabled) return undefined;
  return Object.values(readArmErrors(procedure))[0];
}
