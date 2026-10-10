import {
  Controller,
  Get,
  HTTPResult,
  Parameter,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  loadStatsContext,
  type PeriodQuery,
  type StatsWindow,
  windowOf,
} from "../db/models/stats.model";
import {
  PROCEDURES_URL,
  recipeActions,
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

/** The earliest date a window (and its comparison) reaches back to. */
function earliestOf(window: StatsWindow): Date {
  return window.compareFrom && window.compareFrom < window.from
    ? window.compareFrom
    : window.from;
}

/**
 * A KPI card's payload for one metric over a period: shared by the overview
 * and the run history, which ask for the same figures.
 */
export async function kpiAnswer(metric: string, query: PeriodQuery) {
  if (!isKpiMetric(metric)) {
    throw new HTTPResult(404, { error: `unknown metric "${metric}"` });
  }
  const window = windowOf(query);
  const ctx = await loadStatsContext(earliestOf(window));
  return kpiPayload(metric, ctx.runs, window);
}

// Every figure counts production runs only: test runs from the builder never
// move a KPI or a procedure's state.
@AuthOwnerOnly()
export class StatsController extends Controller("/api/automation/stats") {
  @Get("/health")
  // oxlint-disable-next-line eslint/max-params -- one decorator per query input
  async health(
    @AuthRawUser() _user: User,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
  ) {
    const window = windowOf({ from, to });
    const hero = healthHero(await loadStatsContext(earliestOf(window)), window);
    return healthBanner(hero, {
      runsUrl: RUNS_URL,
      traceUrl: TRACE_URL,
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
  ) {
    return kpiAnswer(metric, { from, to, compareFrom, compareTo });
  }

  @Get("/runs-per-day")
  // oxlint-disable-next-line eslint/max-params -- one decorator per query input
  async runsPerDay(
    @AuthRawUser() _user: User,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
  ) {
    const window = windowOf({ from, to, compareFrom, compareTo });
    return runsPerDayChart(await loadStatsContext(earliestOf(window)), window);
  }

  @Get("/attention")
  async attention(@AuthRawUser() _user: User) {
    return { items: attentionRows(await loadStatsContext()) };
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
