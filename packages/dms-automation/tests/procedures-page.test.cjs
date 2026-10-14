const assert = require("node:assert/strict");
const { test } = require("node:test");

test("a procedure row opens the builder, and the list offers no form", () => {
  const { ProceduresPageController } = require("../dist/pages/procedures.js");
  const options = ProceduresPageController.table._options;

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

test("the list has a tab per state, the failing one feeding the menu badge", () => {
  const { ProceduresPageController } = require("../dist/pages/procedures.js");
  const { tabs } = ProceduresPageController.table._options;
  assert.deepEqual(
    tabs.map((t) => [t.id, t.filter.value, t.navBadge]),
    [
      ["failing", "failing", true],
      ["degraded", "degraded", false],
      ["healthy", "healthy", false],
      ["paused", "paused", false],
      ["draft", "draft", false],
    ],
  );
});

test("run now, pause and resume act on the right rows", () => {
  const { ProceduresPageController } = require("../dist/pages/procedures.js");
  const custom = ProceduresPageController.table._options.rowActions.custom;
  const byLabel = Object.fromEntries(
    custom.map((a) => [a.label.split(".").at(-1), a]),
  );
  assert.equal(
    byLabel.runNow.target.url,
    "/api/automation/procedures/{{row.procedureId}}/run-now",
  );
  assert.deepEqual(byLabel.runNow.rule, { field: "status", notIn: ["draft"] });
  assert.deepEqual(byLabel.pause.target.body, { enabled: false });
  assert.deepEqual(byLabel.pause.rule, { field: "enabled", equals: true });
  assert.deepEqual(byLabel.resume.target.body, { enabled: true });
  assert.equal(
    byLabel.viewRuns.target.url,
    "/modules/automation/runs?procedure={{row.procedureId}}",
  );
  assert.equal(
    byLabel.openLastRun.target.url,
    "/modules/automation/trace?run={{row.lastRunId}}",
  );
  assert.equal(
    byLabel.duplicate.target.url,
    "/api/automation/procedures/{{row.procedureId}}/duplicate",
  );
});

test("the list reloads on the procedures' and the runs' realtime topics", () => {
  const { ProceduresPageController } = require("../dist/pages/procedures.js");
  assert.deepEqual(ProceduresPageController.table._options.realtimeTopic, [
    "automation.procedures",
    "automation.runs",
  ]);
});

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

const names = (rows) => rows.map((r) => r.name);

test("an empty search or filter, sent as a bare parameter, keeps every row", () => {
  const { applyQuery } = require("../dist/data/procedures-table.js");
  // The API hands `?search` and `?filter_status` without a value in as `true`.
  assert.equal(
    applyQuery(ROWS, { search: true, filter_status: true }).length,
    4,
  );
  assert.equal(applyQuery(ROWS, { search: "  ", filter_status: "" }).length, 4);
});

test("the search reads webhook paths, schedules and errors, without accents", () => {
  const { applyQuery } = require("../dist/data/procedures-table.js");
  assert.deepEqual(names(applyQuery(ROWS, { search: "cafe" })), ["Café sync"]);
  assert.deepEqual(names(applyQuery(ROWS, { search: "demo-payment" })), [
    "Payments",
  ]);
  assert.deepEqual(names(applyQuery(ROWS, { search: "http 404" })), [
    "Payments",
  ]);
  assert.deepEqual(names(applyQuery(ROWS, { search: "0 2 *" })), ["Nightly"]);
});

test("the status and trigger filters keep or drop rows by any of their values", () => {
  const { applyQuery } = require("../dist/data/procedures-table.js");
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

test("sorting on the status orders the states by severity, either way", () => {
  const { sortRows } = require("../dist/data/procedures-table.js");
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
  // No sort: the procedures that need attention first.
  assert.deepEqual(
    names(sortRows(ROWS, true)),
    names(sortRows(ROWS, "status")),
  );
});
