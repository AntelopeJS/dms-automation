import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { Banner } from "@antelopejs/interface-dms/base/banner";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { LiveToggle } from "@antelopejs/interface-dms/base/live-toggle";
import { HStack } from "@antelopejs/interface-dms/base/stack";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { RunsTableAPI } from "../data/runs-table";
import { RUNS_TOPIC } from "../realtime";
import { DEFAULT_RETENTION_DAYS, runsKeptDays } from "../runtime/retention";
import {
  API_URL,
  BUILDER_URL,
  kpiRow,
  liveTopics,
  periodSwitch,
  RUNS_PERIOD_SCOPE,
  TRACE_URL,
} from "./shared";
import "./category";

/**
 * Shortest interval, in seconds, between two reads of one block of the live
 * page, however many runs land.
 */
const LIVE_MAX_RATE = 10;

/**
 * How long runs are kept, as the project configures it. The footer hint is a
 * bare i18n key (no parameters): the default period and "forever" are said
 * outright, any other period in general terms.
 */
function retentionHint(): string {
  const days = runsKeptDays();
  if (days <= 0) return "$dms_automation.runs.retentionForever";
  return days === DEFAULT_RETENTION_DAYS
    ? "$dms_automation.runs.retentionHint"
    : "$dms_automation.runs.retentionConfigured";
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
    live: { maxRate: LIVE_MAX_RATE },
  },
  DefaultLayout(),
) {
  // "Live · updated 12 s ago" with its pause; a stored run reads the KPIs and
  // the list again.
  static live = HStack()
    .child("toggle", LiveToggle({ align: "left" }))
    .child("topics", liveTopics([RUNS_TOPIC]));

  static period = periodSwitch(RUNS_PERIOD_SCOPE);

  static kpis = kpiRow(RUNS_PERIOD_SCOPE, { fetchUrl: `${API_URL}/runs/kpi` });

  // Opened on one procedure (the "View runs" links): which one, and the way
  // back to every run.
  static scope = Banner({
    fetchUrl: `${API_URL}/runs/scope/banner?procedure={{query.procedure}}`,
  });

  static table = TableView(RunsTableAPI, {
    caption: "$dms_automation.runs.listTitle",
    labelKey: "_id",
    rowIdKey: "_id",
    defaultSort: { field: "startedAt", desc: true },
    searchPlaceholder: "$dms_automation.runs.searchRuns",
    // `?procedure=<id>` lists the runs of one procedure (see `scope`).
    queryParamFilters: { procedure: { field: "procedureId", mode: "is" } },
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
    // One click opens the run in a drawer over the list, like a log.
    rowClick: "single",
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
      // Named after the procedure rather than the run's id.
      menuLabel: "$dms_automation.runs.rowMenu",
      custom: [
        {
          label: "$dms_automation.runs.peek",
          icon: "i-ph-sidebar-simple",
          isDefault: true,
          deepLink: true,
          target: {
            // A detail panel: a right drawer, resizable and opened again at
            // the user's width, carrying the row header and J / K.
            type: "drawer",
            direction: "right",
            title: "$dms_automation.runs.peekTitle",
            // Named after the run's procedure, as the row menu is.
            rowTitle: "$dms_automation.runs.peekHeading",
            positionLabel: "$dms_automation.runs.peekPosition",
            deepLink: true,
            // A `?record=` link to a run the retention has deleted since.
            notFound: {
              title: "$dms_automation.runs.peekNotFound",
              description: "$dms_automation.runs.peekNotFoundHint",
            },
            component: runPeek,
          },
        },
        {
          label: "$dms_automation.runs.rerun",
          icon: "i-ph-arrow-clockwise",
          isVisible: true,
          target: {
            type: "api",
            url: `${API_URL}/runs/{{row._id}}/rerun`,
            method: "POST",
            successMessage: "$dms_automation.runs.rerunStarted",
          },
          // Worded for the run: a test, a paused procedure, redacted
          // headers, or why it cannot be re-run.
          confirm: { from: `${API_URL}/runs/{{row._id}}/rerun-confirm` },
        },
        {
          label: "$dms_automation.runs.trace",
          icon: "i-ph-path",
          isVisible: true,
          target: { type: "page", url: `${TRACE_URL}?run={{row._id}}` },
        },
      ],
    },
  }).transformOptions((options) =>
    options?.footer
      ? { ...options, footer: { ...options.footer, hint: retentionHint() } }
      : options,
  );
}
