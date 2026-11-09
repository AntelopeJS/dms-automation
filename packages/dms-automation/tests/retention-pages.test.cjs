const assert = require("node:assert/strict");
const interfaceCore = require("@antelopejs/interface-core");
const dmsPage = require("@antelopejs/interface-dms/page");
const Module = require("node:module");
const path = require("node:path");
const { mock, test } = require("node:test");
const { isPropertyBag } = require("../dist/types/guards.js");

const INDEX = path.resolve(__dirname, "../dist/index.js");
const LOADED_BY_INDEX = new Set([
  "./pages",
  "./runtime/retention",
  "./types/constants",
  "./frontend-module",
]);

/**
 * @param {unknown} node
 * @param {string} key
 */
function field(node, key) {
  assert.ok(isPropertyBag(node), `a component holds ${key}`);
  return node[key];
}

/** @param {unknown} toolbar */
function periodComparisons(toolbar) {
  /** @type {unknown} */
  const children = field(toolbar, "_children");
  assert.ok(Array.isArray(children), "the toolbar has children");
  /** @type {unknown} */
  const period = children.find(
    (/** @type {unknown} */ child) => field(child, "id") === "period",
  );
  return field(field(field(period, "component"), "_options"), "comparisons");
}

void test("the comparison menu follows the runs.retentionDays given to construct", async () => {
  /** @type {Record<string, unknown>} */
  const mocks = {
    "@antelopejs/interface-dms/page": { ...dmsPage, AddFrontendModule() {} },
    "@antelopejs/interface-core": { ...interfaceCore, ImplementInterface() {} },
    "./runtime/boundRunLog": { configureRedaction() {} },
    "./runtime/builtins/actions/http": { setHttpRequestOptions() {} },
  };
  /** @type {unknown} */
  const load = Module._load;
  assert.ok(load instanceof Function, "Module._load is not available");
  mock.method(
    Module,
    "_load",
    (
      /** @type {string} */ name,
      /** @type {unknown} */ parent,
      /** @type {boolean} */ isMain,
    ) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (
        field(parent, "filename") === INDEX &&
        name.startsWith("./") &&
        !LOADED_BY_INDEX.has(name)
      )
        return {};
      /** @type {unknown} */
      const loaded = load.call(Module, name, parent, isMain);
      return loaded;
    },
  );
  const { construct } = require("../dist/index.js");
  await construct({ runs: { retentionDays: 395 } });
  const { OverviewPageController } = require("../dist/pages/overview.js");
  const { RunsPageController } = require("../dist/pages/runs.js");
  const withYear = ["previous-period", "previous-year", "none"];
  assert.deepEqual(periodComparisons(OverviewPageController.live), withYear);
  assert.deepEqual(periodComparisons(RunsPageController.live), withYear);
});
