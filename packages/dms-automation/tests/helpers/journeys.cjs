const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeUrl = require("node:url");
const { isRow } = require("./checks.cjs");
const { ROOT } = require("./package-files.cjs");

/**
 * The features of `e2e/journeys/` that export at least one journey marked
 * `integration: true`, which `byRunner` keeps out of the Playwright suite.
 *
 * @returns {Promise<string[]>} Their names
 */
async function integrationFeatures() {
  const folder = nodePath.join(ROOT, "e2e", "journeys");
  const features = [];
  for (const file of nodeFs.readdirSync(folder)) {
    if (!file.endsWith(".mjs")) continue;
    /** @type {unknown} */
    const loaded = await import(
      nodeUrl.pathToFileURL(nodePath.join(folder, file)).href
    );
    const integration = isRow(loaded) ? loaded.integration : undefined;
    if (Array.isArray(integration) && integration.length > 0)
      features.push(file.slice(0, -".mjs".length));
  }
  return features;
}

/**
 * @param {string} feature A feature of `e2e/journeys/`
 * @returns {boolean} Whether `e2e/integration/` has the node:test file that runs its integration journeys
 */
function hasRunner(feature) {
  return nodeFs.existsSync(
    nodePath.join(ROOT, "e2e", "integration", `${feature}.journeys.test.mjs`),
  );
}

module.exports = { hasRunner, integrationFeatures };
