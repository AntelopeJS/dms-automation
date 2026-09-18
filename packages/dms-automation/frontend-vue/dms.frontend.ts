import { defineAsyncComponent, type Component } from "vue";
import type { DmsFrontendModule } from "#dms/frontend-module";
import timelinePlugin from "./app/plugins/runs-timeline-display.client";

interface VueModule {
  default: Component;
}

const components = import.meta.glob<VueModule>("./app/components/**/*.vue");

const frontendModule: DmsFrontendModule = {
  setup(sdk) {
    Object.entries(components)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([path, loader]) => {
        const name = `DmsAutomation${path
          .split("/")
          .at(-1)!
          .replace(/\.vue$/, "")}`;
        sdk.registerComponent(name, defineAsyncComponent(loader));
      });
    sdk.registerPlugin(timelinePlugin, { clientOnly: true });
  },
};

export default frontendModule;
