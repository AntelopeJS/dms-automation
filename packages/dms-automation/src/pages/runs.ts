import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KpiCard } from "@antelopejs/interface-dms/base/kpi-card";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { RunsTableAPI } from "../data/runs-table";
import { API_URL, BUILDER_URL, periodSwitch, TRACE_URL } from "./shared";
import "./category";

const SCOPE = "automation-runs";
const KPI_URL = `${API_URL}/runs/kpi`;

function kpi(metric: string, icon: string, invert = false) {
  return KpiCard({
    title: `$dms_automation.kpi.${metric}`,
    variant: "stat",
    icon,
    fetchUrl: `${KPI_URL}/${metric}`,
    periodScope: SCOPE,
    showDelta: true,
    invert,
    compareLabel: "$dms_automation.kpi.vsPrevious",
    valueFormat: metric === "success-rate" ? "percent" : "number",
    valuePrecision: metric === "duration-p95" ? 1 : undefined,
  });
}

/**
 * The quick look at a run, opened by a click on its row: what failed and
 * where, the payload, the log, and the next actions.
 */
const runPeek = CustomComponent("dms-automation-run-peek")
  .options({ apiUrl: API_URL, traceUrl: TRACE_URL, builderUrl: BUILDER_URL })
  .meta({
    name: "$dms_automation.permissions.runPeek.name",
    description: "$dms_automation.permissions.runPeek.description",
    icon: "i-ph-sidebar-simple",
  });

@RegisterPage()
export class RunsPageController extends PageController(
  "runs",
  {
    urlSlug: "runs",
    displayName: "$dms_automation.runs.title",
    description: "$dms_automation.runs.description",
    icon: "i-ph-list-bullets",
    module: "automation",
    order: 1,
  },
  DefaultLayout(),
) {
  static period = periodSwitch(SCOPE);

  static kpis = Grid({ gap: "1rem", minColumnWidth: "220px" }).child(
    "row",
    GridRow()
      .child("runs", kpi("runs", "i-ph-play-circle"))
      .child("successRate", kpi("success-rate", "i-ph-check-circle"))
      .child("failed", kpi("failed", "i-ph-x-circle", true))
      .child("durationP95", kpi("duration-p95", "i-ph-timer", true)),
  );

  static table = TableView(RunsTableAPI, {
    caption: "$dms_automation.runs.listTitle",
    labelKey: "_id",
    rowIdKey: "_id",
    defaultSort: { field: "startedAt", desc: true },
    searchPlaceholder: "$dms_automation.runs.search",
    tabs: [
      {
        id: "failed",
        label: "$dms_automation.runs.tabs.failed",
        icon: "i-ph-x-circle",
        filter: { accessorKey: "status", value: "failed", mode: "is" },
      },
      {
        id: "ok",
        label: "$dms_automation.runs.tabs.succeeded",
        icon: "i-ph-check-circle",
        filter: { accessorKey: "status", value: "ok", mode: "is" },
      },
      {
        id: "tests",
        label: "$dms_automation.runs.tabs.tests",
        icon: "i-ph-flask",
        filter: { accessorKey: "kind", value: "test", mode: "is" },
      },
    ],
    quickFilters: [
      {
        field: "procedureId",
        label: "$dms_automation.runs.cols.procedure",
        icon: "i-ph-flow-arrow",
      },
    ],
    grouped: { groupByField: "startedAt", by: "day", count: true },
    defaultDisplay: "grouped",
    pagination: "pages",
    pageSize: 25,
    footer: { hint: "$dms_automation.runs.retentionHint" },
    emptyStates: {
      firstRun: {
        title: "$dms_automation.runs.empty",
        description: "$dms_automation.runs.emptyHint",
        icon: "i-ph-list-bullets",
      },
    },
    rowActions: {
      add: false,
      edit: false,
      duplicate: false,
      copyLink: false,
      details: false,
      delete: false,
      hasSelection: false,
      custom: [
        {
          label: "$dms_automation.runs.peek",
          icon: "i-ph-sidebar-simple",
          isDefault: true,
          deepLink: true,
          target: {
            type: "drawer",
            title: "$dms_automation.runs.peekTitle",
            component: runPeek,
          },
        },
        {
          label: "$dms_automation.runs.rerun",
          icon: "i-ph-arrow-clockwise",
          isVisible: true,
          target: {
            type: "api",
            url: `${API_URL}/runs/{_id}/rerun`,
            method: "POST",
            successMessage: "$dms_automation.runs.rerunStarted",
          },
          confirm: {
            title: "$dms_automation.runs.rerunConfirmTitle",
            description: "$dms_automation.runs.rerunConfirmDescription",
            icon: "i-ph-arrow-clockwise",
            color: "warning",
            confirmLabel: "$dms_automation.runs.rerun",
          },
        },
        {
          label: "$dms_automation.runs.trace",
          icon: "i-ph-path",
          isVisible: true,
          target: { type: "page", url: `${TRACE_URL}?run={_id}` },
        },
      ],
    },
  });
}
