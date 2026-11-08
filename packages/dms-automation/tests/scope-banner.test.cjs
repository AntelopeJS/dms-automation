const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  ControllerMeta,
  computeParameter,
} = require("@antelopejs/interface-api");
const { GetMetadata } = require("@antelopejs/interface-core");
const { RunsController } = require("../dist/routes/runs.js");

/**
 * The `procedure` argument the API hands `scopeBanner` for this query string,
 * read through the controller's own parameter decorator.
 * @param {string} search
 * @returns {Promise<unknown>}
 */
async function procedureArgument(search) {
  const meta = GetMetadata(RunsController, ControllerMeta);
  /** @type {import("@antelopejs/interface-api").RequestContext} */
  const context = /** @type {never} */ ({
    url: new URL(`http://localhost/api/automation/runs/scope/banner${search}`),
  });
  return computeParameter(
    context,
    meta.getComputedParameter("scopeBanner", 1),
    {},
  );
}

for (const search of ["?procedure=", "?procedure=%20%20", ""]) {
  void test(`the scope banner says nothing for "${search}"`, async () => {
    const procedure = await procedureArgument(search);
    const banner = await RunsController.prototype.scopeBanner.call(
      {},
      /** @type {never} */ ({}),
      /** @type {never} */ (procedure),
    );
    assert.deepEqual(banner, {});
  });
}
