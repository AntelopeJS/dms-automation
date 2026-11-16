const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  procedureHealth,
  percentile,
  RECENT_RUNS,
  stateRank,
  streakIn,
} = require("../dist/stats/health.js");
const { tallyOf } = require("../dist/stats/kpi.js");

const NOW = new Date("2026-10-07T12:00:00Z");
const HOUR = 3600 * 1000;

/**
 * @param {string} id
 * @param {string} status
 * @param {number} hoursAgo
 * @param {number} [durationMs]
 * @returns {import("../dist/stats/health.js").HealthRun}
 */
function run(id, status, hoursAgo, durationMs = 100) {
  const startedAt = new Date(NOW.getTime() - hoursAgo * HOUR);
  return {
    _id: id,
    procedureId: "p",
    status,
    startedAt,
    endedAt: new Date(startedAt.getTime() + durationMs),
  };
}

const enabled = { _id: "p", enabled: true, hasTrigger: true };

/** @type {import("../dist/stats/health.js").WindowCounts} */
const NO_RUNS = { runs: 0, ok: 0, failed: 0, avgDurationMs: null };

/**
 * A digest of runs, newest first, with the counts of the window.
 * @param {import("../dist/stats/health.js").HealthRun[]} recent
 * @param {Partial<import("../dist/stats/health.js").WindowCounts>} [inWindow]
 * @returns {import("../dist/stats/health.js").RunsDigest}
 */
function digest(recent, inWindow = {}) {
  return {
    recent,
    streak: streakIn(recent) ?? { length: 0 },
    inWindow: { ...NO_RUNS, ...inWindow },
  };
}

void test("a procedure whose last run failed is failing, with its streak", () => {
  const health = procedureHealth(
    enabled,
    digest([run("c", "failed", 1), run("b", "failed", 2), run("a", "ok", 5)], {
      runs: 3,
      ok: 1,
      failed: 2,
    }),
  );
  assert.equal(health.state, "failing");
  assert.equal(health.failureStreak, 2);
  assert.equal(health.lastRun?._id, "c");
  assert.deepEqual(health.failingSince, run("b", "failed", 2).startedAt);
  assert.deepEqual(
    health.recentRuns.map((r) => r.status),
    ["ok", "failed", "failed"],
  );
});

void test("the streak the newest runs show ends at the first run that did not fail", () => {
  assert.deepEqual(streakIn([run("b", "ok", 1), run("a", "failed", 2)]), {
    length: 0,
  });
  assert.deepEqual(streakIn([run("b", "failed", 1), run("a", "failed", 2)]), {
    length: 2,
    since: run("a", "failed", 2).startedAt,
  });
  assert.deepEqual(streakIn([]), { length: 0 });
});

void test("a full page of failed runs leaves the streak to read further back", () => {
  const failed = Array.from({ length: RECENT_RUNS }, (_, i) =>
    run(`f${i}`, "failed", i + 1),
  );
  assert.equal(streakIn(failed), undefined);
  assert.equal(streakIn(failed.slice(1))?.length, RECENT_RUNS - 1);
});

void test("an enabled procedure whose trigger cannot arm is failing", () => {
  const armError = {
    code: "cronInvalid",
    params: { cron: "every monday" },
    message: "invalid cron expression",
  };
  const broken = { ...enabled, armError };
  const health = procedureHealth(
    broken,
    digest([run("a", "ok", 1)], { runs: 1, ok: 1 }),
  );
  assert.equal(health.state, "failing");
  assert.deepEqual(health.armError, armError);
  assert.equal(health.triggerError, "invalid cron expression");
});

void test("an enabled procedure that never ran stays healthy, without a last run", () => {
  const health = procedureHealth(enabled, digest([]));
  assert.equal(health.state, "healthy");
  assert.equal(health.lastRun, undefined);
  assert.equal(health.successRate, null);
});

void test("a failure followed by a success is degraded, not failing", () => {
  const health = procedureHealth(
    enabled,
    digest([run("b", "ok", 1), run("a", "failed", 3)], {
      runs: 2,
      ok: 1,
      failed: 1,
    }),
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.failureStreak, 0);
  assert.equal(health.failingSince, undefined);
});

void test("failures older than the window leave a procedure healthy", () => {
  const health = procedureHealth(
    enabled,
    digest([run("b", "ok", 1), run("a", "failed", 24 * 9)], {
      runs: 1,
      ok: 1,
    }),
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.runs, 1);
  assert.equal(health.successRate, 1);
});

void test("no trigger is a draft; disabled is paused once it was enabled or ran", () => {
  const noTrigger = { _id: "p", enabled: true, hasTrigger: false };
  assert.equal(procedureHealth(noTrigger, digest([])).state, "draft");

  const neverEnabled = { _id: "p", enabled: false, hasTrigger: true };
  assert.equal(procedureHealth(neverEnabled, digest([])).state, "draft");
  assert.equal(
    procedureHealth(neverEnabled, digest([run("a", "ok", 1)])).state,
    "paused",
  );
  const paused = { ...neverEnabled, pausedAt: NOW };
  assert.equal(procedureHealth(paused, digest([])).state, "paused");
});

void test("a tally counts the runs and reads the p95 duration", () => {
  const tally = tallyOf([
    run("a", "ok", 1, 100),
    run("b", "ok", 1, 200),
    run("c", "failed", 1, 1000),
    run("d", "ok", 1, 300),
  ]);
  assert.deepEqual(tally, { total: 4, ok: 3, failed: 1, p95DurationMs: 1000 });
  assert.equal(percentile([], 0.95), null);
});

void test("states sort failing first, drafts last", () => {
  const states = ["healthy", "draft", "failing", "paused", "degraded"];
  assert.deepEqual(
    states.sort((a, b) => stateRank(a) - stateRank(b)),
    ["failing", "degraded", "healthy", "paused", "draft"],
  );
});
