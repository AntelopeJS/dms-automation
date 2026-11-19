const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeUrl = require("node:url");
const { isRow, isText } = require("./checks.cjs");
const { ROOT } = require("./package-files.cjs");

/**
 * @typedef {{ id: string }} JourneyId A journey, by the id the suite names it with
 * @typedef {{ name: string, journeys: JourneyId[], integration: JourneyId[] }} Feature A file of `e2e/journeys/`: its Playwright journeys and those marked `integration: true`
 */

/**
 * @param {unknown} value An export of a journeys file
 * @returns {JourneyId[]} The journeys it lists, or none when it is not a list
 */
function journeyList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((journey) => ({
    id: isRow(journey) && isText(journey.id) ? journey.id : "",
  }));
}

/**
 * @returns {Promise<Feature[]>} The features of `e2e/journeys/`, sorted by name
 */
async function journeyFeatures() {
  const folder = nodePath.join(ROOT, "e2e", "journeys");
  const features = [];
  for (const file of nodeFs.readdirSync(folder).sort()) {
    if (!file.endsWith(".mjs")) continue;
    /** @type {unknown} */
    const loaded = await import(
      nodeUrl.pathToFileURL(nodePath.join(folder, file)).href
    );
    features.push({
      name: file.slice(0, -".mjs".length),
      journeys: journeyList(isRow(loaded) ? loaded.journeys : undefined),
      integration: journeyList(isRow(loaded) ? loaded.integration : undefined),
    });
  }
  return features;
}

/**
 * The features of `e2e/journeys/` that export at least one journey marked
 * `integration: true`, which `byRunner` keeps out of the Playwright suite.
 *
 * @returns {Promise<string[]>} Their names
 */
async function integrationFeatures() {
  return (await journeyFeatures())
    .filter((feature) => feature.integration.length > 0)
    .map((feature) => feature.name);
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

module.exports = { hasRunner, integrationFeatures, journeyFeatures };
