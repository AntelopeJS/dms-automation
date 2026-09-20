const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RunWithResponsibleModule } = require("@antelopejs/interface-core");
const { internal } = require("@antelopejs/interface-dms-automation");

const SELF = "dms-automation";

// typeOrigin captures its own module id at import time from the call stack, so
// load it under an explicit ownership context to stand in for a real boot.
let typeOrigin;
RunWithResponsibleModule(SELF, () => {
  typeOrigin = require("../dist/runtime/typeOrigin.js");
});

const triggerType = {
  id: "tests.trigger",
  name: "Test trigger",
  description: "",
  icon: "",
  configSchema: {},
  outputSchema: {},
  cluster: "replicated",
  activate: () => Promise.resolve(undefined),
  deactivate: () => Promise.resolve(),
};

function registerTrigger(module, id) {
  RunWithResponsibleModule(module, () =>
    internal.RegisterTriggerType.register(id, { ...triggerType, id }),
  );
}

// Guards the exact RegisteringProxy internals typeOrigin reads: an
// interface-core release that moves the registration bookkeeping again must
// fail here rather than silently flatten the builder palette.
test("attribution resolves our own types back to this module", () => {
  registerTrigger(SELF, "tests.own");
  assert.equal(typeOrigin.isOriginAttributionWorking("tests.own"), true);
  // Our own types stay unlabeled — the palette lists them in the leading
  // built-in section.
  assert.deepEqual(typeOrigin.triggerTypeOrigin("tests.own"), {});
});

test("attribution labels types registered by another module", () => {
  registerTrigger("some-other-module", "tests.foreign");
  assert.deepEqual(typeOrigin.triggerTypeOrigin("tests.foreign"), {
    module: "some-other-module",
  });
});

test("attribution degrades to unlabeled for unknown ids", () => {
  assert.deepEqual(typeOrigin.triggerTypeOrigin("tests.missing"), {});
  assert.equal(typeOrigin.isOriginAttributionWorking("tests.missing"), false);
});
