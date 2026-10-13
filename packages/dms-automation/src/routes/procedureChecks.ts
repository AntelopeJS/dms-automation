import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { ProcedureModel } from "../db/models/procedure.model";
import type { Procedure } from "../db/tables/procedure.table";
import {
  type GraphIssue,
  graphIssues,
  hasBlockingIssue,
} from "../runtime/graphIssues";
import { subscriptions } from "../runtime/subscriptions";
import { webhookConflicts } from "../runtime/webhookRoutes";
import { DATABASE_NAME } from "../types/constants";
import type { ProcedureGraph } from "../types/graph";
import { API_MESSAGES as API, invalid } from "./requests";

/** What the procedures routes check before they save or run a graph. */

// The toast of a refused graph, after its first blocking issue.
const REFUSAL_OF_ISSUE: Record<string, string> = {
  noTrigger: `${API}.noTrigger`,
  webhookPathTaken: `${API}.webhookPathTaken`,
};

export function graphRefusal(issues: GraphIssue[]): HTTPResult {
  const first = issues.find((i) => i.severity === "error");
  const message =
    REFUSAL_OF_ISSUE[first?.code ?? ""] ?? `${API}.graphHasErrors`;
  return invalid("invalid graph", issues, message);
}

/** The problems of a graph, the templates it references checked. */
export function issuesOf(
  graph: ProcedureGraph,
  enabling: boolean,
): GraphIssue[] {
  return graphIssues(graph, {
    enabling,
    templates: { has: (id) => subscriptions.hasTemplate(id) },
  });
}

const normalName = (name: string) => name.trim().toLowerCase();

/**
 * Whether another procedure already has this name: allowed, but two
 * procedures of one name are easy to mix up in the lists and the history.
 */
export async function isNameTaken(
  name: string,
  procedureId?: string,
): Promise<boolean> {
  const all = await GetModel(ProcedureModel, DATABASE_NAME).getAll();
  return all.some(
    (p) => p._id !== procedureId && normalName(p.name) === normalName(name),
  );
}

function nameTakenIssue(name: string): GraphIssue {
  return {
    severity: "warning",
    code: "nameTaken",
    params: { name },
    message: `another procedure is already named "${name}"`,
  };
}

/** Where a graph is saved: its procedure, and the name it is saved under. */
export interface SaveTarget {
  procedureId?: string;
  name?: string;
}

/**
 * The problems of a graph saved for a procedure: its own, a webhook route
 * another enabled procedure answers on (blocking for an enabled one, a
 * warning on a draft) and a name another procedure has (a warning).
 */
export async function saveIssues(
  graph: ProcedureGraph,
  enabled: boolean,
  { procedureId, name }: SaveTarget = {},
): Promise<GraphIssue[]> {
  const issues = issuesOf(graph, enabled);
  const severity = enabled ? "error" : "warning";
  issues.push(...(await webhookConflicts(graph, procedureId, severity)));
  if (name !== undefined && (await isNameTaken(name, procedureId))) {
    issues.push(nameTakenIssue(name));
  }
  return issues;
}

/**
 * The problems of a graph about to be saved, refused when it is enabled with
 * an error: enabling it would arm triggers on a graph the executor refuses,
 * or that never fires. A draft is saved with its problems, which the builder
 * lists.
 */
export async function checkSavable(
  graph: ProcedureGraph,
  enabled: boolean,
  target: SaveTarget = {},
): Promise<GraphIssue[]> {
  const issues = await saveIssues(graph, enabled, target);
  if (enabled && hasBlockingIssue(issues)) throw graphRefusal(issues);
  return issues;
}

/** The warning a new procedure is created with when its name is taken. */
export async function nameWarning(name: string): Promise<{ warning?: string }> {
  return (await isNameTaken(name)) ? { warning: `${API}.nameTaken` } : {};
}

/** The revision and version a save was made on, when the builder says. */
export interface SaveExpectation {
  expectedRevision?: number;
  expectedVersion?: number;
}

/** Whether a save was made on what is no longer the current procedure. */
export function isStale(
  procedure: Procedure,
  { expectedRevision, expectedVersion }: SaveExpectation,
): boolean {
  return (
    (expectedRevision !== undefined &&
      expectedRevision !== procedure.revision) ||
    (expectedVersion !== undefined && expectedVersion !== procedure.version)
  );
}

/**
 * The 409 of a save made on a revision (or, the older form, a version) that
 * is no longer the current one, with the current ones to reload or
 * overwrite with. `current` is the revision, or the version when the save
 * named only a version.
 */
export function stale(
  procedure: Procedure,
  { expectedRevision }: SaveExpectation,
): HTTPResult {
  const { revision, version } = procedure;
  return new HTTPResult(409, {
    error: "stale",
    message: `${API}.stale`,
    current: expectedRevision === undefined ? version : revision,
    revision,
    version,
  });
}
