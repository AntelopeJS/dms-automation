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
  assert.equal(rowActions.details, true);
  assert.deepEqual(rowActions.delete, {
    isEnabled: true,
    confirm: {
      from: "/api/automation/procedures/{procedureId}/delete-confirm",
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
    "/api/automation/procedures/{procedureId}/run-now",
  );
  assert.deepEqual(byLabel.runNow.rule, { field: "status", notIn: ["draft"] });
  assert.deepEqual(byLabel.pause.target.body, { enabled: false });
  assert.deepEqual(byLabel.pause.rule, { field: "enabled", equals: true });
  assert.deepEqual(byLabel.resume.target.body, { enabled: true });
});
