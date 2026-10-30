const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isPropertyBag } = require("../dist/types/guards.js");

/** @typedef {import("@antelopejs/interface-dms").ComponentBuilder<unknown>} Builder */

/**
 * The value reached by following `keys` through nested objects and arrays.
 * @param {unknown} root
 * @param {...(string | number)} keys
 * @returns {unknown}
 */
function at(root, ...keys) {
  let current = root;
  for (const key of keys) {
    assert.ok(isPropertyBag(current));
    current = current[key];
  }
  return current;
}

/**
 * The options a page builder was given.
 * @param {Builder} builder
 * @returns {unknown}
 */
function optionsOf(builder) {
  return builder["_options"];
}

/**
 * The column of a table's options with this `accessorKey`.
 * @param {unknown} options
 * @param {string} accessorKey
 * @returns {unknown}
 */
function columnOf(options, accessorKey) {
  const columns = at(options, "columns");
  assert.ok(Array.isArray(columns));
  return columns.find((c) => at(c, "accessorKey") === accessorKey);
}

/**
 * The component a builder holds under the child `id`.
 * @param {Builder} builder
 * @param {string} id
 * @returns {unknown}
 */
function childComponent(builder, id) {
  /** @type {unknown} */
  const children = builder["_children"];
  assert.ok(Array.isArray(children));
  return at(
    children.find((c) => at(c, "id") === id),
    "component",
  );
}

void test("the run history uses the DMS grouped display, by day, counted", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = optionsOf(RunsPageController.table);
  const displays = at(options, "displays");
  assert.ok(Array.isArray(displays));
  assert.deepEqual(
    displays.map((display) => at(display, "id")),
    ["table", "grouped"],
  );
  assert.deepEqual(at(displays, 1, "options"), {
    groupByField: "startedAt",
    by: "day",
    count: true,
  });
  assert.equal(at(options, "defaultDisplay"), "grouped");
});

void test("a run opens in a right drawer on one click, deep linked, and re-runs with its payload", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = optionsOf(RunsPageController.table);
  const custom = at(options, "rowActions", "custom");
  const peek = at(custom, 0);
  const rerun = at(custom, 1);
  const trace = at(custom, 2);
  assert.equal(at(peek, "isDefault"), true);
  assert.equal(at(peek, "deepLink"), true);
  assert.equal(at(peek, "target", "type"), "drawer");
  assert.equal(at(peek, "target", "direction"), "right");
  assert.equal(at(peek, "target", "size"), undefined);
  assert.equal(at(peek, "target", "overlay"), undefined);
  assert.equal(at(peek, "target", "title"), "$dms_automation.runs.peekTitle");
  assert.equal(
    at(peek, "target", "rowTitle"),
    "$dms_automation.runs.peekHeading",
  );
  assert.equal(
    at(peek, "target", "positionLabel"),
    "$dms_automation.runs.peekPosition",
  );
  assert.equal(at(peek, "target", "deepLink"), true);
  assert.deepEqual(at(peek, "target", "notFound"), {
    title: "$dms_automation.runs.peekNotFound",
    description: "$dms_automation.runs.peekNotFoundHint",
  });
  assert.equal(
    at(options, "rowActions", "menuLabel"),
    "$dms_automation.runs.rowMenu",
  );
  assert.equal(at(options, "rowClick"), "single");
  assert.equal(
    at(rerun, "target", "url"),
    "/api/automation/runs/{{row._id}}/rerun",
  );
  assert.deepEqual(at(rerun, "confirm"), {
    from: "/api/automation/runs/{{row._id}}/rerun-confirm",
  });
  assert.equal(
    at(trace, "target", "url"),
    "/modules/automation/trace?run={{row._id}}",
  );
});

void test("the trigger and failed-step cells are the DMS two_line display", () => {
  const { RunsTableAPI } = require("../dist/data/runs-table.js");
  /** @type {unknown} */
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
  assert.equal(at(run, "triggerText"), "POST /webhooks/stripe");
  assert.equal(
    at(run, "triggerTypeText"),
    "$dms_automation.types.webhook.name",
  );
  assert.equal(at(run, "failedStepText"), "$dms_automation.types.http.name");
});

void test("View runs links open the history on one procedure, said by a banner", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = optionsOf(RunsPageController.table);
  assert.deepEqual(at(options, "queryParamFilters"), {
    procedure: { field: "procedureId", mode: "is" },
  });
  assert.equal(
    at(optionsOf(RunsPageController.scope), "fetchUrl"),
    "/api/automation/runs/scope/banner?procedure={{query.procedure}}",
  );
});

void test("the page reads its KPIs and list again when a run is stored", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const { RUNS_TOPIC } = require("../dist/realtime.js");
  assert.equal(RUNS_TOPIC, "automation.runs");
  const relay = childComponent(RunsPageController.live, "topics");
  assert.equal(at(relay, "_componentName"), "dms-automation-live-topics");
  assert.deepEqual(at(relay, "_options", "realtimeTopic"), [RUNS_TOPIC]);
});

void test("the outcome follows the start, so a narrow list still shows it", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = optionsOf(RunsPageController.table);
  const columns = at(options, "columns");
  assert.ok(Array.isArray(columns));
  const visible = columns
    .filter((c) => at(c, "isVisible") !== false)
    .map((c) => at(c, "accessorKey"));
  assert.deepEqual(visible.slice(0, 2), ["startedAt", "status"]);
  assert.equal(at(columnOf(options, "procedureVersion"), "isVisible"), false);
});

void test("a run stored without its trigger reads as an unknown trigger", () => {
  const { RunsTableAPI } = require("../dist/data/runs-table.js");
  /** @type {unknown} */
  const run = Object.create(RunsTableAPI.prototype, {
    triggerSummary: { value: undefined },
  });
  assert.equal(at(run, "triggerText"), "$dms_automation.runs.unknownTrigger");
});

void test("the trigger type filter offers the trigger types by name", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const column = columnOf(optionsOf(RunsPageController.table), "triggerType");
  const values = JSON.stringify(column);
  for (const id of ["webhook", "schedule.cron", "manual"]) {
    assert.ok(values.includes(`"${id}"`), id);
  }
  assert.ok(values.includes("$dms_automation.types.webhook.name"));
});
