const assert = require("node:assert/strict");
const interfaceCore = require("@antelopejs/interface-core");
const Module = require("node:module");
const path = require("node:path");
const { mock, test } = require("node:test");

test("registers Vue with the automation configuration and original priority", async () => {
  const filename = path.resolve(__dirname, "../dist/index.js");
  const registrations = [];
  const mocks = {
    "@antelopejs/interface-dms/page": {
      AddFrontendModule: (registration) => registrations.push(registration),
    },
    "@antelopejs/interface-core": { ...interfaceCore, ImplementInterface() {} },
  };
  const load = Module._load;
  mock.method(Module, "_load", (name, parent, isMain) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("./") && name !== "./types/constants") return {};
    return load(name, parent, isMain);
  });
  const exports = require(filename);
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
