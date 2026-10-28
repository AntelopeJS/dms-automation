import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { ActivityFeed } from "@antelopejs/interface-dms/base/activity-feed";
import { Banner } from "@antelopejs/interface-dms/base/banner";
import { ChartColumn } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KeyValueList } from "@antelopejs/interface-dms/base/key-value-list";
import { ButtonVariant } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { pageToolbar } from "@antelopejs/interface-dms/base/page-toolbar";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PROCEDURES_TOPIC, RUNS_TOPIC } from "../realtime";
import { PROCEDURE_COUNT_LINES, RECENT_RUNS } from "../stats/overview";
import {
  API_URL,
  LIVE_TOOLBAR_META,
  liveTopics,
  toolbarPeriod,
  BUILDER_URL,
  kpiRow,
  newProcedureButton,
  PROCEDURES_URL,
  RUNS_URL,
  TRACE_URL,
} from "./shared";
import "./category";

const SCOPE = "automation-overview";
const STATS_URL = `${API_URL}/stats`;

/**
 * Shortest interval, in seconds, between two reads of one block: the first
 * event of a quiet page reads at once, a burst of runs reads once per
 * interval, and the page reads on this clock while the stream is down.
 */
const LIVE_MAX_RATE = 10;

/** "Needs attention": degraded over the period, failing and paused now. */
const attentionList = CustomComponent("dms-automation-attention-list")
  .options({
    fetchUrl: `${STATS_URL}/attention`,
    periodScope: SCOPE,
    proceduresUrl: PROCEDURES_URL,
    builderUrl: BUILDER_URL,
    traceUrl: TRACE_URL,
    apiUrl: API_URL,
  })
  .meta({
    name: "$dms_automation.permissions.attention.name",
    description: "$dms_automation.permissions.attention.description",
    icon: "i-ph-warning-circle",
  });

@RegisterPage()
export class OverviewPageController extends PageController(
  "overview",
  {
    urlSlug: "overview",
    displayName: "$dms_automation.overview.title",
    description: "$dms_automation.overview.description",
    icon: "i-ph-gauge",
    module: "automation",
    order: 0,
    live: { maxRate: LIVE_MAX_RATE },
  },
  DefaultLayout({
    headerActions: [
      {
        id: "run-history",
        label: "$dms_automation.runs.title",
        icon: "i-ph-list-bullets",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "page", url: RUNS_URL },
      },
      newProcedureButton(),
    ],
  }),
) {
  /**
   * "Updated 12 s ago" with its Live / Pause, the period and the one before
   * it, and what keeps the page live: a run stored, a procedure changed.
   */
  static live = pageToolbar({
    leading: { topics: liveTopics([RUNS_TOPIC, PROCEDURES_TOPIC]) },
    live: { childId: "toggle" },
    period: toolbarPeriod(SCOPE),
  }).meta(LIVE_TOOLBAR_META);

  /**
   * One line saying how automation is doing, the next action, and the first
   * run recipes when nothing is built yet: a DMS banner the route words.
   */
  static health = Banner({
    fetchUrl: `${STATS_URL}/health`,
    periodScope: SCOPE,
  }).meta({
    name: "$dms_automation.permissions.health.name",
    description: "$dms_automation.permissions.health.description",
    icon: "i-ph-heartbeat",
  });

  static kpis = kpiRow(SCOPE, {
    fetchUrl: `${STATS_URL}/kpi`,
    sparkline: true,
  });

  /**
   * The chart's legend names its series: succeeded, failed, and the
   * dashed runs of the compared period. The card's own legend would
   * key "Period" in one colour, which stacked bars do not have.
   *
   * Shown when the runs kept do not reach back to the compared
   * period, which then has no change: the line under the total stays,
   * where the skeleton held it.
   */
  static activity = Grid({ gap: "1rem", minColumnWidth: "420px" }).child(
    "row",
    GridRow()
      .child("attention", attentionList)
      .child(
        "runsPerDay",
        ChartCard({
          title: "$dms_automation.overview.runsPerDay",
          icon: "i-ph-chart-bar",
          fetchUrl: `${STATS_URL}/runs-per-day`,
          periodScope: SCOPE,
          showLegend: false,
          showSeriesLegend: true,
          showDelta: true,
          description: "$dms_automation.overview.runsPerDayHint",
          chart: ChartColumn({
            stacked: true,
            height: "260px",
            xaxisType: "datetime",
            color: ["success", "error"],
            roundedCorners: true,
            rawOptions: [
              {
                key: "tooltip",
                value: JSON.stringify({
                  shared: true,
                  intersect: false,
                  marker: { show: true },
                  x: { format: "dd MMM, HH:mm" },
                }),
              },
            ],
          }),
        }),
      ),
  );

  /**
   * As many rows as the route sends: the skeleton holds the card's
   * height, and the row of cards around it.
   */
  static summary = Grid({ gap: "1rem", minColumnWidth: "320px" }).child(
    "row",
    GridRow()
      .child(
        "recentRuns",
        ActivityFeed({
          title: "$dms_automation.overview.recentRuns",
          fetchUrl: `${STATS_URL}/recent-runs`,
          groupByDay: false,
          maxItems: RECENT_RUNS,
          skeletonCount: RECENT_RUNS,
          card: true,
          actions: [
            { label: "$dms_automation.overview.allRuns", to: RUNS_URL },
          ],
          empty: {
            title: "$dms_automation.overview.noRuns",
            description: "$dms_automation.overview.noRunsHint",
          },
        }),
      )
      .child(
        "procedures",
        KeyValueList({
          title: "$dms_automation.overview.proceduresWeek",
          fetchUrl: `${STATS_URL}/procedures`,
          skeletonCount: PROCEDURE_COUNT_LINES,
          card: true,
        }),
      )
      .child(
        "triggers",
        TopListCard({
          title: "$dms_automation.overview.byTrigger",
          description: "$dms_automation.overview.byTriggerHint",
          fetchUrl: `${STATS_URL}/triggers`,
          showBar: true,
          showDelta: false,
          emptyLabel: "$dms_automation.overview.noTriggers",
        }),
      ),
  );
}
