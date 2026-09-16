import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import "./category";

@RegisterPage()
export class LibraryPageController extends PageController(
  "library",
  {
    urlSlug: "library",
    displayName: "$dms_automation.library.title",
    description: "$dms_automation.library.description",
    icon: "i-ph-package",
    module: "automation",
    order: 3,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static list = CustomComponent("dms-automation-library");
}
