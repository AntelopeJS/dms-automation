import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { RunsTableAPI } from "../data/runs-table";
import "./category";

@RegisterPage()
export class RunsPageController extends PageController(
  "runs",
  {
    urlSlug: "runs",
    displayName: "$dms_automation.runs.title",
    description: "$dms_automation.runs.description",
    icon: "i-ph-list-bullets",
    module: "automation",
    order: 4,
  },
  DefaultLayout({ fullWidth: true }),
) {
  // Header + KPI stat cards live OUTSIDE the TableView as their own page
  // component (rendered above it). The TableView below is purely the run list.
  static stats = CustomComponent("dms-automation-runs-stats");

  static table = TableView(RunsTableAPI, {
    // Section title shown in the TableView header (left of the toolbar icons).
    caption: "$dms_automation.runs.listTitle",
    labelKey: "procedureId",
    rowIdKey: "_id",
    defaultSort: { field: "startedAt", desc: true },
    // Native status tabs (dms prepends its own translated "All"). Labels go
    // through dms i18n; these plain (non-`$`-prefixed) strings pass through
    // unchanged.
    tabs: [
      {
        id: "ok",
        label: "Success",
        icon: "i-ph-check-circle",
        filters: [{ accessorKey: "status", value: "ok", mode: "is" }],
      },
      {
        id: "failed",
        label: "Failed",
        icon: "i-ph-x-circle",
        filters: [{ accessorKey: "status", value: "failed", mode: "is" }],
      },
    ],
    rowActions: {
      // Run history is read-only. Trace/Replay are NOT declared as native row
      // actions: the page only offers the custom "timeline" display, which never
      // surfaces the grid's per-row menu and instead renders its own Trace
      // (drawer) and Replay buttons — the latter refreshing the list after the
      // POST.
      add: false,
      edit: false,
      duplicate: false,
      copyLink: false,
      details: false,
      delete: false,
      hasSelection: false,
    },
    // The list itself is rendered by the custom "timeline" display (registered
    // client-side); the TableView owns tabs/filters/search/export/pagination.
    // The native funnel filter is enabled: procedureId is a filter-only
    // RelationType (dms 0.1.1), so its filter is the dynamic relation picker while
    // the row keeps the raw ids the timeline needs.
    displays: [{ id: "timeline" }],
    defaultDisplay: "timeline",
  });
}
