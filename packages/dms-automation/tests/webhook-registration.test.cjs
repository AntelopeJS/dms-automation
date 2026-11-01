const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getRegisteredRouteHandlers } = require("@antelopejs/interface-api");
const { webhookTrigger } = require("../dist/runtime/builtins/triggers/webhook.js");

const handlerAt = (location) =>
  getRegisteredRouteHandlers().find(
    (entry) => entry.handler.location === location,
  )?.handler;

test("an armed webhook registers its route under a controller class", async () => {
  const handle = await webhookTrigger.activate(
    { path: "/webhooks/registration-probe", method: "POST" },
    () => undefined,
  );
  try {
    const handler = handlerAt("/webhooks/registration-probe");
    assert.equal(typeof handler?.controller, "function");
    assert.equal(handler.method, "POST");
  } finally {
    await webhookTrigger.deactivate(handle);
  }
});

test("a deactivated webhook leaves no route behind", async () => {
  const handle = await webhookTrigger.activate(
    { path: "/webhooks/deactivation-probe", method: "GET" },
    () => undefined,
  );
  await webhookTrigger.deactivate(handle);
  assert.equal(handlerAt("/webhooks/deactivation-probe"), undefined);
});
