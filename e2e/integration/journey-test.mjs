import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { runJourney, startRun } from "@antelopejs/dms/e2e/run";

/**
 * @typedef {import("@antelopejs/dms/e2e/run").Journey} Journey
 * @typedef {import("@antelopejs/dms/e2e/run").FeatureResult} FeatureResult
 */

const TEST_TIMEOUT_MS = 10 * 60_000;

/** @type {Awaited<ReturnType<typeof startRun>> | undefined} */
let started;
before(async () => {
  started = await startRun();
});
after(() => started?.stop());

/**
 * @param {FeatureResult} result A judged journey
 * @returns {string[]} One line per check that fails it, a known failure that now passes included, and the error that ended it
 */
function failuresOf(result) {
  const checks = result.steps.flatMap((step) =>
    step.checks
      .filter((check) => check.verdict === "fail" || check.verdict === "fixed")
      .map((check) =>
        check.verdict === "fixed"
          ? `${step.name}: ${check.name} passes: remove it from knownFailures (${check.finding ?? ""})`
          : `${step.name}: ${check.name}: ${check.detail}`,
      ),
  );
  return result.error ? [...checks, result.error] : checks;
}

/**
 * Registers each journey as a `node:test` test of the calling file. The
 * process starts one run with `startRun()`, which every file of a
 * `--test-isolation=none` run shares; each test drives its journey with the
 * kit's browserless `runJourney`, on a fresh database with an onboarded
 * administrator unless the journey's fields say otherwise, and fails on any
 * failing check that is not a known failure. Evidence goes to
 * `<run>/evidence/<feature>/<journey>/`.
 *
 * @param {string} feature The feature the journeys belong to
 * @param {Journey[]} journeys The journeys
 */
export function journeyTests(feature, journeys) {
  for (const journey of journeys) {
    void test(journey.id, { timeout: TEST_TIMEOUT_MS }, async (t) => {
      assert.ok(started, "the run started");
      const result = await runJourney(started.run, feature, journey);
      for (const step of result.steps)
        for (const check of step.checks)
          if (check.verdict === "known")
            t.diagnostic(
              `known failure: ${check.name}: ${check.finding ?? ""}`,
            );
      assert.deepEqual(
        failuresOf(result),
        [],
        `${journey.title}\nevidence: ${join(started.run.evidence, result.folder)}`,
      );
    });
  }
}
