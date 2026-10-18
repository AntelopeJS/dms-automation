import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { pageToolbar } from "@antelopejs/interface-dms/base/page-toolbar";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { ProceduresTableAPI } from "../data/procedures-table";
import {
  API_URL,
  BUILDER_URL,
  importProcedureButton,
  newProcedureButton,
  RUNS_URL,
  TRACE_URL,
} from "./shared";
import "./category";

/**
 * Shortest interval, in seconds, between two reads of the list while runs
 * land: each run can move a procedure from one state to another.
 */
const LIVE_MAX_RATE = 10;

function stateTab(state: string, icon: string, navBadge = false) {
  return {
    id: state,
    label: `$dms_automation.procedures.tabs.${state}`,
    icon,
    filter: { accessorKey: "status", value: state, mode: "is" },
    navBadge,
  };
}

@RegisterPage()
export class ProceduresPageController extends PageController(
  "procedures",
  {
    urlSlug: "procedures",
    displayName: "$dms_automation.procedures.title",
    description: "$dms_automation.procedures.description",
    icon: "i-ph-flow-arrow",
    module: "automation",
    order: 3,
    live: { maxRate: LIVE_MAX_RATE },
  },
  DefaultLayout({
    headerActions: [importProcedureButton(), newProcedureButton()],
  }),
) {
  // "Updated 12 s ago" with its Live / Pause: the list follows its realtime
  // topics, and a pause holds it still while reading.
  static toolbar = pageToolbar({ period: false }).meta({
    name: "$dms_automation.permissions.live.name",
    description: "$dms_automation.permissions.live.description",
    icon: "i-ph-broadcast",
  });

  static table = TableView(ProceduresTableAPI, {
    // The tab says which procedures are listed, the counter how many.
    caption: "$dms_automation.procedures.title",
    labelKey: "name",
    rowIdKey: "procedureId",
    searchPlaceholder: "$dms_automation.procedures.search",
    quickFilters: [{ field: "triggerTypes", icon: "i-ph-lightning" }],
    // The states move with every run and every change of a procedure.
    realtimeTopic: ["automation.procedures", "automation.runs"],
    tabs: [
      // The failing tab publishes its count as the menu badge of the page.
      stateTab("failing", "i-ph-x-circle", true),
      stateTab("degraded", "i-ph-warning"),
      stateTab("healthy", "i-ph-check-circle"),
      stateTab("paused", "i-ph-pause-circle"),
      stateTab("draft", "i-ph-pencil-simple-line"),
    ],
    footer: {
      countLabel: "$dms_automation.procedures.count",
      hint: "$dms_automation.procedures.openHint",
    },
    emptyStates: {
      firstRun: {
        title: "$dms_automation.procedures.empty",
        description: "$dms_automation.procedures.emptyHint",
        icon: "i-ph-flow-arrow",
      },
      filtered: {
        title: "$dms_automation.procedures.noMatch",
        description: "$dms_automation.procedures.noMatchHint",
        icon: "i-ph-magnifying-glass",
      },
    },
    // Procedures are built in the builder, not in a form: a row opens it.
    formContainer: {
      type: "page",
      pages: {
        details: {
          urlSlug: `${BUILDER_URL}?selected=:id`,
          customPage: true,
        },
        new: { customPage: true },
        edit: { customPage: true },
      },
    },
    rowActions: {
      add: false,
      edit: false,
      duplicate: false,
      copyLink: false,
      details: { label: "$dms_automation.procedures.openInBuilder" },
      hasSelection: false,
      delete: {
        isEnabled: true,
        confirm: {
          from: `${API_URL}/procedures/{{row.procedureId}}/delete-confirm`,
        },
      },
      custom: [
        {
          label: "$dms_automation.procedures.runNow",
          icon: "i-ph-play",
          rule: { field: "status", notIn: ["draft"] },
          target: {
            type: "api",
            url: `${API_URL}/procedures/{{row.procedureId}}/run-now`,
            method: "POST",
            successMessage: "$dms_automation.procedures.runFinished",
          },
          confirm: {
            title: "$dms_automation.procedures.runNowConfirmTitle",
            description: "$dms_automation.procedures.runNowConfirmHint",
            icon: "i-ph-play",
            color: "warning",
            confirmLabel: "$dms_automation.procedures.runNow",
          },
        },
        {
          label: "$dms_automation.procedures.pause",
          icon: "i-ph-pause",
          rule: { field: "enabled", equals: true },
          target: {
            type: "api",
            url: `${API_URL}/procedures/{{row.procedureId}}/enabled`,
            method: "PUT",
            body: { enabled: false },
            successMessage: "$dms_automation.procedures.pausedNamed",
          },
        },
        {
          label: "$dms_automation.procedures.resume",
          icon: "i-ph-play-circle",
          rule: {
            and: [
              { field: "enabled", equals: false },
              { field: "status", notEquals: "draft" },
            ],
          },
          target: {
            type: "api",
            url: `${API_URL}/procedures/{{row.procedureId}}/enabled`,
            method: "PUT",
            body: { enabled: true },
            successMessage: "$dms_automation.procedures.resumedNamed",
          },
        },
        {
          label: "$dms_automation.procedures.openLastRun",
          icon: "i-ph-path",
          rule: { field: "lastRunId", notEquals: null },
          target: { type: "page", url: `${TRACE_URL}?run={{row.lastRunId}}` },
        },
        {
          label: "$dms_automation.procedures.viewRuns",
          icon: "i-ph-list-bullets",
          target: {
            type: "page",
            url: `${RUNS_URL}?procedure={{row.procedureId}}`,
          },
        },
        {
          label: "$dms_automation.procedures.duplicate",
          icon: "i-ph-copy",
          target: {
            type: "api",
            url: `${API_URL}/procedures/{{row.procedureId}}/duplicate`,
            method: "POST",
            successMessage: "$dms_automation.procedures.duplicated",
          },
        },
      ],
    },
  });
}
