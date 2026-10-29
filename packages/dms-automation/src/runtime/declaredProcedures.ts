import { IsDuplicateKeyError } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  DeclaredProcedure,
  DeclaredProcedureStatus,
  ProcedureDeclaration,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import { ProcedureModel } from "../db/models/procedure.model";
import { PROCEDURES_TOPIC, notifyTopic } from "../realtime";
import { saveIssues } from "../routes/procedureChecks";
import { exportedSchema } from "../routes/procedureSchemas";
import { DATABASE_NAME } from "../types/constants";
import { type GraphIssue, hasBlockingIssue } from "./graphIssues";
import { subscriptions } from "./subscriptions";
import { isObject, isString } from "../types/guards";

/**
 * Procedures a module ships as code (DeclareProcedure). The declared id is
 * the procedure's id. A declaration is stored once, when no procedure has its
 * id; from then on the procedure belongs to its users, and a later
 * declaration leaves it as it is.
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

function refusal(id: string, problems: string[]): Error {
  return new Error(
    `[dms-automation] DeclareProcedure("${id}") refused: ${problems.join("; ")}`,
  );
}

function idOf(input: unknown): string {
  const id = isObject(input) && "id" in input ? input.id : undefined;
  return isString(id) ? id : "";
}

/**
 * A type a module registers after the declaration (modules start in
 * parallel) is no reason to refuse it: the trigger arms when its type
 * registers (onTriggerTypeRegistered). Every other error blocks an enabled
 * declaration, as it blocks enabling in the builder.
 */
function tolerateLateTypes(issue: GraphIssue): GraphIssue {
  return issue.code === "unknownType"
    ? { ...issue, severity: "warning" }
    : issue;
}

interface Stored {
  status: DeclaredProcedureStatus;
  enabled: boolean;
}

/**
 * Store the procedure, unless one already has its id: that one is left as is.
 *
 * Declared at the same moment elsewhere (another instance): that
 * declaration stored it, this one keeps it.
 *
 * Arms its triggers here and on every other instance.
 */
async function storeDeclared(
  id: string,
  content: DeclaredContent,
): Promise<Stored> {
  const model = GetModel(ProcedureModel, DATABASE_NAME);
  const existing = await model.get(id);
  if (existing) return { status: "kept", enabled: existing.enabled };
  const now = new Date();
  try {
    await model.insert({
      _id: id,
      ...content,
      version: 1,
      revision: 1,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    if (!IsDuplicateKeyError(error)) throw error;
    const stored = await model.get(id);
    return { status: "kept", enabled: stored?.enabled ?? content.enabled };
  }
  await subscriptions.onProcedureChange(id);
  notifyTopic(PROCEDURES_TOPIC, "created", { procedureId: id });
  return { status: "created", enabled: content.enabled };
}

/**
 * Create the procedure a module declares, validated as an import is, and as
 * enabling it in the builder is when it is enabled. Rejects with an Error
 * naming the problems; resolves with what was done and the graph's remaining
 * (non-blocking) issues.
 */
export async function declareProcedure(
  input: ProcedureDeclaration,
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
  const stored = await storeDeclared(id, content);
  return { id, ...stored, issues };
}
