const assert = require("node:assert/strict");
const { test } = require("node:test");

test("procedure table metadata uses Builder for every page action", () => {
  const { ProceduresPageController } = require("../dist/pages/procedures.js");
  const options = ProceduresPageController.table._options;

  assert.deepEqual(options.formContainer, {
    type: "page",
    pages: {
      view: {
        urlSlug: "/modules/automation/builder?selected=:id",
        customPage: true,
      },
      new: { customPage: true },
      edit: { customPage: true },
    },
  });
  assert.deepEqual(options.rowActions, {
    delete: true,
    archive: undefined,
    restore: undefined,
    add: false,
    edit: false,
    duplicate: false,
    copyLink: false,
    details: true,
    hasSelection: false,
    custom: options.rowActions.custom,
  });
  assert.deepEqual(options.customButtons, [
    {
      label: "$dms_automation.procedures.newProcedure",
      icon: "i-ph-plus",
      color: "primary",
      target: { type: "page", url: "/modules/automation/builder" },
    },
  ]);
  assert.equal(options.rowActions.custom.length, 1);
  assert.deepEqual(options.rowActions.custom[0].target, {
    type: "api",
    url: "/api/automation/procedures/{procedureId}/run",
    method: "POST",
    successMessage: "$dms_automation.procedures.runStarted",
  });
});
