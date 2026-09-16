import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import "./category";

@RegisterPage()
export class BuilderPageController extends PageController(
  "builder",
  {
    urlSlug: "builder",
    displayName: "$dms_automation.builder.title",
    description: "$dms_automation.builder.description",
    icon: "i-ph-tree-structure",
    module: "automation",
    order: 2,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static list = CustomComponent("dms-automation-editor");
}
