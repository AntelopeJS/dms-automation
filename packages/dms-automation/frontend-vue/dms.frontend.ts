import { defineAsyncComponent, type Component } from "vue";
import type { DmsFrontendModule } from "#dms/frontend-module";
import cellDisplaysPlugin from "./app/plugins/cell-displays";

interface VueModule {
  default: Component;
}

const components = import.meta.glob<VueModule>("./app/components/**/*.vue");

/**
 * Registers every component under `componentPrefix`: GraphEditor.vue registers
 * as DmsAutomationGraphEditor, which the backend names `dms-automation-graph-editor`.
 */
const frontendModule: DmsFrontendModule = {
  componentPrefix: "DmsAutomation",
  setup(sdk) {
    Object.entries(components)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([path, loader]) => {
        const name = path.replace(/^.*\//, "").replace(/\.vue$/, "");
        sdk.registerComponent(name, defineAsyncComponent(loader));
      });
    sdk.registerPlugin(cellDisplaysPlugin);
  },
};

export default frontendModule;
