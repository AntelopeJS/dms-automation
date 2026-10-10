import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { API_URL, BUILDER_URL, RUNS_URL, TRACE_URL } from "./shared";
import "./category";

/**
 * One run, linkable: its steps on a time line, where it failed and why, the
 * path it took, its payload and its log. Not in the menu: it is reached from a
 * run, `?run=<id>`.
 */
@RegisterPage()
export class TracePageController extends PageController(
  "trace",
  {
    urlSlug: "trace",
    displayName: "$dms_automation.trace.title",
    description: "$dms_automation.trace.description",
    icon: "i-ph-path",
    module: "automation",
    order: 2,
    hidden: true,
    validation: { requiredQueryParams: ["run"] },
  },
  DefaultLayout({ hideHeader: true }),
) {
  static trace = CustomComponent("dms-automation-run-trace")
    .options({
      apiUrl: API_URL,
      runsUrl: RUNS_URL,
      builderUrl: BUILDER_URL,
      traceUrl: TRACE_URL,
    })
    .meta({
      name: "$dms_automation.permissions.trace.name",
      description: "$dms_automation.permissions.trace.description",
      icon: "i-ph-path",
    });
}
