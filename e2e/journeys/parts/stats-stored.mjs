import { auto, isRow, isText, list, num, parseJson, text } from "../../auto.mjs";
import { withDatabase } from "./overview-kit.mjs";

/**
 * @typedef {import("../../auto.mjs").Ctx} Ctx
 * @typedef {import("../../auto.mjs").Row} Row
 * @typedef {import("./stats-reference-health.mjs").RefRun} RefRun
 * @typedef {{ trigger: Record<string, string>, action: Record<string, string>, data: Record<string, string> }} TypeNames
 * @typedef {{ id: string, name: string, description: string, enabled: boolean, version: number, updatedAt: Date, pausedAt?: Date, pausedBy?: string, attentionDismissedAt?: Date, armErrors?: string, nodes: Row[] }} StoredProcedure
 * @typedef {{ procedures: StoredProcedure[], runs: RefRun[], names: TypeNames }} Stored
 */

/**
 * @param {Row} row A stored document
 * @param {string} field A field name
 * @returns {Date | undefined} The field when it is a date
 */
function dateField(row, field) {
  const value = row[field];
  return value instanceof Date ? value : undefined;
}

/**
 * @param {Row} row A stored run
 * @returns {RefRun} The run as the reference reads it
 * @throws When the run has no start
 */
function parseRun(row) {
  const startedAt = dateField(row, "startedAt");
  if (!startedAt) throw new Error(`run ${text(row, "_id")} has no start`);
  /** @type {RefRun} */
  const run = { _id: text(row, "_id"), procedureId: text(row, "procedureId"), procedureName: text(row, "procedureName"), startedAt, status: text(row, "status"), kind: text(row, "kind") };
  const endedAt = dateField(row, "endedAt");
  if (endedAt) run.endedAt = endedAt;
  if (isText(row.errorMessage)) run.errorMessage = row.errorMessage;
  if (isText(row.failedNodeId)) run.failedNodeId = row.failedNodeId;
  return run;
}

/**
 * @param {Row} row A stored procedure
 * @returns {StoredProcedure} The procedure with its graph parsed
 * @throws When the procedure has no update date
 */
function parseProcedure(row) {
  const updatedAt = dateField(row, "updated_at");
  if (!updatedAt) throw new Error(`procedure ${text(row, "_id")} has no update date`);
  /** @type {StoredProcedure} */
  const procedure = {
    id: text(row, "_id"),
    name: text(row, "name"),
    description: text(row, "description"),
    enabled: row.enabled === true,
    version: num(row, "version") ?? 0,
    updatedAt,
    nodes: list(parseJson(text(row, "graph")), "nodes"),
  };
  const pausedAt = dateField(row, "pausedAt");
  if (pausedAt) procedure.pausedAt = pausedAt;
  if (isText(row.pausedBy)) procedure.pausedBy = row.pausedBy;
  const dismissed = dateField(row, "attentionDismissedAt");
  if (dismissed) procedure.attentionDismissedAt = dismissed;
  if (isText(row.armErrors)) procedure.armErrors = row.armErrors;
  return procedure;
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} route The registry route of a kind of types
 * @returns {Promise<Record<string, string>>} The name of each type by id
 */
async function typeNamesOf(ctx, route) {
  const answer = await auto(ctx, `the names of ${route}`, "GET", route);
  return Object.fromEntries(list(answer.body).map((type) => [text(type, "id"), text(type, "name")]));
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<Stored>} What the database stores, and the names the registry gives the types
 */
export async function readStored(ctx) {
  const { procedures, runs } = await withDatabase(ctx, async (database) => ({
    procedures: await database.collection("dms_automation__procedures").find({}).toArray(),
    runs: await database.collection("dms_automation__procedure_runs").find({}).toArray(),
  }));
  return {
    procedures: procedures.filter(isRow).map(parseProcedure),
    runs: runs.filter(isRow).map(parseRun),
    names: { trigger: await typeNamesOf(ctx, "/trigger-types"), action: await typeNamesOf(ctx, "/action-types"), data: await typeNamesOf(ctx, "/data-node-types") },
  };
}
