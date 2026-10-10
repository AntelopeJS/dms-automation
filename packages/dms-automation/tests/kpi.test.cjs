const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  kpiPayload,
  bucketStarts,
  isKpiMetric,
} = require("../dist/stats/kpi.js");

const HOUR = 3600 * 1000;
const to = new Date("2026-10-07T12:00:00Z");
const from = new Date(to.getTime() - 24 * HOUR);
const compareTo = new Date(from.getTime() - 1);
const compareFrom = new Date(compareTo.getTime() - 24 * HOUR);

const run = (status, hoursBeforeTo, durationMs = 1000) => {
  const startedAt = new Date(to.getTime() - hoursBeforeTo * HOUR);
  return {
    _id: `${status}-${hoursBeforeTo}`,
    procedureId: "p",
    status,
    startedAt,
    endedAt: new Date(startedAt.getTime() + durationMs),
  };
};

const runs = [
  run("ok", 1),
  run("ok", 2),
  run("failed", 3),
  run("ok", 4),
  run("ok", 30),
  run("ok", 31),
];

test("a KPI answers its value, its comparison and a sparkline", () => {
  const window = { from, to, compareFrom, compareTo };
  const runsKpi = kpiPayload("runs", runs, window);
  assert.equal(runsKpi.value, 4);
  assert.equal(runsKpi.previousValue, 2);
  assert.equal(runsKpi.delta, 100);
  assert.equal(runsKpi.sparkline.length, 24);
  assert.equal(
    runsKpi.sparkline.reduce((a, b) => a + b, 0),
    4,
  );

  assert.equal(kpiPayload("success-rate", runs, window).value, 75);
  assert.equal(kpiPayload("failed", runs, window).value, 1);
  assert.equal(kpiPayload("duration-p95", runs, window).value, 1);
});

test("without a comparison window there is no delta", () => {
  const payload = kpiPayload("runs", runs, { from, to });
  assert.equal(payload.delta, undefined);
  assert.equal(payload.previousValue, undefined);
});

test("windows longer than two days bucket by day", () => {
  const week = { from: new Date(to.getTime() - 7 * 24 * HOUR), to };
  assert.equal(bucketStarts(week).length, 7);
});

test("only the known metrics are served", () => {
  assert.equal(isKpiMetric("runs"), true);
  assert.equal(isKpiMetric("anything"), false);
});
