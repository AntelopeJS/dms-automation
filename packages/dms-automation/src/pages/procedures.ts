import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { ProceduresTableAPI } from "../data/procedures-table";
import "./category";

@RegisterPage()
export class ProceduresPageController extends PageController(
  "procedures",
  {
    urlSlug: "procedures",
    displayName: "$dms_automation.procedures.title",
    description: "$dms_automation.procedures.description",
    icon: "i-ph-flow-arrow",
    module: "automation",
    order: 1,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(ProceduresTableAPI, {
    caption: "$dms_automation.procedures.title",
    labelKey: "name",
    rowIdKey: "procedureId",
    defaultSort: { field: "lastRunAt", desc: true },
    customButtons: [
      {
        label: "$dms_automation.procedures.newProcedure",
        icon: "i-ph-plus",
        color: "primary",
        target: { type: "page", url: "/modules/automation/builder" },
      },
    ],
    // Procedures aren't form-editable (the graph is built in the visual
    // Builder), so the auto-generated read-only view sub-page is useless.
    // Redirect the `details` navigation (row click + row-menu entry) to the
    // Builder instead: `customPage` skips registering the generated view
    // sub-page, and the absolute urlSlug is used verbatim by the frontend
    // with `:id` substituted.
    formContainer: {
      type: "page",
      pages: {
        view: {
          urlSlug: "/modules/automation/builder?selected=:id",
          customPage: true,
        },
        new: { customPage: true },
        edit: { customPage: true },
      },
    },
    rowActions: {
      // Disable the native add/edit/duplicate/copy-link actions and keep only
      // delete plus the custom run action. `details` stays on: it now opens the
      // Builder (see formContainer above), and it's also what makes the
      // TableView apply the standard full-row hover highlight (the UTable only
      // enables it when details or edit is enabled).
      add: false,
      edit: false,
      duplicate: false,
      copyLink: false,
      details: true,
      delete: true,
      hasSelection: false,
      custom: [
        {
          label: "$dms_automation.procedures.runNow",
          icon: "i-ph-play",
          target: {
            type: "api",
            url: "/api/automation/procedures/{procedureId}/run",
            method: "POST",
            successMessage: "$dms_automation.procedures.runStarted",
          },
        },
      ],
    },
  });
}
