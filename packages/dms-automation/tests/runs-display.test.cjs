const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("the run history uses the DMS grouped display, by day, counted", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = RunsPageController.table._options;
  assert.deepEqual(options.displays, [
    {
      id: "grouped",
      options: { groupByField: "startedAt", by: "day", count: true },
    },
  ]);
  assert.equal(options.defaultDisplay, "grouped");
});

test("a run opens in a drawer, deep linked, and re-runs with its payload", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const [peek, rerun, trace] =
    RunsPageController.table._options.rowActions.custom;
  assert.equal(peek.isDefault, true);
  assert.equal(peek.deepLink, true);
  assert.equal(peek.target.type, "drawer");
  assert.equal(rerun.target.url, "/api/automation/runs/{_id}/rerun");
  assert.ok(rerun.confirm, "re-running asks first");
  assert.equal(trace.target.url, "/modules/automation/trace?run={_id}");
});

test("the frontend registers the module's cell displays from a universal plugin", () => {
  const entry = fs.readFileSync(
    path.resolve(__dirname, "../frontend-vue/dms.frontend.ts"),
    "utf8",
  );
  assert.match(entry, /componentPrefix: "DmsAutomation"/);
  assert.match(entry, /sdk\.registerPlugin\(cellDisplaysPlugin\);/);
  const plugin = fs.readFileSync(
    path.resolve(__dirname, "../frontend-vue/app/plugins/cell-displays.ts"),
    "utf8",
  );
  for (const id of [
    "automation:last-runs",
    "automation:trigger",
    "automation:step",
  ]) {
    assert.match(plugin, new RegExp(`id: "${id}"`));
  }
  const {
    LastRunsDisplay,
    TriggerDisplay,
    StepDisplay,
  } = require("../dist/displays/index.js");
  assert.ok(LastRunsDisplay && TriggerDisplay && StepDisplay);
});
