import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { ActivityFeed } from "@antelopejs/interface-dms/base/activity-feed";
import { Banner } from "@antelopejs/interface-dms/base/banner";
import { ChartColumn } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KeyValueList } from "@antelopejs/interface-dms/base/key-value-list";
import { KpiCard } from "@antelopejs/interface-dms/base/kpi-card";
import { ButtonVariant } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import {
  API_URL,
  BUILDER_URL,
  newProcedureButton,
  periodSwitch,
  PROCEDURES_URL,
  RUNS_URL,
  TRACE_URL,
} from "./shared";
import "./category";

const SCOPE = "automation-overview";
const STATS_URL = `${API_URL}/stats`;

function kpi(metric: string, icon: string, invert = false) {
  return KpiCard({
    title: `$dms_automation.kpi.${metric}`,
    variant: "stat",
    icon,
    fetchUrl: `${STATS_URL}/kpi/${metric}`,
    periodScope: SCOPE,
    showDelta: true,
    showSparkline: true,
    sparklineAccent: "auto",
    invert,
    compareLabel: "$dms_automation.kpi.vsPrevious",
    valueFormat: metric === "success-rate" ? "percent" : "number",
    valuePrecision: metric === "duration-p95" ? 1 : undefined,
  });
}

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
  static period = periodSwitch(SCOPE);

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

  static kpis = Grid({ gap: "1rem", minColumnWidth: "220px" }).child(
    "row",
    GridRow()
      .child("successRate", kpi("success-rate", "i-ph-check-circle"))
      .child("runs", kpi("runs", "i-ph-play-circle"))
      .child("failed", kpi("failed", "i-ph-x-circle", true))
      .child("durationP95", kpi("duration-p95", "i-ph-timer", true)),
  );

  static activity = Grid({ gap: "1rem", minColumnWidth: "420px" }).child(
    "row",
    GridRow()
      .child(
        "attention",
        CustomComponent("dms-automation-attention-list")
          .options({
            fetchUrl: `${STATS_URL}/attention`,
            proceduresUrl: PROCEDURES_URL,
            builderUrl: BUILDER_URL,
            traceUrl: TRACE_URL,
            runsUrl: RUNS_URL,
            apiUrl: API_URL,
          })
          .meta({
            name: "$dms_automation.permissions.attention.name",
            description: "$dms_automation.permissions.attention.description",
            icon: "i-ph-warning-circle",
          }),
      )
      .child(
        "runsPerDay",
        ChartCard({
          title: "$dms_automation.overview.runsPerDay",
          icon: "i-ph-chart-bar",
          fetchUrl: `${STATS_URL}/runs-per-day`,
          periodScope: SCOPE,
          showLegend: true,
          chart: ChartColumn({
            stacked: true,
            height: "220px",
            xaxisType: "datetime",
            color: ["success", "error"],
            roundedCorners: true,
          }),
        }),
      ),
  );

  static summary = Grid({ gap: "1rem", minColumnWidth: "320px" }).child(
    "row",
    GridRow()
      .child(
        "recentRuns",
        ActivityFeed({
          title: "$dms_automation.overview.recentRuns",
          fetchUrl: `${STATS_URL}/recent-runs`,
          groupByDay: false,
          maxItems: 8,
          skeletonCount: 6,
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
          title: "$dms_automation.overview.procedures",
          fetchUrl: `${STATS_URL}/procedures`,
          skeletonCount: 4,
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
