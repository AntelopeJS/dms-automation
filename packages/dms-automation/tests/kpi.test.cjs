const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  kpiPayload,
  bucketStarts,
  runsPerBucket,
  isKpiMetric,
  MIN_COMPARED_RUNS,
} = require("../dist/stats/kpi.js");

const HOUR = 3600 * 1000;
const to = new Date("2026-10-07T12:00:00Z");
const from = new Date(to.getTime() - 24 * HOUR);
const compareTo = new Date(from.getTime() - 1);
const compareFrom = new Date(compareTo.getTime() - 24 * HOUR);
const window = { from, to, compareFrom, compareTo };

/**
 * @param {string} status
 * @param {number} hoursBeforeTo
 * @param {number} [durationMs]
 * @returns {{
 *   _id: string;
 *   procedureId: string;
 *   status: string;
 *   startedAt: Date;
 *   endedAt: Date;
 * }}
 */
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

/**
 * `count` runs of `status` in the compared window (24 to 48 h ago).
 * @param {string} status
 * @param {number} count
 */
const earlier = (status, count) =>
  Array.from({ length: count }, (_, i) => run(status, 25 + i * 0.5));

const runs = [
  run("ok", 1),
  run("ok", 2),
  run("failed", 3),
  run("ok", 4),
  run("ok", 30),
  run("ok", 31),
];

void test("a KPI answers its value, its comparison and a sparkline", () => {
  const runsKpi = kpiPayload("runs", runs, window);
  assert.equal(runsKpi.value, 4);
  assert.equal(runsKpi.previousValue, 2);
  assert.equal(runsKpi.sparkline.length, 24);
  assert.equal(
    runsKpi.sparkline.reduce((a, b) => a + b, 0),
    4,
  );

  assert.equal(kpiPayload("success-rate", runs, window).value, 75);
  assert.equal(kpiPayload("failed", runs, window).value, 1);
  assert.equal(kpiPayload("duration-p95", runs, window).value, 1000);
});

void test("too few runs to compare with: no change shown", () => {
  assert.equal(kpiPayload("runs", runs, window).delta, null);
});

void test("every KPI compares in percent of the previous value", () => {
  const many = [...runs, ...earlier("ok", 6), ...earlier("failed", 4)];
  const runsKpi = kpiPayload("runs", many, window);
  assert.equal(runsKpi.previousValue, 12);
  assert.equal(runsKpi.delta, -66.7);
  const rate = kpiPayload("success-rate", many, window);
  assert.equal(rate.previousValue, 66.7);
  assert.equal(rate.delta, 12.4);
});

void test("a change from 0 is not a percentage", () => {
  const before = earlier("ok", MIN_COMPARED_RUNS);
  const failed = kpiPayload("failed", [...runs, ...before], window);
  assert.equal(failed.previousValue, 0);
  assert.equal(failed.delta, null);
  const calm = kpiPayload("failed", [run("ok", 1), ...before], window);
  assert.equal(calm.delta, 0);
});

void test("a window without runs has no rate and no duration, not 0", () => {
  const empty = kpiPayload("success-rate", [], window);
  assert.equal("value" in empty, false);
  assert.equal("previousValue" in empty, false);
  assert.equal(empty.delta, null);
  assert.deepEqual(empty.sparkline, []);
  assert.equal("value" in kpiPayload("duration-p95", [], window), false);
  assert.equal(kpiPayload("runs", [], window).value, 0);
});

void test("a rate's sparkline carries its value over the hours without runs", () => {
  const quiet = [run("ok", 1), run("ok", 6)];
  const sparkline = kpiPayload("success-rate", quiet, window).sparkline;
  assert.equal(sparkline.length, 24);
  assert.equal(
    sparkline.every((v) => v === 100),
    true,
  );
  assert.equal(
    kpiPayload("success-rate", runs, window).sparkline.includes(0),
    true,
  );
});

void test("without a comparison window there is no delta", () => {
  const payload = kpiPayload("runs", runs, { from, to });
  assert.equal(payload.delta, undefined);
  assert.equal(payload.previousValue, undefined);
});

void test("compared with the same window a year earlier", () => {
  const YEAR = 365 * 24 * HOUR;
  /**
   * @param {string} status
   * @param {number} hoursBeforeTo
   */
  const yearBack = (status, hoursBeforeTo) => {
    const r = run(status, hoursBeforeTo);
    r.startedAt = new Date(r.startedAt.getTime() - YEAR);
    r.endedAt = new Date(r.endedAt.getTime() - YEAR);
    return r;
  };
  const lastYear = [
    ...Array.from({ length: 15 }, (_, i) => yearBack("ok", 1 + i)),
    ...Array.from({ length: 5 }, (_, i) => yearBack("failed", 16 + i)),
    ...earlier("ok", 10),
  ];
  const now = Array.from({ length: 10 }, (_, i) => run("ok", 1 + i));
  const yearWindow = {
    from,
    to,
    compareFrom: new Date(from.getTime() - YEAR),
    compareTo: new Date(to.getTime() - YEAR),
  };
  const all = [...now, ...lastYear];
  const runsKpi = kpiPayload("runs", all, yearWindow);
  assert.equal(runsKpi.value, 10);
  assert.equal(runsKpi.previousValue, 20);
  assert.equal(runsKpi.delta, -50);
  const rate = kpiPayload("success-rate", all, yearWindow);
  assert.equal(rate.previousValue, 75);
  assert.equal(kpiPayload("failed", all, yearWindow).previousValue, 5);
  assert.equal(
    runsKpi.sparkline.reduce((a, b) => a + b, 0),
    10,
  );
});

void test("hours start on the hour; windows longer than two days bucket by day", () => {
  const sliding = {
    from: new Date("2026-10-06T12:07:33Z"),
    to: new Date("2026-10-07T12:07:33Z"),
  };
  const starts = bucketStarts(sliding);
  assert.equal(starts[0].toISOString(), "2026-10-06T12:00:00.000Z");
  assert.equal(starts.length, 25);
  const week = { from: new Date(to.getTime() - 7 * 24 * HOUR), to };
  assert.equal(bucketStarts(week).length, 7);
});

void test("runs fall in their bucket, and runs outside the window in none", () => {
  const buckets = runsPerBucket([...runs, run("ok", 40), run("ok", -1)], {
    from,
    to,
  });
  assert.equal(buckets.length, 24);
  assert.equal(
    buckets.reduce((n, b) => n + b.length, 0),
    4,
  );
  assert.deepEqual(
    buckets.at(-1).map((r) => r._id),
    ["ok-1"],
  );
});

void test("only the known metrics are served", () => {
  assert.equal(isKpiMetric("runs"), true);
  assert.equal(isKpiMetric("anything"), false);
});
