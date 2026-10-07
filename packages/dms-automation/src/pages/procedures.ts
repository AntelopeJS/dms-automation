import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { ProceduresTableAPI } from "../data/procedures-table";
import {
  API_URL,
  BUILDER_URL,
  importProcedureButton,
  newProcedureButton,
  RUNS_URL,
} from "./shared";
import "./category";

function stateTab(state: string, icon: string, navBadge = false) {
  return {
    id: state,
    label: `$dms_automation.procedures.status.${state}`,
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
  },
  DefaultLayout({
    headerActions: [importProcedureButton(), newProcedureButton()],
  }),
) {
  static table = TableView(ProceduresTableAPI, {
    caption: "$dms_automation.procedures.listTitle",
    labelKey: "name",
    rowIdKey: "procedureId",
    searchPlaceholder: "$dms_automation.procedures.search",
    tabs: [
      // The failing tab publishes its count as the menu badge of the page.
      stateTab("failing", "i-ph-x-circle", true),
      stateTab("degraded", "i-ph-warning"),
      stateTab("healthy", "i-ph-check-circle"),
      stateTab("paused", "i-ph-pause-circle"),
      stateTab("draft", "i-ph-pencil-simple-line"),
    ],
    footer: { hint: "$dms_automation.procedures.footerHint" },
    emptyStates: {
      firstRun: {
        title: "$dms_automation.procedures.empty",
        description: "$dms_automation.procedures.emptyHint",
        icon: "i-ph-flow-arrow",
      },
      filtered: {
        title: "$dms_automation.procedures.emptyFiltered",
        description: "$dms_automation.procedures.emptyFilteredHint",
        icon: "i-ph-check-circle",
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
      details: true,
      hasSelection: false,
      delete: {
        isEnabled: true,
        confirm: { from: `${API_URL}/procedures/{procedureId}/delete-confirm` },
      },
      custom: [
        {
          label: "$dms_automation.procedures.runNow",
          icon: "i-ph-play",
          rule: { field: "status", notIn: ["draft"] },
          target: {
            type: "api",
            url: `${API_URL}/procedures/{procedureId}/run-now`,
            method: "POST",
            successMessage: "$dms_automation.procedures.runStarted",
          },
          confirm: {
            title: "$dms_automation.procedures.runNowConfirmTitle",
            description: "$dms_automation.procedures.runNowConfirmDescription",
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
            url: `${API_URL}/procedures/{procedureId}/enabled`,
            method: "PUT",
            body: { enabled: false },
            successMessage: "$dms_automation.procedures.paused",
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
            url: `${API_URL}/procedures/{procedureId}/enabled`,
            method: "PUT",
            body: { enabled: true },
            successMessage: "$dms_automation.procedures.resumed",
          },
        },
        {
          label: "$dms_automation.procedures.viewRuns",
          icon: "i-ph-list-bullets",
          target: {
            type: "page",
            url: `${RUNS_URL}?filter_procedureId=is:{procedureId}`,
          },
        },
      ],
    },
  });
}
