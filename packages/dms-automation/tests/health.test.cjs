const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  procedureHealth,
  runFigures,
  percentile,
  stateRank,
} = require("../dist/stats/health.js");
const { isProductionRun } = require("../dist/types/runLog.js");

const NOW = new Date("2026-10-07T12:00:00Z");
const WEEK_AGO = new Date(NOW.getTime() - 7 * 24 * 3600 * 1000);
const HOUR = 3600 * 1000;

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

test("a procedure whose last run failed is failing, with its streak", () => {
  const health = procedureHealth(
    enabled,
    [run("a", "ok", 5), run("b", "failed", 2), run("c", "failed", 1)],
    WEEK_AGO,
  );
  assert.equal(health.state, "failing");
  assert.equal(health.failureStreak, 2);
  assert.equal(health.lastRun._id, "c");
  assert.deepEqual(health.failingSince, run("b", "failed", 2).startedAt);
  assert.deepEqual(health.lastStatuses, ["ok", "failed", "failed"]);
});

test("a failure followed by a success is degraded, not failing", () => {
  const health = procedureHealth(
    enabled,
    [run("a", "failed", 3), run("b", "ok", 1)],
    WEEK_AGO,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.failureStreak, 0);
  assert.equal(health.failingSince, undefined);
});

test("failures older than the window leave a procedure healthy", () => {
  const health = procedureHealth(
    enabled,
    [run("a", "failed", 24 * 9), run("b", "ok", 1)],
    WEEK_AGO,
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.runs, 1);
  assert.equal(health.successRate, 1);
});

test("no trigger is a draft; disabled is paused once it was enabled or ran", () => {
  const noTrigger = { _id: "p", enabled: true, hasTrigger: false };
  assert.equal(procedureHealth(noTrigger, [], WEEK_AGO).state, "draft");

  const neverEnabled = { _id: "p", enabled: false, hasTrigger: true };
  assert.equal(procedureHealth(neverEnabled, [], WEEK_AGO).state, "draft");
  assert.equal(
    procedureHealth(neverEnabled, [run("a", "ok", 1)], WEEK_AGO).state,
    "paused",
  );
  const paused = { ...neverEnabled, pausedAt: NOW };
  assert.equal(procedureHealth(paused, [], WEEK_AGO).state, "paused");
});

test("figures count, rate and the p95 duration", () => {
  const figures = runFigures([
    run("a", "ok", 1, 100),
    run("b", "ok", 1, 200),
    run("c", "failed", 1, 1000),
    run("d", "ok", 1, 300),
  ]);
  assert.equal(figures.total, 4);
  assert.equal(figures.failed, 1);
  assert.equal(figures.successRate, 0.75);
  assert.equal(figures.avgDurationMs, 400);
  assert.equal(figures.p95DurationMs, 1000);
  assert.equal(percentile([], 0.95), null);
});

test("test runs never count; runs without a kind do", () => {
  assert.equal(isProductionRun(undefined), true);
  assert.equal(isProductionRun("run"), true);
  assert.equal(isProductionRun("rerun"), true);
  assert.equal(isProductionRun("test"), false);
});

test("states sort failing first, drafts last", () => {
  const states = ["healthy", "draft", "failing", "paused", "degraded"];
  assert.deepEqual(
    states.sort((a, b) => stateRank(a) - stateRank(b)),
    ["failing", "degraded", "healthy", "paused", "draft"],
  );
});
