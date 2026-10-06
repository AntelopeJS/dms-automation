import { defineDmsPlugin } from "#dms/frontend-module";
import RunsTimelineDisplay from "../components/RunsTimelineDisplay.vue";

// Registers the "automation:timeline" TableView display used by the Runs page
// (src/pages/runs.ts declares it in `displays`). Module displays are named
// `<module>:<id>`: the DMS reserves the built-in ids. A universal plugin, so the
// server render draws the display and hydration finds it in place.
// `registerTableViewDisplay` is auto-imported from the dms-ui layer.
export default defineDmsPlugin(() => {
  registerTableViewDisplay({
    id: "automation:timeline",
    label: "dms_automation.runs.display.timeline",
    icon: "i-ph-list-bullets",
    order: 10,
    component: RunsTimelineDisplay,
  });
});
