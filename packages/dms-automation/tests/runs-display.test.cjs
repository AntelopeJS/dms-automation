const assert = require("node:assert/strict");
const { test } = require("node:test");

test("the run history uses the DMS grouped display, by day, counted", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = RunsPageController.table._options;
  assert.deepEqual(
    options.displays.map((display) => display.id),
    ["table", "grouped"],
  );
  assert.deepEqual(options.displays[1].options, {
    groupByField: "startedAt",
    by: "day",
    count: true,
  });
  assert.equal(options.defaultDisplay, "grouped");
});

test("a run opens in the side panel on one click, deep linked, and re-runs with its payload", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const [peek, rerun, trace] =
    RunsPageController.table._options.rowActions.custom;
  assert.equal(peek.isDefault, true);
  assert.equal(peek.deepLink, true);
  assert.equal(peek.target.type, "sidePanel");
  assert.equal(peek.target.positionLabel, "$dms_automation.runs.peekPosition");
  assert.equal(peek.target.deepLink, true);
  // A link to a run the retention deleted says so in the panel.
  assert.deepEqual(peek.target.notFound, {
    title: "$dms_automation.runs.peekNotFound",
    description: "$dms_automation.runs.peekNotFoundHint",
  });
  // The row menu is named after the procedure, not the run's id.
  assert.equal(
    RunsPageController.table._options.rowActions.menuLabel,
    "$dms_automation.runs.rowMenu",
  );
  assert.equal(RunsPageController.table._options.rowClick, "single");
  assert.equal(rerun.target.url, "/api/automation/runs/{{row._id}}/rerun");
  // The server words the confirmation for the run (a test, a paused
  // procedure, redacted headers), or says why it cannot be re-run.
  assert.deepEqual(rerun.confirm, {
    from: "/api/automation/runs/{{row._id}}/rerun-confirm",
  });
  assert.equal(trace.target.url, "/modules/automation/trace?run={{row._id}}");
});

test("the trigger and failed-step cells are the DMS two_line display", () => {
  const { RunsTableAPI } = require("../dist/data/runs-table.js");
  const run = Object.create(RunsTableAPI.prototype, {
    triggerSummary: {
      value: {
        nodeId: "t1",
        typeId: "webhook",
        typeName: "$dms_automation.types.webhook.name",
        method: "POST",
        path: "/webhooks/stripe",
      },
    },
    failedStep: {
      value: { nodeId: "a1", typeName: "$dms_automation.types.http.name" },
    },
  });
  assert.equal(run.triggerText, "POST /webhooks/stripe");
  assert.equal(run.triggerTypeText, "$dms_automation.types.webhook.name");
  assert.equal(run.failedStepText, "$dms_automation.types.http.name");
});

test("View runs links open the history on one procedure, said by a banner", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = RunsPageController.table._options;
  assert.deepEqual(options.queryParamFilters, {
    procedure: { field: "procedureId", mode: "is" },
  });
  assert.equal(
    RunsPageController.scope._options.fetchUrl,
    "/api/automation/runs/scope/banner?procedure={{query.procedure}}",
  );
});

test("the page reads its KPIs and list again when a run is stored", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const { RUNS_TOPIC } = require("../dist/realtime.js");
  assert.equal(RUNS_TOPIC, "automation.runs");
  const relay = RunsPageController.live._children.find(
    (c) => c.id === "topics",
  ).component;
  assert.equal(relay._componentName, "dms-automation-live-topics");
  assert.deepEqual(relay._options.realtimeTopic, [RUNS_TOPIC]);
});

test("the outcome follows the start, so a narrow list still shows it", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  // Columns are served in their order.
  const columns = RunsPageController.table._options.columns;
  const visible = columns
    .filter((c) => c.isVisible !== false)
    .map((c) => c.accessorKey);
  assert.deepEqual(visible.slice(0, 2), ["startedAt", "status"]);
  const version = columns.find((c) => c.accessorKey === "procedureVersion");
  assert.equal(version.isVisible, false);
});

test("a run stored without its trigger reads as an unknown trigger", () => {
  const { RunsTableAPI } = require("../dist/data/runs-table.js");
  const run = Object.create(RunsTableAPI.prototype, {
    triggerSummary: { value: undefined },
  });
  assert.equal(run.triggerText, "$dms_automation.runs.unknownTrigger");
});

test("the trigger type filter offers the trigger types by name", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const column = RunsPageController.table._options.columns.find(
    (c) => c.accessorKey === "triggerType",
  );
  const values = JSON.stringify(column);
  for (const id of ["webhook", "schedule.cron", "manual"]) {
    assert.ok(values.includes(`"${id}"`), id);
  }
  assert.ok(values.includes("$dms_automation.types.webhook.name"));
});
