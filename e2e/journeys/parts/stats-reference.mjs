import { isNumber, isRow, list, parseJson, text } from "../../auto.mjs";
import { MS_PER_DAY, bucketStarts, byProcedure, durationOf, kpiPayload, procedureHealth, runFigures, runsBetween, runsPerBucket, stateRank, timeOf } from "./stats-reference-health.mjs";

/**
 * @typedef {import("./stats-reference-health.mjs").RefRun} RefRun
 * @typedef {import("./stats-reference-health.mjs").RefHealth} RefHealth
 * @typedef {import("./stats-reference-health.mjs").RefWindow} RefWindow
 * @typedef {import("./stats-reference-health.mjs").RefFigures} RefFigures
 * @typedef {import("./stats-stored.mjs").StoredProcedure} StoredProcedure
 * @typedef {import("./stats-stored.mjs").TypeNames} TypeNames
 * @typedef {import("../../auto.mjs").Row} Row
 * @typedef {{ nodeId: string, label?: string, typeName?: string, kind?: string }} RefStep
 * @typedef {{ nodeId: string, typeId: string, typeName: string, method?: string, path?: string }} RefTrigger
 * @typedef {{ doc: StoredProcedure, id: string, name: string, nodes: Row[], triggers: RefTrigger[] }} RefFacts
 * @typedef {{ now: Date, procedures: RefFacts[], byId: Map<string, RefFacts>, runs: RefRun[], names: TypeNames }} RefContext
 * @typedef {{ runId: string, procedureId: string, procedureName: string, startedAt: string, error: string, step: RefStep | null }} FailureRef
 * @typedef {{ procedureId: string, name: string, since: string | null, streak: number, lastRunId: string | null, armError: Row | null }} FailingRef
 * @typedef {{ state: string, procedures: number, enabled: number, failing: FailingRef[], degraded: number, paused: number, figures: RefFigures, lastFailure: FailureRef | null }} HeroRef
 * @typedef {{ procedureId: string, name: string, state: string, runs: number, failed: number, streak: number, since: string | null, lastRunId: string | null, lastFailure: FailureRef | null, recovered: boolean, armError: Row | null, pausedAt: string | null, pausedBy: string | null, triggerType: string | null }} AttentionRow
 */

/**
 * The old algorithm of `loadStatsContext` (`src/db/models/stats.model.ts`) and of `src/stats/overview.ts`, copied as it was
 * at commit 285f4b8. It reads what the database stores, never an answer of the module under test.
 */

const STATE_WINDOW_MS = 7 * MS_PER_DAY;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_ATTENTION_ROWS = 5;
const RECENT_FEED_RUNS = 8;
const STRIP_RUNS = 12;
const COUNTED_STATES = ["failing", "degraded", "healthy", "paused", "draft"];

/**
 * @param {Row} node A graph node
 * @returns {string | undefined} Its label when the builder gave one
 */
function labelOf(node) {
  const label = text(node, "label").trim();
  return label || undefined;
}

/**
 * @param {Row} node A graph node
 * @param {TypeNames} names The names the registry gives the types
 * @returns {string | undefined} The name of its type
 */
function typeNameOf(node, names) {
  const kind = text(node, "kind");
  const typeId = text(node, "typeId");
  if (!typeId) return undefined;
  if (kind === "trigger" || kind === "action" || kind === "data") return names[kind][typeId] ?? typeId;
  return undefined;
}

/**
 * @param {Row[]} nodes The nodes of a procedure graph
 * @param {string} nodeId A node id
 * @param {TypeNames} names The names the registry gives the types
 * @returns {RefStep} The step as the stats name it
 */
export function stepName(nodes, nodeId, names) {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { nodeId };
  /** @type {RefStep} */
  const step = { nodeId, kind: text(node, "kind") };
  const label = labelOf(node);
  const typeName = typeNameOf(node, names);
  if (label) step.label = label;
  if (typeName) step.typeName = typeName;
  return step;
}

/**
 * @param {RefStep} step A step
 * @returns {string} Its label, else its type name, else its id
 */
export function stepTitle(step) {
  return step.label ?? step.typeName ?? step.nodeId;
}

/**
 * @param {RefStep | null | undefined} step A step
 * @returns {string | null} Its name as the texts say it
 */
export function stepText(step) {
  if (!step?.nodeId) return null;
  return stepTitle(step);
}

/**
 * @param {Row} node A trigger node
 * @param {TypeNames} names The names the registry gives the types
 * @returns {RefTrigger} What identifies the trigger
 */
function summarizeTrigger(node, names) {
  const typeId = text(node, "typeId");
  /** @type {RefTrigger} */
  const summary = { nodeId: text(node, "id"), typeId, typeName: typeNameOf(node, names) ?? typeId };
  const path = text(node, "config", "path");
  if (path) {
    summary.path = path;
    summary.method = text(node, "config", "method") || "POST";
  }
  if (text(node, "config", "cron")) throw new Error("the reference does not word schedules");
  return summary;
}

/**
 * @param {Row[]} nodes The nodes of a procedure graph
 * @returns {boolean} Whether a node of it, in a group too, is a trigger
 */
function hasTrigger(nodes) {
  return nodes.some((node) => node.kind === "trigger" || hasTrigger(list(node, "subgraph", "nodes")));
}

/**
 * @param {StoredProcedure} doc A stored procedure
 * @param {TypeNames} names The names the registry gives the types
 * @returns {RefFacts} The procedure with what its graph says
 */
function factsOf(doc, names) {
  const triggers = doc.nodes.filter((node) => node.kind === "trigger" && text(node, "typeId")).map((node) => summarizeTrigger(node, names));
  return { doc, id: doc.id, name: doc.name, nodes: doc.nodes, triggers };
}

/**
 * @param {RefRun[]} list Runs, newest first
 * @param {number} size How many a view shows
 * @param {string} what Which view
 * @throws When two runs of one start straddle the cut of the view
 */
function assertCut(list, size, what) {
  const edge = list[size - 1];
  const next = list[size];
  if (edge && next && timeOf(edge.startedAt) === timeOf(next.startedAt)) throw new Error(`the fixture ties two runs across the cut of ${what}`);
}

/**
 * @param {RefRun[]} runs Runs
 * @param {RefRun} run A run
 * @param {string} status A status
 * @returns {number} How many of them share the start of `run` and have `status`
 */
function sameStart(runs, run, status) {
  return runs.filter((other) => timeOf(other.startedAt) === timeOf(run.startedAt) && other.status === status).length;
}

/**
 * Throws when a fixture holds a case whose old answer depends on the order the database returns runs that share a start.
 *
 * @param {RefRun[]} runs The production runs, newest first
 */
function assertPredictable(runs) {
  assertCut(runs, RECENT_FEED_RUNS, "the recent runs feed");
  for (const [id, own] of byProcedure(runs)) {
    assertCut(own, STRIP_RUNS, `the strip of ${id}`);
    const [newest] = own;
    if (newest && own.filter((run) => timeOf(run.startedAt) === timeOf(newest.startedAt)).length > 1) throw new Error(`the fixture ties the newest runs of ${id}`);
    const lastFailed = own.find((run) => run.status === "failed");
    if (lastFailed && sameStart(own, lastFailed, "failed") > 1) throw new Error(`the fixture ties the newest failures of ${id}`);
    for (const run of own) {
      if (sameStart(own, run, run.status === "ok" ? "failed" : "ok") > 0) throw new Error(`the fixture ties a failed and an ok run of ${id}`);
    }
  }
  const lastFailed = runs.find((run) => run.status === "failed");
  if (lastFailed && sameStart(runs, lastFailed, "failed") > 1) throw new Error("the fixture ties the newest failures of two procedures");
}

/**
 * The context `loadStatsContext(earliest, now)` builds.
 *
 * @param {{ procedures: StoredProcedure[], runs: RefRun[], names: TypeNames, now: Date, earliest?: Date }} input The stored documents
 * @returns {RefContext} The procedures, newest write first, and the production runs since the lookback, newest first
 * @throws When the fixture holds a case the old answer does not settle
 */
export function statsContext({ procedures, runs, names, now, earliest }) {
  const ordered = [...procedures].sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
  for (let index = 1; index < ordered.length; index += 1) {
    if (timeOf(ordered[index - 1]?.updatedAt ?? 0) === timeOf(ordered[index]?.updatedAt ?? 0)) throw new Error("the fixture ties two procedures' updated_at");
  }
  const facts = ordered.map((doc) => factsOf(doc, names));
  const lookback = new Date(now.getTime() - DEFAULT_RETENTION_DAYS * MS_PER_DAY);
  const since = earliest && earliest < lookback ? earliest : lookback;
  const production = runs.filter((run) => run.kind !== "test" && timeOf(run.startedAt) >= since.getTime());
  production.sort((a, b) => timeOf(b.startedAt) - timeOf(a.startedAt));
  assertPredictable(production);
  return { now, procedures: facts, byId: new Map(facts.map((f) => [f.id, f])), runs: production, names };
}

/**
 * @param {StoredProcedure} doc A stored procedure
 * @returns {Row | undefined} The first reason one of its triggers could not arm
 */
function armErrorOf(doc) {
  if (!doc.armErrors) return undefined;
  const parsed = parseJson(doc.armErrors);
  const first = isRow(parsed) ? Object.values(parsed)[0] : undefined;
  return isRow(first) ? first : undefined;
}

/**
 * @param {RefContext} ctx The context
 * @param {Date} [since] The start of the window; the last 7 days by default
 * @returns {Map<string, RefHealth>} The health of every procedure, by id
 */
export function healthByProcedure(ctx, since = new Date(ctx.now.getTime() - STATE_WINDOW_MS)) {
  const runsOf = byProcedure(ctx.runs);
  /** @type {Map<string, RefHealth>} */
  const out = new Map();
  for (const facts of ctx.procedures) {
    /** @type {import("./stats-reference-health.mjs").RefSubject} */
    const subject = { _id: facts.id, enabled: facts.doc.enabled, hasTrigger: hasTrigger(facts.nodes) };
    if (facts.doc.pausedAt) subject.pausedAt = facts.doc.pausedAt;
    const armError = armErrorOf(facts.doc);
    if (armError) subject.armError = armError;
    out.set(facts.id, procedureHealth(subject, runsOf.get(facts.id) ?? [], since));
  }
  return out;
}

/**
 * @param {Map<string, RefHealth>} health Health by procedure id
 * @param {string} id A procedure id
 * @returns {RefHealth} Its health
 * @throws When the procedure has none
 */
export function healthOf(health, id) {
  const found = health.get(id);
  if (!found) throw new Error(`no health for ${id}`);
  return found;
}

/**
 * @param {RefContext} ctx The context
 * @param {Pick<RefRun, "procedureId" | "failedNodeId">} run A run
 * @returns {RefStep | undefined} The step the run stopped at
 */
export function failedStepOf(ctx, run) {
  if (!run.failedNodeId) return undefined;
  const facts = ctx.byId.get(run.procedureId);
  return facts ? stepName(facts.nodes, run.failedNodeId, ctx.names) : { nodeId: run.failedNodeId };
}

/**
 * @param {RefContext} ctx The context
 * @param {RefWindow} window A window
 * @returns {RefRun[]} The production runs inside it
 */
export function windowRuns(ctx, window) {
  return runsBetween(ctx.runs, window.from, window.to);
}

/**
 * @param {RefContext} ctx The context
 * @param {RefRun} run A failed run
 * @returns {FailureRef} The failure as the overview links to it
 */
function failureRef(ctx, run) {
  return {
    runId: run._id,
    procedureId: run.procedureId,
    procedureName: ctx.byId.get(run.procedureId)?.name ?? "",
    startedAt: new Date(run.startedAt).toISOString(),
    error: run.errorMessage ?? "",
    step: failedStepOf(ctx, run) ?? null,
  };
}

/**
 * @param {{ state: string, streak: number, failed: number }} a A procedure's urgency
 * @param {{ state: string, streak: number, failed: number }} b Another
 * @returns {number} Their order
 */
function byUrgency(a, b) {
  return stateRank(a.state) - stateRank(b.state) || b.streak - a.streak || b.failed - a.failed;
}

/**
 * @param {number} procedures How many procedures there are
 * @param {string[]} states Their states
 * @param {RefFigures} figures The window's figures
 * @returns {string} The overall state
 */
function overallState(procedures, states, figures) {
  if (procedures === 0) return "empty";
  if (states.includes("failing")) return "failing";
  if (states.includes("degraded")) return "degraded";
  return figures.total > 0 ? "healthy" : "idle";
}

/**
 * @param {RefContext} ctx The context
 * @param {RefWindow} window The window
 * @returns {HeroRef} The overview's health line
 */
export function healthHero(ctx, window) {
  const health = healthByProcedure(ctx, window.from);
  const states = [...health.values()].map((h) => h.state);
  const figures = runFigures(windowRuns(ctx, window));
  const urgency = (/** @type {string} */ id) => {
    const h = healthOf(health, id);
    return { state: h.state, streak: h.failureStreak, failed: h.failed };
  };
  const failing = ctx.procedures
    .filter((p) => health.get(p.id)?.state === "failing")
    .sort((a, b) => byUrgency(urgency(a.id), urgency(b.id)))
    .map((p) => {
      const h = healthOf(health, p.id);
      return { procedureId: p.id, name: p.name, since: h.failingSince?.toISOString() ?? null, streak: h.failureStreak, lastRunId: h.lastRun?._id ?? null, armError: h.armError ?? null };
    });
  const first = failing[0];
  const lastFailed = first ? ctx.runs.find((r) => r._id === first.lastRunId && r.status === "failed") : ctx.runs.find((r) => r.status === "failed");
  return {
    state: overallState(ctx.procedures.length, states, figures),
    procedures: ctx.procedures.length,
    enabled: ctx.procedures.filter((p) => p.doc.enabled).length,
    failing,
    degraded: states.filter((s) => s === "degraded").length,
    paused: states.filter((s) => s === "paused").length,
    figures,
    lastFailure: lastFailed ? failureRef(ctx, lastFailed) : null,
  };
}

/**
 * @param {RefContext} ctx The context
 * @param {Date} [since] The start of the period
 * @returns {{ items: AttentionRow[], total: number }} The first rows of Needs attention and how many procedures it holds
 */
export function attentionRows(ctx, since) {
  const health = healthByProcedure(ctx, since);
  /** @type {AttentionRow[]} */
  const rows = [];
  for (const facts of ctx.procedures) {
    const h = healthOf(health, facts.id);
    if (!["failing", "degraded", "paused"].includes(h.state)) continue;
    const lastFailed = ctx.runs.find((r) => r.procedureId === facts.id && r.status === "failed");
    const dismissedAt = facts.doc.attentionDismissedAt;
    const dismissed = h.state === "degraded" && dismissedAt !== undefined && lastFailed !== undefined && timeOf(lastFailed.startedAt) <= dismissedAt.getTime();
    if (dismissed) continue;
    rows.push({
      procedureId: facts.id,
      name: facts.name,
      state: h.state,
      runs: h.runs,
      failed: h.failed,
      streak: h.failureStreak,
      since: h.failingSince?.toISOString() ?? null,
      lastRunId: h.lastRun?._id ?? null,
      lastFailure: lastFailed ? failureRef(ctx, lastFailed) : null,
      recovered: h.state === "degraded",
      armError: h.armError ?? null,
      pausedAt: facts.doc.pausedAt?.toISOString() ?? null,
      pausedBy: facts.doc.pausedBy ?? null,
      triggerType: facts.triggers[0]?.typeId ?? null,
    });
  }
  return { items: rows.sort(byUrgency).slice(0, MAX_ATTENTION_ROWS), total: rows.length };
}

/**
 * @param {number | null} ms A duration
 * @returns {string} It as the run lists show it
 */
function formatDuration(ms) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * @param {RefContext} ctx The context
 * @param {string} traceUrl The trace page
 * @returns {Row[]} The overview's recent runs, newest first
 */
export function recentRunItems(ctx, traceUrl) {
  return ctx.runs.slice(0, RECENT_FEED_RUNS).map((run) => {
    const failed = run.status === "failed";
    const step = failedStepOf(ctx, run);
    /** @type {Record<string, string>} */
    const params = { duration: formatDuration(durationOf(run)), error: run.errorMessage ?? "" };
    if (step) params.step = stepTitle(step);
    const name = ctx.byId.get(run.procedureId)?.name;
    if (name === undefined && run.procedureName) params.name = run.procedureName;
    const outcome = failed ? (step ? "$dms_automation.feed.failedAt" : "$dms_automation.feed.failed") : "$dms_automation.feed.completed";
    return {
      id: run._id,
      icon: failed ? "i-ph-x-circle" : "i-ph-check-circle",
      tone: failed ? "error" : "success",
      title: name ?? (params.name ? "$dms_automation.feed.deletedProcedureNamed" : "$dms_automation.feed.deletedProcedure"),
      meta: [outcome, "$dms_automation.feed.duration"],
      params,
      date: new Date(run.startedAt).toISOString(),
      to: `${traceUrl}?run=${run._id}`,
    };
  });
}

/**
 * @param {RefContext} ctx The context
 * @param {string} proceduresUrl The Procedures page
 * @returns {Row[]} The total and one line per state
 */
export function procedureCounts(ctx, proceduresUrl) {
  const health = [...healthByProcedure(ctx).values()];
  const total = { id: "total", label: "$dms_automation.overview.counts.total", value: ctx.procedures.length, to: proceduresUrl };
  const states = COUNTED_STATES.map((state) => {
    const value = health.filter((h) => h.state === state).length;
    /** @type {Row} */
    const item = { id: state, label: `$dms_automation.overview.counts.${state}`, value, to: `${proceduresUrl}?tab=${state}` };
    const tone = state === "failing" ? "error" : state === "degraded" ? "warning" : undefined;
    if (tone && value > 0) {
      item.type = "status";
      item.tone = tone;
    }
    return item;
  });
  return [total, ...states];
}

/**
 * @param {RefContext} ctx The context
 * @returns {{ id: string, title: string, value: number }[]} How many procedures each trigger type starts, most used first
 */
export function triggerCounts(ctx) {
  /** @type {Map<string, { id: string, title: string, value: number }>} */
  const counts = new Map();
  for (const facts of ctx.procedures) {
    const types = new Map(facts.triggers.map((t) => [t.typeId, t.typeName]));
    for (const [typeId, typeName] of types) {
      const item = counts.get(typeId) ?? { id: typeId, title: typeName, value: 0 };
      item.value += 1;
      counts.set(typeId, item);
    }
  }
  return [...counts.values()].sort((a, b) => b.value - a.value);
}

/**
 * @param {RefContext} ctx The context
 * @param {RefWindow} window The window
 * @returns {Row} What the Runs chart reads
 */
export function runsPerDayChart(ctx, window) {
  const runs = windowRuns(ctx, window);
  const buckets = runsPerBucket(runs, window);
  const starts = bucketStarts(window);
  const point = (/** @type {string} */ status) => (/** @type {RefRun[]} */ bucket, /** @type {number} */ i) => ({ x: starts[i]?.toISOString(), y: bucket.filter((r) => r.status === status).length });
  /** @type {Row} */
  const chart = {
    value: runs.length,
    series: [
      { name: "$dms_automation.overview.succeeded", data: buckets.map(point("ok")) },
      { name: "$dms_automation.overview.failedRuns", data: buckets.map(point("failed")) },
    ],
  };
  if (!window.compareFrom || !window.compareTo) return chart;
  const compared = runsPerBucket(ctx.runs, { from: window.compareFrom, to: window.compareTo });
  const { previousValue, delta } = kpiPayload("runs", ctx.runs, window);
  if (previousValue !== undefined) chart.previousValue = previousValue;
  if (isNumber(delta)) chart.delta = delta;
  chart.comparisonSeries = [{ name: "$dms_automation.overview.comparedRuns", type: "line", data: starts.map((start, i) => ({ x: start.toISOString(), y: compared[i]?.length ?? null })) }];
  return chart;
}
