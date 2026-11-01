import {
  Controller,
  Get,
  HTTPResult,
  Parameter,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import {
  loadStatsContext,
  type PeriodQuery,
  type StatsWindow,
  windowOf,
} from "../db/models/stats.model";
import {
  isPeriodPreset,
  PROCEDURES_URL,
  recipeActions,
  RUNS_PERIOD_SCOPE,
  RUNS_URL,
  TRACE_URL,
} from "../pages/shared";
import { healthBanner } from "../stats/health-banner";
import { isKpiMetric, kpiPayload } from "../stats/kpi";
import {
  attentionRows,
  healthHero,
  procedureCounts,
  recentRunItems,
  runsPerDayChart,
  triggerCounts,
} from "../stats/overview";
import { DATABASE_NAME, MS_PER_DAY } from "../types/constants";

/**
 * The longest window a stats route reads: a year. Its cost grows with the
 * window, and nothing on the dashboards asks for more.
 */
const MAX_WINDOW_MS = 366 * MS_PER_DAY;

/** A date of the query, or a 400 when it is there but not a date. */
function checkedDate(name: string, raw: string | undefined): void {
  if (raw !== undefined && Number.isNaN(new Date(raw).getTime())) {
    throw new HTTPResult(400, { error: `"${name}" is not a date` });
  }
}

function checkedSpan(from: Date, to: Date, what: string): void {
  const span = to.getTime() - from.getTime();
  if (span <= 0) {
    throw new HTTPResult(400, { error: `${what} ends before it starts` });
  }
  if (span > MAX_WINDOW_MS) {
    throw new HTTPResult(400, { error: `${what} is longer than a year` });
  }
}

/**
 * A period query, with the preset and the comparison the DMS period scope
 * names them by.
 */
export interface PresetQuery extends PeriodQuery {
  preset?: string;
  comparison?: string;
}

/**
 * The presets that end now: the page computes their range once a minute, so
 * a run of the last seconds would fall after `to` until the next minute.
 */
const SLIDING_PRESETS = new Set(["last-hour", "last-24h"]);

/** The window moved forward by `ms`, its comparison with it. */
function shifted(window: StatsWindow, ms: number): StatsWindow {
  const move = (date: Date) => new Date(date.getTime() + ms);
  const out: StatsWindow = { from: move(window.from), to: move(window.to) };
  if (window.compareFrom && window.compareTo) {
    out.compareFrom = move(window.compareFrom);
    out.compareTo = move(window.compareTo);
  }
  return out;
}

/**
 * The window a period query asks for, or a 400: a date that is not one, a
 * window that ends before it starts or spans more than a year, rather than
 * a silent default or minutes of work. A sliding preset ends at the request,
 * not at the minute the page computed it. The compared window is the one the
 * scope resolved (the period before, or the same window a year earlier);
 * "none" compares with nothing, whatever dates come with it.
 */
export function periodWindow(
  { preset, comparison, ...query }: PresetQuery,
  now: Date = new Date(),
): StatsWindow {
  if (comparison === "none") {
    delete query.compareFrom;
    delete query.compareTo;
  }
  for (const [name, raw] of Object.entries(query)) checkedDate(name, raw);
  let window = windowOf(query, now);
  checkedSpan(window.from, window.to, "the period");
  if (window.compareFrom && window.compareTo) {
    checkedSpan(window.compareFrom, window.compareTo, "the compared period");
  }
  const late = now.getTime() - window.to.getTime();
  if (preset && SLIDING_PRESETS.has(preset) && late > 0) {
    window = shifted(window, late);
  }
  return window;
}

/** The earliest date a window (and its comparison) reaches back to. */
function earliestOf(window: StatsWindow): Date {
  return window.compareFrom && window.compareFrom < window.from
    ? window.compareFrom
    : window.from;
}

/**
 * The window, without its comparison when the runs kept do not reach back to
 * it: past the retention (30 days by default), or before the first run, the
 * compared period is empty and every change would read "new". The same
 * window a year earlier is past the default retention: the cards then show
 * no change rather than a comparison with nothing.
 */
async function withKeptComparison(window: StatsWindow): Promise<StatsWindow> {
  if (!window.compareFrom) return window;
  const runs = GetModel(ProcedureRunModel, DATABASE_NAME);
  if (await runs.hasRunBefore(window.compareFrom)) return window;
  return { from: window.from, to: window.to };
}

/**
 * A KPI card's payload for one metric over a period: shared by the overview
 * and the run history, which ask for the same figures.
 */
export async function kpiAnswer(metric: string, query: PresetQuery) {
  if (!isKpiMetric(metric)) {
    throw new HTTPResult(404, { error: `unknown metric "${metric}"` });
  }
  const window = await withKeptComparison(periodWindow(query));
  const ctx = await loadStatsContext(earliestOf(window));
  return kpiPayload(metric, ctx.runs, window);
}

/**
 * Every figure counts production runs only: test runs from the builder never
 * move a KPI or a procedure's state.
 */
@AuthOwnerOnly()
export class StatsController extends Controller("/api/automation/stats") {
  /** The period scope sends its preset too: the run history opens on it. */
  @Get("/health")
  async health(
    @AuthRawUser() _user: User,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("preset", "query") preset?: string,
  ) {
    const window = periodWindow({ from, to, preset });
    const hero = healthHero(await loadStatsContext(earliestOf(window)), window);
    return healthBanner(hero, {
      runsUrl: RUNS_URL,
      runsPeriod: isPeriodPreset(preset)
        ? { scope: RUNS_PERIOD_SCOPE, preset }
        : undefined,
      traceUrl: TRACE_URL,
      proceduresUrl: PROCEDURES_URL,
      recipes: recipeActions(),
    });
  }

  @Get("/kpi/:metric")
  // oxlint-disable-next-line eslint/max-params -- one decorator per query input
  async kpi(
    @AuthRawUser() _user: User,
    @Parameter("metric", "param") metric: string,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
    @Parameter("preset", "query") preset?: string,
    @Parameter("comparison", "query") comparison?: string,
  ) {
    return kpiAnswer(metric, {
      from,
      to,
      compareFrom,
      compareTo,
      preset,
      comparison,
    });
  }

  /** Compared as the KPIs are: the window the scope resolved, kept runs only. */
  @Get("/runs-per-day")
  // oxlint-disable-next-line eslint/max-params -- one decorator per query input
  async runsPerDay(
    @AuthRawUser() _user: User,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
    @Parameter("preset", "query") preset?: string,
    @Parameter("comparison", "query") comparison?: string,
  ) {
    const window = await withKeptComparison(
      periodWindow({ from, to, compareFrom, compareTo, preset, comparison }),
    );
    return runsPerDayChart(await loadStatsContext(earliestOf(window)), window);
  }

  /** Failing and paused whatever the period; degraded over the period. */
  @Get("/attention")
  async attention(
    @AuthRawUser() _user: User,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("preset", "query") preset?: string,
  ) {
    const window = periodWindow({ from, to, preset });
    return attentionRows(await loadStatsContext(window.from), window.from);
  }

  @Get("/recent-runs")
  async recentRuns(@AuthRawUser() _user: User) {
    return { items: recentRunItems(await loadStatsContext(), TRACE_URL) };
  }

  @Get("/procedures")
  async procedures(@AuthRawUser() _user: User) {
    return { items: procedureCounts(await loadStatsContext(), PROCEDURES_URL) };
  }

  @Get("/triggers")
  async triggers(@AuthRawUser() _user: User) {
    return { items: triggerCounts(await loadStatsContext()) };
  }
}
