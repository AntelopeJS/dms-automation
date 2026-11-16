import { isRow, text } from "../../auto.mjs";
import { failedStepOf, healthByProcedure, healthOf, stepText } from "./stats-reference.mjs";

/**
 * @typedef {import("./stats-reference.mjs").RefContext} RefContext
 * @typedef {import("./stats-reference.mjs").RefFacts} RefFacts
 * @typedef {import("./stats-reference.mjs").RefTrigger} RefTrigger
 * @typedef {import("./stats-reference.mjs").RefStep} RefStep
 * @typedef {import("./stats-reference.mjs").HeroRef} HeroRef
 * @typedef {import("./stats-reference-health.mjs").RefHealth} RefHealth
 * @typedef {import("./stats-reference-health.mjs").RefRun} RefRun
 * @typedef {import("../../auto.mjs").Row} Row
 * @typedef {{ runsUrl: string, runsPeriod?: { scope: string, preset: string }, traceUrl: string, proceduresUrl: string }} BannerLinks
 */

/**
 * The old algorithm of the procedures list (`summaryRow` of `src/db/models/stats.model.ts`), of the health banner
 * (`src/stats/health-banner.ts`) and of the Library usage state, copied as it was at commit 285f4b8. The fixture uses no
 * schedule trigger: the words of a cron expression are not run data.
 */

const DETAIL = "dms_automation.procedures.detail";
const HEALTH = "dms_automation.health";
const STATE_ORDER = ["failing", "degraded", "healthy", "paused", "draft"];
const SORTABLE_KEYS = ["name", "trigger", "status", "lastRunAt", "successRate", "avgDurationMs", "runs"];

/**
 * @param {string} value A text
 * @returns {string | Row} A `$`-prefixed i18n key as a nested composed text, else the text
 */
function asParam(value) {
  return value.startsWith("$") ? { key: value.slice(1) } : value;
}

/**
 * @param {RefTrigger | undefined} trigger A trigger
 * @returns {string} What it reads as
 */
function triggerText(trigger) {
  if (!trigger) return "$dms_automation.trigger.none";
  if (trigger.path) return `${trigger.method ?? "POST"} ${trigger.path}`;
  return trigger.typeName;
}

/**
 * @param {RefTrigger[]} triggers The triggers of a procedure
 * @returns {string | Row | null} The first one's type under its settings, and how many triggers follow
 */
function triggersTypeText(triggers) {
  const first = triggers[0];
  const typeText = first?.path ? first.typeName : null;
  const more = triggers.length - 1;
  if (more < 1) return typeText;
  const count = { type: "count", value: more };
  return typeText ? { key: `${DETAIL}.moreTriggers`, params: { type: asParam(typeText), count } } : { key: `${DETAIL}.moreTriggersOnly`, params: { count } };
}

/**
 * @param {string | undefined} message A run's error
 * @returns {string | Row} The error, or "Run failed" when it gave none
 */
function errorParam(message) {
  return message || { key: `${DETAIL}.runFailed` };
}

/**
 * @param {RefHealth} health The procedure's health
 * @param {RefStep | null} failedStep The step its last run stopped at
 * @returns {Row} Why a failing procedure fails
 */
function failingDetail(health, failedStep) {
  if (health.armError) {
    const { params } = health.armError;
    return { key: `${DETAIL}.triggerError`, params: { error: { key: `dms_automation.editor.problems.codes.${text(health.armError, "code")}`, params } } };
  }
  const step = stepText(failedStep);
  const params = {
    error: errorParam(health.lastRun?.errorMessage),
    count: { type: "count", value: health.failureStreak },
    since: { type: "relative", value: (health.failingSince ?? new Date()).toISOString() },
  };
  return step ? { key: `${DETAIL}.failingAt`, params: { ...params, step: asParam(step) } } : { key: `${DETAIL}.failing`, params };
}

/**
 * @param {RefHealth} health The procedure's health
 * @param {RefRun | undefined} lastFailed Its newest failed run
 * @param {RefStep | null} failedStep The step its last run stopped at
 * @returns {Row | null} The line under the status pill
 */
function statusDetailOf(health, lastFailed, failedStep) {
  if (health.state === "failing") return failingDetail(health, failedStep);
  if (health.state === "degraded") return { key: `${DETAIL}.degraded`, params: { failed: health.failed, runs: health.runs, error: errorParam(lastFailed?.errorMessage) } };
  if (health.state === "healthy") return health.lastRun ? null : { text: `$${DETAIL}.noRunYet`, tone: "muted" };
  return null;
}

/**
 * @param {number | null} rate A success rate
 * @returns {number | null} It in whole percents, rounded down
 */
function wholePercent(rate) {
  return rate === null ? null : Math.floor(rate * 100) / 100;
}

/**
 * @param {RefContext} ctx The context
 * @param {RefFacts} facts The procedure
 * @param {RefHealth} health Its health over the state window
 * @returns {Row} The procedures list's row
 */
function summaryRow(ctx, facts, health) {
  const { doc, triggers } = facts;
  const lastFailed = ctx.runs.find((r) => r.procedureId === facts.id && r.status === "failed");
  const failedStep = health.state === "failing" && health.lastRun?.status === "failed" ? (failedStepOf(ctx, health.lastRun) ?? null) : null;
  return {
    procedureId: facts.id,
    name: facts.name,
    description: doc.description,
    enabled: doc.enabled,
    trigger: triggers[0]?.typeId ?? null,
    triggerTypes: [...new Set(triggers.map((t) => t.typeId))],
    triggerSummary: triggers[0] ?? null,
    triggers,
    triggerText: triggerText(triggers[0]),
    triggerTypeText: triggersTypeText(triggers),
    triggerCount: triggers.length,
    status: health.state,
    statusDetail: statusDetailOf(health, lastFailed, failedStep),
    lastError: health.triggerError ?? lastFailed?.errorMessage ?? null,
    lastRunAt: health.lastRun ? new Date(health.lastRun.startedAt).toISOString() : null,
    lastRunId: health.lastRun?._id ?? null,
    lastRuns: health.recentRuns.map((r) => ({ runId: r._id, status: r.status, startedAt: new Date(r.startedAt).toISOString(), errorMessage: r.errorMessage ?? null })),
    successRate: wholePercent(health.successRate),
    avgDurationMs: health.avgDurationMs,
    runs: health.runs,
    failed: health.failed,
    failingSince: health.failingSince?.toISOString() ?? null,
    failedStep,
    version: doc.version,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * @param {RefContext} ctx A context read without a window
 * @returns {Row[]} One row per procedure, in the order of the procedures
 */
export function proceduresSummary(ctx) {
  const health = healthByProcedure(ctx);
  return ctx.procedures.map((facts) => summaryRow(ctx, facts, healthOf(health, facts.id)));
}

/**
 * @param {RefContext} ctx A context read without a window
 * @param {string} procedureId A procedure id
 * @returns {Row | undefined} The procedure's own row, undefined once it was deleted
 */
export function procedureSummary(ctx, procedureId) {
  const facts = ctx.byId.get(procedureId);
  if (!facts) return undefined;
  const health = healthByProcedure({ ...ctx, procedures: [facts], runs: ctx.runs.filter((r) => r.procedureId === procedureId) });
  return summaryRow(ctx, facts, healthOf(health, procedureId));
}

/**
 * @param {Row} a A row
 * @param {Row} b Another
 * @param {number} dir 1, or -1 to put the ones that need attention last
 * @returns {number} Their order by state, then by name
 */
function byState(a, b, dir = 1) {
  return (STATE_ORDER.indexOf(String(a.status)) - STATE_ORDER.indexOf(String(b.status))) * dir || String(a.name).localeCompare(String(b.name));
}

/**
 * @param {unknown} a A cell
 * @param {unknown} b Another
 * @param {number} dir 1 or -1
 * @returns {number} Their order
 */
function compareValues(a, b, dir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (Number.isFinite(a) && Number.isFinite(b)) return (Number(a) - Number(b)) * dir;
  const sortText = (/** @type {unknown} */ value) => (isRow(value) || Array.isArray(value) ? JSON.stringify(value) : String(value));
  return sortText(a).localeCompare(sortText(b)) * dir;
}

/**
 * @param {Row[]} rows The rows
 * @param {string | undefined} sortKey The column
 * @param {string | undefined} sortDirection `asc` or `desc`
 * @returns {Row[]} The rows as the list sorts them; the default is by state
 */
export function sortRows(rows, sortKey, sortDirection) {
  if (!sortKey || !SORTABLE_KEYS.includes(sortKey)) return [...rows].sort((a, b) => byState(a, b));
  const dir = sortDirection === "desc" ? -1 : 1;
  if (sortKey === "status") return [...rows].sort((a, b) => byState(a, b, dir));
  return [...rows].sort((a, b) => compareValues(a[sortKey], b[sortKey], dir));
}

/**
 * @param {HeroRef} hero The overview's health line
 * @returns {string | Row} The banner's title
 */
function headline(hero) {
  if (hero.state === "failing") return { key: `${HEALTH}.failing`, params: { count: { type: "count", value: hero.failing.length } } };
  if (hero.state === "degraded") return { key: `${HEALTH}.degraded`, params: { count: { type: "count", value: hero.degraded } } };
  return { key: `${HEALTH}.${hero.state === "healthy" ? "healthy" : "idle"}` };
}

/**
 * @param {HeroRef} hero The overview's health line
 * @returns {string | Row} The last failure's cause
 */
function failureCause(hero) {
  const failure = hero.lastFailure;
  if (!failure) return "";
  const step = stepText(failure.step);
  return step ? { key: `${HEALTH}.lastFailureAt`, params: { error: failure.error, step: asParam(step) } } : failure.error;
}

/**
 * @param {HeroRef} hero The overview's health line
 * @returns {string | Row} The banner's line
 */
function detail(hero) {
  const [first, ...others] = hero.failing;
  if (hero.state === "failing" && first) {
    const since = first.since ? { type: "datetime", value: first.since, format: "day" } : "—";
    const cause = first.armError
      ? { key: "dms_automation.procedures.detail.triggerError", params: { error: { key: `dms_automation.editor.problems.codes.${text(first.armError, "code")}`, params: first.armError.params ?? {} } } }
      : failureCause(hero);
    return others.length > 0
      ? { key: `${HEALTH}.failingDetailMany`, params: { name: first.name, others: { type: "count", value: others.length }, since, cause } }
      : { key: `${HEALTH}.failingDetail`, params: { name: first.name, since, cause } };
  }
  const { total, failed } = hero.figures;
  return { key: `${HEALTH}.summaryCount`, params: { count: { type: "count", value: total }, failed, enabled: hero.enabled, total: hero.procedures } };
}

/**
 * @param {HeroRef} hero The overview's health line
 * @param {BannerLinks} links The pages it points to
 * @returns {Row[]} The banner's buttons
 */
function actions(hero, links) {
  /** @type {Row[]} */
  const list = [];
  const failing = hero.state === "failing";
  if (hero.lastFailure && (failing || hero.state === "degraded")) {
    list.push({ label: `$${HEALTH}.inspectLastFailure`, icon: "i-ph-path", to: `${links.traceUrl}?run=${hero.lastFailure.runId}`, variant: failing ? "solid" : "outline", color: failing ? "error" : "neutral" });
  }
  if (hero.failing.length > 1) {
    list.push({ label: `$${HEALTH}.showFailingProcedures`, icon: "i-ph-flow-arrow", to: `${links.proceduresUrl}?tab=failing`, variant: "outline", color: "neutral" });
  } else if (hero.figures.failed > 0) {
    const query = new URLSearchParams({ tab: "failed" });
    if (links.runsPeriod) query.set(`${links.runsPeriod.scope}.period`, links.runsPeriod.preset);
    list.push({ label: `$${HEALTH}.showFailedRuns`, icon: "i-ph-x-circle", to: `${links.runsUrl}?${query}`, variant: "outline", color: "neutral" });
  }
  return list;
}

/** @type {Record<string, string>} */
const TONE = { failing: "error", degraded: "warning", healthy: "success", idle: "info" };

/** @type {Record<string, string>} */
const ICON = { failing: "i-ph-x-circle", degraded: "i-ph-warning", healthy: "i-ph-check-circle", idle: "i-ph-moon" };

/**
 * @param {HeroRef} hero The overview's health line, over a fixture that has procedures
 * @param {BannerLinks} links The pages it points to
 * @returns {Row} The banner the DMS draws
 */
export function healthBanner(hero, links) {
  return { tone: TONE[hero.state], icon: ICON[hero.state], title: headline(hero), description: detail(hero), actions: actions(hero, links) };
}

/**
 * @param {RefContext} ctx A context read without a window
 * @param {string} catalog `triggers` or `actions`
 * @returns {Record<string, Row[]>} Where each entry of the catalog is used, with the state of the procedure
 */
export function libraryUsage(ctx, catalog) {
  const kind = catalog === "triggers" ? "trigger" : "action";
  const health = healthByProcedure(ctx);
  /** @type {Map<string, Row[]>} */
  const out = new Map();
  for (const facts of ctx.procedures) {
    for (const node of facts.nodes) {
      const typeId = text(node, "typeId");
      if (node.kind !== kind || !typeId) continue;
      const label = text(node, "label").trim() || null;
      /** @type {Row} */
      const usage = { procedureId: facts.id, procedureName: facts.name, enabled: facts.doc.enabled, state: health.get(facts.id)?.state ?? "draft", nodeId: node.id, nodeLabel: label, groupPath: [], groupLabel: null, viaTemplate: null };
      const summary = facts.triggers.find((t) => t.nodeId === node.id);
      if (kind === "trigger" && summary?.path) Object.assign(usage, { method: summary.method, path: summary.path });
      const usages = out.get(typeId) ?? [];
      usages.push(usage);
      out.set(typeId, usages);
    }
  }
  return Object.fromEntries(out);
}
