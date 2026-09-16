import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import "./category";

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
  DefaultLayout(),
) {
  static list = CustomComponent("dms-automation-overview");
}
