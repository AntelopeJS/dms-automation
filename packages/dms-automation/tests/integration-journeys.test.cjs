const assert = require("node:assert/strict");
const { test } = require("node:test");
const { hasRunner, integrationFeatures } = require("./helpers/journeys.cjs");

void test("a feature whose journeys are marked integration: true has the node:test file that runs them, so byRunner never drops one from both suites", async () => {
  const features = await integrationFeatures();
  assert.ok(features.length > 0, "some feature has integration journeys");
  assert.deepEqual(
    features.filter((feature) => !hasRunner(feature)),
    [],
  );
});
