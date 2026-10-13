import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { API_URL, RUNS_URL, TRACE_URL } from "./shared";
import "./category";

/**
 * The procedure editor. It is one tool, so it fills the panel and draws its
 * own bar in place of the page header.
 */
@RegisterPage()
export class BuilderPageController extends PageController(
  "builder",
  {
    urlSlug: "builder",
    displayName: "$dms_automation.builder.title",
    description: "$dms_automation.builder.description",
    icon: "i-ph-tree-structure",
    module: "automation",
    order: 4,
  },
  DefaultLayout({ fullWidth: true, fillHeight: true, hideHeader: true }),
) {
  static editor = CustomComponent("dms-automation-editor")
    .options({ apiUrl: API_URL, runsUrl: RUNS_URL, traceUrl: TRACE_URL })
    .meta({
      name: "$dms_automation.permissions.editor.name",
      description: "$dms_automation.permissions.editor.description",
      icon: "i-ph-tree-structure",
    });
}
