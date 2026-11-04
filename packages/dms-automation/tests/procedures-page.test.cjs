const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isPropertyBag, isString } = require("../dist/types/guards.js");

/**
 * The options of the list's table, which the framework keeps on the builder
 * and its types do not show.
 * @returns {Record<string, unknown>}
 */
function tableOptions() {
  const { ProceduresPageController } = require("../dist/pages/procedures.js");
  /** @type {unknown} */
  const options = ProceduresPageController.table._options;
  assert.ok(isPropertyBag(options), "the list's table has options");
  return options;
}

/**
 * @param {Record<string, unknown>} action
 * @returns {Record<string, unknown>}
 */
function targetOf(action) {
  assert.ok(isPropertyBag(action.target), "the action has a target");
  return action.target;
}

void test("a procedure row opens the builder, and the list offers no form", () => {
  const options = tableOptions();

  assert.deepEqual(options.formContainer, {
    type: "page",
    pages: {
      details: {
        urlSlug: "/modules/automation/builder?selected=:id",
        customPage: true,
      },
      new: { customPage: true },
      edit: { customPage: true },
    },
  });
  const { rowActions } = options;
  assert.ok(isPropertyBag(rowActions));
  assert.equal(rowActions.add, false);
  assert.equal(rowActions.edit, false);
  assert.deepEqual(rowActions.details, {
    label: "$dms_automation.procedures.openInBuilder",
  });
  assert.deepEqual(rowActions.delete, {
    isEnabled: true,
    confirm: {
      from: "/api/automation/procedures/{{row.procedureId}}/delete-confirm",
    },
  });
});

void test("the list has a tab per state, the failing one feeding the menu badge", () => {
  const { tabs } = tableOptions();
  assert.ok(Array.isArray(tabs));
  assert.deepEqual(
    tabs.map((/** @type {unknown} */ t) => {
      assert.ok(isPropertyBag(t) && isPropertyBag(t.filter));
      return [t.id, t.filter.value, t.navBadge];
    }),
    [
      ["failing", "failing", true],
      ["degraded", "degraded", false],
      ["healthy", "healthy", false],
      ["paused", "paused", false],
      ["draft", "draft", false],
    ],
  );
});

void test("run now, pause and resume act on the right rows", () => {
  const { rowActions } = tableOptions();
  assert.ok(isPropertyBag(rowActions) && Array.isArray(rowActions.custom));
  const byLabel = Object.fromEntries(
    rowActions.custom.map(
      /**
       * @param {unknown} a
       * @returns {[string, Record<string, unknown>]}
       */
      (a) => {
        assert.ok(isPropertyBag(a) && isString(a.label));
        return [a.label.slice(a.label.lastIndexOf(".") + 1), a];
      },
    ),
  );
  assert.equal(
    targetOf(byLabel.runNow).url,
    "/api/automation/procedures/{{row.procedureId}}/run-now",
  );
  assert.deepEqual(byLabel.runNow.rule, { field: "status", notIn: ["draft"] });
  assert.deepEqual(targetOf(byLabel.pause).body, { enabled: false });
  assert.deepEqual(byLabel.pause.rule, { field: "enabled", equals: true });
  assert.deepEqual(targetOf(byLabel.resume).body, { enabled: true });
  assert.equal(
    targetOf(byLabel.viewRuns).url,
    "/modules/automation/runs?procedure={{row.procedureId}}",
  );
  assert.equal(
    targetOf(byLabel.openLastRun).url,
    "/modules/automation/trace?run={{row.lastRunId}}",
  );
  assert.equal(
    targetOf(byLabel.duplicate).url,
    "/api/automation/procedures/{{row.procedureId}}/duplicate",
  );
});

void test("the list reloads on the procedures' and the runs' realtime topics", () => {
  assert.deepEqual(tableOptions().realtimeTopic, [
    "automation.procedures",
    "automation.runs",
  ]);
});

/**
 * @typedef {Pick<
 *   import("../dist/db/models/stats.model.js").ProcedureSummaryRow,
 *   | "procedureId"
 *   | "name"
 *   | "description"
 *   | "status"
 *   | "lastError"
 *   | "triggerTypes"
 * > & {
 *   triggers: Partial<import("../dist/runtime/describe.js").TriggerSummary>[];
 * }} FixtureRow
 */

/**
 * @param {string} name
 * @param {FixtureRow["status"]} status
 * @param {Partial<FixtureRow>} [extra]
 * @returns {FixtureRow}
 */
function row(name, status, extra = {}) {
  return {
    procedureId: name,
    name,
    description: "",
    status,
    lastError: null,
    triggers: [],
    triggerTypes: [],
    ...extra,
  };
}

const ROWS = [
  row("Café sync", "healthy", { triggerTypes: ["manual"] }),
  row("Payments", "failing", {
    lastError: "HTTP 404 Not Found",
    triggers: [{ typeId: "webhook", path: "/demo-payment" }],
    triggerTypes: ["webhook"],
  }),
  row("Nightly", "degraded", {
    triggers: [{ typeId: "schedule.cron", cron: "0 2 * * *" }],
    triggerTypes: ["schedule.cron", "manual"],
  }),
  row("Archive", "paused"),
];

/** @param {{ name: string }[]} rows */
const names = (rows) => rows.map((r) => r.name);

void test("an empty search or filter, sent as a bare parameter, keeps every row", () => {
  const { applyQuery } = require("../dist/data/procedures-query.js");
  assert.equal(
    applyQuery(ROWS, { search: true, filter_status: true }).length,
    4,
  );
  assert.equal(applyQuery(ROWS, { search: "  ", filter_status: "" }).length, 4);
});

void test("the search reads webhook paths, schedules and errors, without accents", () => {
  const { applyQuery } = require("../dist/data/procedures-query.js");
  assert.deepEqual(names(applyQuery(ROWS, { search: "cafe" })), ["Café sync"]);
  assert.deepEqual(names(applyQuery(ROWS, { search: "demo-payment" })), [
    "Payments",
  ]);
  assert.deepEqual(names(applyQuery(ROWS, { search: "http 404" })), [
    "Payments",
  ]);
  assert.deepEqual(names(applyQuery(ROWS, { search: "0 2 *" })), ["Nightly"]);
});

void test("the status and trigger filters keep or drop rows by any of their values", () => {
  const { applyQuery } = require("../dist/data/procedures-query.js");
  assert.deepEqual(
    names(applyQuery(ROWS, { filter_status: "is:failing,degraded" })),
    ["Payments", "Nightly"],
  );
  assert.deepEqual(
    names(
      applyQuery(ROWS, { filter_triggerTypes: "array_contains_string:manual" }),
    ),
    ["Café sync", "Nightly"],
  );
  assert.deepEqual(
    names(applyQuery(ROWS, { filter_triggerTypes: "exclude:manual" })),
    ["Payments", "Archive"],
  );
});

void test("sorting on the status orders the states by severity, either way", () => {
  const { sortRows } = require("../dist/data/procedures-query.js");
  assert.deepEqual(names(sortRows(ROWS, "status", "asc")), [
    "Payments",
    "Nightly",
    "Café sync",
    "Archive",
  ]);
  assert.deepEqual(names(sortRows(ROWS, "status", "desc")), [
    "Archive",
    "Café sync",
    "Nightly",
    "Payments",
  ]);
  assert.deepEqual(
    names(sortRows(ROWS, true)),
    names(sortRows(ROWS, "status")),
  );
});

void test("the picker's options narrow to the ids asked for, whatever the page size", () => {
  const { procedureOptions } = require("../dist/data/procedures-query.js");
  const procedures = [
    { _id: "p-a", name: "Alpha" },
    { _id: "p-z", name: "Zulu" },
    { _id: "p-m", name: "Mike" },
  ];
  assert.deepEqual(procedureOptions(procedures, undefined, ["p-z"]), [
    { procedureId: "p-z", _id: "p-z", name: "Zulu" },
  ]);
  assert.deepEqual(
    procedureOptions(procedures, undefined, ["p-z", "p-m", "gone"]).map(
      (p) => p.name,
    ),
    ["Mike", "Zulu"],
  );
  assert.deepEqual(
    procedureOptions(procedures, true).map((p) => p.name),
    ["Alpha", "Mike", "Zulu"],
  );
  assert.deepEqual(
    procedureOptions(procedures, "ik").map((p) => p.name),
    ["Mike"],
  );
});
