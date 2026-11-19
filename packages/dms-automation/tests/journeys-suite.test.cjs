const assert = require("node:assert/strict");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeUrl = require("node:url");
const { test } = require("node:test");
const { isRow, isText } = require("./helpers/checks.cjs");
const { journeyFeatures } = require("./helpers/journeys.cjs");
const { ROOT } = require("./helpers/package-files.cjs");

/**
 * @returns {Promise<Record<string, unknown>>} The default export of `e2e/journeys.config.ts`
 */
async function journeysConfig() {
  /** @type {unknown} */
  const loaded = await import(
    nodeUrl.pathToFileURL(nodePath.join(ROOT, "e2e", "journeys.config.ts")).href
  );
  assert.ok(
    isRow(loaded) && isRow(loaded.default),
    "the config exports an object",
  );
  return loaded.default;
}

void test("e2e/journeys: fails on a feature file that exports no journey, a journey without an id, or two journeys sharing an id", async () => {
  const features = await journeyFeatures();
  assert.ok(features.length > 0, "e2e/journeys holds features");
  assert.deepEqual(
    features
      .filter(
        (feature) => feature.journeys.length + feature.integration.length === 0,
      )
      .map((feature) => feature.name),
    [],
    "features without journeys",
  );
  const ids = features.flatMap((feature) =>
    [...feature.journeys, ...feature.integration].map((journey) => journey.id),
  );
  assert.deepEqual(
    ids.filter((id) => id === ""),
    [],
    "journeys without an id",
  );
  assert.deepEqual(
    [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
    [],
    "ids shared by two journeys",
  );
});

void test("e2e/journeys.config.ts: fails on a playground without an antelope.config.ts or a smoke feature without a Playwright journey", async () => {
  const config = await journeysConfig();
  assert.ok(isText(config.playground), "the config names a playground");
  assert.ok(
    nodeFs.existsSync(
      nodePath.join(ROOT, String(config.playground), "antelope.config.ts"),
    ),
    `${String(config.playground)}/antelope.config.ts exists`,
  );
  const smoke = (await journeyFeatures()).find(
    (feature) => feature.name === config.smoke,
  );
  assert.ok(smoke, `e2e/journeys/${String(config.smoke)}.mjs exists`);
  assert.ok(
    smoke.journeys.length > 0,
    "the smoke feature has a Playwright journey",
  );
});
