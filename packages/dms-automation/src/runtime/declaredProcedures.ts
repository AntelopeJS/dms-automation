import { createHash } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  DeclaredProcedure,
  DeclaredProcedureStatus,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import type { Procedure } from "../db/tables/procedure.table";
import { PROCEDURES_TOPIC, notifyTopic } from "../realtime";
import { saveIssues } from "../routes/procedureChecks";
import { exportedSchema } from "../routes/procedureSchemas";
import { DATABASE_NAME } from "../types/constants";
import type { ProcedureGraph } from "../types/graph";
import { type GraphIssue, hasBlockingIssue } from "./graphIssues";
import { changesExecution } from "./graphVersion";
import { subscriptions } from "./subscriptions";

/**
 * Procedures a module ships as code (DeclareProcedure). The declared id is
 * the procedure's id; `declaredHash` remembers what was declared last, so a
 * procedure is refreshed only while it still is exactly that, and kept as is
 * once anyone changed it.
 */

const DECLARED_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ID_LENGTH = 120;

/** What "Import JSON" accepts, plus the caller's key and the enabled flag. */
const declarationSchema = exportedSchema.extend({
  id: z
    .string()
    .max(MAX_ID_LENGTH)
    .regex(DECLARED_ID, "letters, digits, '.', '_' and '-' only"),
  enabled: z.boolean(),
});

/** The fields a declaration sets, as they are stored. */
interface DeclaredContent {
  name: string;
  description: string;
  graph: string;
  enabled: boolean;
}

function hashOf(content: DeclaredContent): string {
  const { name, description, graph, enabled } = content;
  return createHash("sha256")
    .update(JSON.stringify([name, description, graph, enabled]))
    .digest("hex");
}

function storedContentOf(procedure: Procedure): DeclaredContent {
  return {
    name: procedure.name,
    description: procedure.description ?? "",
    graph: procedure.graph,
    enabled: procedure.enabled,
  };
}

/** Whether the procedure still is what was declared last. */
function isAsDeclared(procedure: Procedure): boolean {
  return (
    procedure.declaredHash !== undefined &&
    procedure.declaredHash === hashOf(storedContentOf(procedure))
  );
}

function refusal(id: string, problems: string[]): Error {
  return new Error(
    `[dms-automation] DeclareProcedure("${id}") refused: ${problems.join("; ")}`,
  );
}

function idOf(input: unknown): string {
  const id = (input as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : "";
}

// A type a module registers after the declaration (modules start in
// parallel) is no reason to refuse it: the trigger arms when its type
// registers (onTriggerTypeRegistered). Every other error blocks an enabled
// declaration, as it blocks enabling in the builder.
function tolerateLateTypes(issue: GraphIssue): GraphIssue {
  return issue.code === "unknownType"
    ? { ...issue, severity: "warning" }
    : issue;
}

interface Stored {
  status: DeclaredProcedureStatus;
  enabled: boolean;
}

async function afterWrite(id: string, event: string): Promise<void> {
  // Arms (or disarms) its triggers here and on every other instance.
  await subscriptions.onProcedureChange(id);
  notifyTopic(PROCEDURES_TOPIC, event, { procedureId: id });
}

/** Insert the procedure; false when another instance just inserted it. */
async function insertDeclared(
  id: string,
  content: DeclaredContent,
): Promise<boolean> {
  const model = GetModel(ProcedureModel, DATABASE_NAME);
  const now = new Date();
  try {
    await model.insert({
      _id: id,
      ...content,
      version: 1,
      revision: 1,
      declaredHash: hashOf(content),
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    if (await model.get(id)) return false;
    throw err;
  }
  await afterWrite(id, "created");
  return true;
}

/** Bring a stored procedure to `content`, unless someone changed it. */
async function refreshDeclared(
  existing: Procedure,
  content: DeclaredContent,
  graph: ProcedureGraph,
): Promise<Stored> {
  const hash = hashOf(content);
  if (!isAsDeclared(existing)) {
    return { status: "kept", enabled: existing.enabled };
  }
  if (existing.declaredHash === hash) {
    return { status: "unchanged", enabled: existing.enabled };
  }
  const id = existing._id;
  const version = changesExecution(existing.graph, graph)
    ? existing.version + 1
    : existing.version;
  const model = GetModel(ProcedureModel, DATABASE_NAME);
  const applied = await model.updateAtRevision(id, existing.revision, {
    ...content,
    version,
    // A builder open on the previous revision cannot save over it.
    revision: existing.revision + 1,
    declaredHash: hash,
    updated_at: new Date(),
  });
  if (!applied) {
    // Written since it was read: by another instance declaring the same
    // thing (then it is this declaration), or by someone (then it stays).
    const now = await model.get(id);
    const same = now?.declaredHash === hash && isAsDeclared(now);
    return {
      status: same ? "unchanged" : "kept",
      enabled: now?.enabled ?? existing.enabled,
    };
  }
  const runs = GetModel(ProcedureRunModel, DATABASE_NAME);
  if (existing.name !== content.name) {
    await runs.renameProcedure(id, content.name);
  }
  if (version !== existing.version) await runs.markOlderVersions(id, version);
  await afterWrite(id, "updated");
  return { status: "updated", enabled: content.enabled };
}

async function storeDeclared(
  id: string,
  content: DeclaredContent,
  graph: ProcedureGraph,
): Promise<Stored> {
  const model = GetModel(ProcedureModel, DATABASE_NAME);
  let existing = await model.get(id);
  if (!existing) {
    if (await insertDeclared(id, content)) {
      return { status: "created", enabled: content.enabled };
    }
    existing = await model.get(id);
    if (!existing) throw refusal(id, ["the procedure could not be stored"]);
  }
  return refreshDeclared(existing, content, graph);
}

/**
 * Create or refresh the procedure a module declares, validated as an import
 * is, and as enabling it in the builder is when it is enabled. Rejects with
 * an Error naming the problems; resolves with what was done and the graph's
 * remaining (non-blocking) issues.
 */
export async function declareProcedure(
  input: unknown,
): Promise<DeclaredProcedure> {
  const parsed = declarationSchema.safeParse(input);
  if (!parsed.success) {
    throw refusal(
      idOf(input),
      parsed.error.issues.map(
        (i) => `${i.path.join(".") || "declaration"}: ${i.message}`,
      ),
    );
  }
  const { id, name, enabled, graph } = parsed.data;
  const issues = (
    await saveIssues(graph, enabled, { procedureId: id, name })
  ).map(tolerateLateTypes);
  if (enabled && hasBlockingIssue(issues)) {
    throw refusal(
      id,
      issues.filter((i) => i.severity === "error").map((i) => i.message),
    );
  }
  const content: DeclaredContent = {
    name,
    description: parsed.data.description ?? "",
    graph: JSON.stringify(graph),
    enabled,
  };
  const stored = await storeDeclared(id, content, graph);
  return { id, ...stored, issues };
}
