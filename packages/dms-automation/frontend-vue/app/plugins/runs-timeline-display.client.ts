import { defineDmsPlugin } from "#dms-inertia/frontend-module";
import RunsTimelineDisplay from "../components/RunsTimelineDisplay.vue";

// Registers the "timeline" TableView display used by the Runs page
// (src/pages/runs.ts declares `displays: [{ id: 'timeline' }]`). Displays carry
// callables stripped from the SSR payload, so registration is client-only.
// `registerTableViewDisplay` is auto-imported from the dms-ui layer.
export default defineDmsPlugin(() => {
  registerTableViewDisplay({
    id: "timeline",
    label: "dms_automation.runs.display.timeline",
    icon: "i-ph-list-bullets",
    order: 10,
    component: RunsTimelineDisplay,
  });
});
