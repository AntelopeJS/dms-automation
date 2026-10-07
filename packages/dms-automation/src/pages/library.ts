import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { Tab, TabVariant } from "@antelopejs/interface-dms/base/tab";
import { API_URL, BUILDER_URL } from "./shared";
import "./category";

type CatalogKind = "triggers" | "actions" | "dataNodes";

const CATALOG_ICONS: Record<CatalogKind, string> = {
  triggers: "i-ph-lightning",
  actions: "i-ph-play-circle",
  dataNodes: "i-ph-function",
};

/**
 * One catalog of the library: its entries grouped by the module that
 * registered them, and the detail of the picked one, with where it is used.
 */
function catalog(kind: CatalogKind) {
  return CustomComponent("dms-automation-catalog")
    .options({ kind, apiUrl: API_URL, builderUrl: BUILDER_URL })
    .meta({
      name: `$dms_automation.permissions.catalog.${kind}`,
      description: `$dms_automation.permissions.catalog.${kind}Description`,
      icon: CATALOG_ICONS[kind],
    });
}

function tabItem(slot: string, icon: string) {
  return {
    label: `$dms_automation.library.tabs.${slot}`,
    icon,
    slot,
    badge: "…",
  };
}

@RegisterPage()
export class LibraryPageController extends PageController(
  "library",
  {
    urlSlug: "library",
    displayName: "$dms_automation.library.title",
    description: "$dms_automation.library.description",
    icon: "i-ph-package",
    module: "automation",
    order: 5,
  },
  DefaultLayout(),
) {
  static catalogs = Tab({
    items: [
      tabItem("triggers", CATALOG_ICONS.triggers),
      tabItem("actions", CATALOG_ICONS.actions),
      tabItem("dataNodes", CATALOG_ICONS.dataNodes),
      tabItem("templates", "i-ph-stack"),
    ],
    badgesUrl: `${API_URL}/library/counts`,
    variant: TabVariant.link,
    persistState: true,
    stateKey: "tab",
  })
    .child("triggers", catalog("triggers"), { slot: "triggers" })
    .child("actions", catalog("actions"), { slot: "actions" })
    .child("dataNodes", catalog("dataNodes"), { slot: "dataNodes" })
    .child(
      "templates",
      CustomComponent("dms-automation-templates")
        .options({ apiUrl: API_URL, builderUrl: BUILDER_URL })
        .meta({
          name: "$dms_automation.permissions.templates.name",
          description: "$dms_automation.permissions.templates.description",
          icon: "i-ph-stack",
        }),
      { slot: "templates" },
    );
}
