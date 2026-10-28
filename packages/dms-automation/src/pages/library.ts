import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { Tab, TabVariant } from "@antelopejs/interface-dms/base/tab";
import { API_URL, BUILDER_URL } from "./shared";
import "./category";

/** A template was created, changed or deleted: the tab counts change. */
export const TEMPLATES_TOPIC = "automation.templates";

type CatalogKind = "triggers" | "actions" | "dataNodes" | "flow";

/** The builder palette's group icons, so a block family reads the same in both. */
const CATALOG_ICONS: Record<CatalogKind, string> = {
  triggers: "i-ph-lightning",
  actions: "i-ph-gear",
  dataNodes: "i-ph-function",
  flow: "i-ph-git-fork",
};

/**
 * One catalog of the library: its entries grouped by the module that
 * registered them, and the detail of the picked one, with where it is used.
 */
function catalog(
  kind: CatalogKind,
  meta: { name: string; description: string },
) {
  return CustomComponent("dms-automation-catalog")
    .options({ kind, apiUrl: API_URL, builderUrl: BUILDER_URL })
    .meta({ ...meta, icon: CATALOG_ICONS[kind] });
}

function registryCatalog(kind: Exclude<CatalogKind, "flow">) {
  return catalog(kind, {
    name: `$dms_automation.permissions.catalog.${kind}`,
    description: `$dms_automation.permissions.catalog.${kind}Description`,
  });
}

function tabItem(
  slot: string,
  icon: string,
  label = `$dms_automation.library.tabs.${slot}`,
) {
  return { label, icon, slot, badge: "…" };
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
      tabItem("flow", CATALOG_ICONS.flow, "$dms_automation.library.flowTab"),
    ],
    badgesUrl: `${API_URL}/library/counts`,
    realtimeTopic: TEMPLATES_TOPIC,
    variant: TabVariant.link,
    persistState: true,
    stateKey: "tab",
  })
    .child("triggers", registryCatalog("triggers"), { slot: "triggers" })
    .child("actions", registryCatalog("actions"), { slot: "actions" })
    .child("dataNodes", registryCatalog("dataNodes"), { slot: "dataNodes" })
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
    )
    .child(
      "flow",
      catalog("flow", {
        name: "$dms_automation.permissions.catalog.flow",
        description: "$dms_automation.permissions.catalog.flowDescription",
      }),
      { slot: "flow" },
    );
}
