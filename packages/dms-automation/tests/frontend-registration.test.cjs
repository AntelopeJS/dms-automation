const assert = require("node:assert/strict");
const interfaceCore = require("@antelopejs/interface-core");
const Module = require("node:module");
const path = require("node:path");
const { mock, test } = require("node:test");

void test("registers Vue with the automation configuration and original priority", async () => {
  /** @type {unknown[]} */
  const registrations = [];
  /** @type {Record<string, unknown>} */
  const mocks = {
    "@antelopejs/interface-dms/page": {
      AddFrontendModule: (/** @type {unknown} */ registration) =>
        registrations.push(registration),
    },
    "@antelopejs/interface-core": { ...interfaceCore, ImplementInterface() {} },
    "./runtime/retention": { configureRetention() {} },
    "./runtime/boundRunLog": { configureRedaction() {} },
    "./runtime/builtins/actions/http": { setHttpRequestOptions() {} },
    "./routes/library": { setPublicUrl() {} },
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
        name.startsWith("./") &&
        name !== "./types/constants" &&
        name !== "./frontend-module"
      )
        return {};
      /** @type {unknown} */
      const loaded = load.call(Module, name, parent, isMain);
      return loaded;
    },
  );
  const exports = require("../dist/index.js");
  await exports.construct({ cluster: { driver: "memory" } });
  assert.deepEqual(registrations, [
    {
      name: "@antelopejs/dms-automation-frontend-vue",
      sourcePath: path.resolve(__dirname, "../frontend-vue"),
      renderer: { name: "vue", version: "3" },
      configKey: "dmsAutomation",
      options: { authHeaderName: "x-dashboard-auth" },
      priority: 0,
    },
  ]);
  assert.equal(exports.getConfig().cluster.driver, "memory");
});
