const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  attentionRows,
  healthHero,
  PROCEDURE_COUNT_LINES,
  procedureCounts,
  RECENT_RUNS,
  recentRunItems,
  runsPerDayChart,
} = require("../dist/stats/overview.js");

const HOUR = 3600 * 1000;
const NOW = new Date("2026-10-07T12:00:00Z");
const ago = (hours) => new Date(NOW.getTime() - hours * HOUR);

const GRAPH = {
  nodes: [{ id: "t", kind: "trigger", typeId: "manual", config: {} }],
  edges: [],
};

function procedure(id, name, enabled = true) {
  return {
    procedure: { _id: id, name, enabled, graph: JSON.stringify(GRAPH) },
    graph: GRAPH,
    triggers: [{ nodeId: "t", typeId: "manual", typeName: "Manual" }],
  };
}

let runId = 0;
const run = (procedureId, status, hoursAgo, extra = {}) => ({
  _id: `r${++runId}`,
  procedureId,
  status,
  startedAt: ago(hoursAgo),
  endedAt: new Date(ago(hoursAgo).getTime() + 100),
  ...extra,
});

function context(procedures, runs) {
  return {
    now: NOW,
    procedures,
    byId: new Map(procedures.map((p) => [p.procedure._id, p])),
    runs: [...runs].sort((a, b) => b.startedAt - a.startedAt),
  };
}

const day = { from: ago(24), to: NOW };
const week = { from: ago(7 * 24), to: NOW };

test("the health line's degraded state follows the window", () => {
  const ctx = context(
    [procedure("p", "Export")],
    [run("p", "failed", 72), run("p", "ok", 2)],
  );
  assert.equal(healthHero(ctx, week).state, "degraded");
  assert.equal(healthHero(ctx, day).state, "healthy");
});

test("the health line names failing procedures in the attention order", () => {
  const ctx = context(
    [procedure("a", "Once"), procedure("b", "Thrice")],
    [
      run("a", "failed", 1),
      run("b", "failed", 3),
      run("b", "failed", 2),
      run("b", "failed", 1),
    ],
  );
  const hero = healthHero(ctx, day);
  assert.deepEqual(
    hero.failing.map((f) => f.name),
    ["Thrice", "Once"],
  );
  assert.deepEqual(
    attentionRows(ctx).items.map((r) => r.name),
    ["Thrice", "Once"],
  );
  assert.equal(hero.lastFailure.procedureId, "b");
});

test("needs attention shows five rows and counts them all", () => {
  const procedures = Array.from({ length: 7 }, (_, i) =>
    procedure(`p${i}`, `Job ${i}`),
  );
  const ctx = context(
    procedures,
    procedures.map((p) => run(p.procedure._id, "failed", 1)),
  );
  const list = attentionRows(ctx);
  assert.equal(list.items.length, 5);
  assert.equal(list.total, 7);
});

test("the procedure counts add up to the total, one line per state", () => {
  const ctx = context(
    [
      procedure("f", "Failing"),
      procedure("d", "Degraded"),
      procedure("h", "Healthy"),
      procedure("x", "Draft", false),
    ],
    [
      run("f", "failed", 1),
      run("d", "failed", 3),
      run("d", "ok", 1),
      run("h", "ok", 1),
    ],
  );
  const counts = procedureCounts(ctx, "/procedures");
  assert.deepEqual(
    counts.map((c) => `${c.id}=${c.value}`),
    ["total=4", "failing=1", "degraded=1", "healthy=1", "paused=0", "draft=1"],
  );
  const [total, ...states] = counts;
  assert.equal(
    states.reduce((sum, c) => sum + c.value, 0),
    total.value,
  );
  assert.equal(counts[2].to, "/procedures?tab=degraded");
});

test("the overview's lists send as many lines as their skeletons draw", () => {
  assert.equal(
    procedureCounts(context([], []), "/procedures").length,
    PROCEDURE_COUNT_LINES,
  );
  const runs = Array.from({ length: RECENT_RUNS + 3 }, (_, i) =>
    run("p", "ok", i + 1),
  );
  const ctx = context([procedure("p", "Sync")], runs);
  assert.equal(recentRunItems(ctx, "/trace").length, RECENT_RUNS);
});

test("a run of a deleted procedure keeps its name", () => {
  const ctx = context(
    [],
    [run("gone", "ok", 1, { procedureName: "Old sync" })],
  );
  const [item] = recentRunItems(ctx, "/trace");
  assert.equal(item.title, "$dms_automation.feed.deletedProcedureNamed");
  assert.equal(item.params.name, "Old sync");
});

test("the runs chart buckets on the hour, without a comparison", () => {
  const ctx = context(
    [procedure("p", "Sync")],
    [run("p", "ok", 1), run("p", "failed", 1), run("p", "ok", 30)],
  );
  const chart = runsPerDayChart(ctx, {
    from: new Date(ago(24).getTime() + 7 * 60 * 1000),
    to: NOW,
  });
  assert.equal(chart.value, 2);
  assert.equal(chart.series[0].data[0].x, ago(24).toISOString());
  assert.equal("comparisonSeries" in chart, false);
  assert.equal("delta" in chart, false);
  assert.equal("previousValue" in chart, false);
});

test("the runs chart draws the period before, bucket by bucket", () => {
  const before = [
    ...Array.from({ length: 12 }, () => run("p", "ok", 30)),
    run("p", "failed", 26),
    run("p", "ok", 26),
  ];
  const now = Array.from({ length: 9 }, () => run("p", "ok", 1));
  const ctx = context([procedure("p", "Sync")], [...before, ...now]);
  const chart = runsPerDayChart(ctx, {
    from: ago(24),
    to: NOW,
    compareFrom: ago(48),
    compareTo: ago(24),
  });
  assert.equal(chart.value, 9);
  assert.equal(chart.previousValue, 14);
  assert.equal(chart.delta, -35.7);
  const [compared] = chart.comparisonSeries;
  assert.equal(compared.type, "line");
  assert.equal(compared.name, "$dms_automation.overview.comparedRuns");
  assert.deepEqual(
    compared.data.map((p) => p.x),
    chart.series[0].data.map((p) => p.x),
  );
  assert.equal(compared.data[18].y, 12);
  assert.equal(compared.data[22].y, 2);
  assert.equal(
    compared.data.reduce((sum, p) => sum + p.y, 0),
    14,
  );
});

test("the runs chart compares with the same window a year earlier", () => {
  const YEAR = 365 * 24 * HOUR;
  const yearAgo = (status, hoursAgo) => {
    const r = run("p", status, hoursAgo);
    r.startedAt = new Date(r.startedAt.getTime() - YEAR);
    r.endedAt = new Date(r.endedAt.getTime() - YEAR);
    return r;
  };
  const lastYear = Array.from({ length: 20 }, () => yearAgo("ok", 3));
  const dayBefore = Array.from({ length: 5 }, () => run("p", "ok", 30));
  const now = Array.from({ length: 10 }, () => run("p", "failed", 3));
  const ctx = context(
    [procedure("p", "Sync")],
    [...lastYear, ...dayBefore, ...now],
  );
  const chart = runsPerDayChart(ctx, {
    from: ago(24),
    to: NOW,
    compareFrom: new Date(ago(24).getTime() - YEAR),
    compareTo: new Date(NOW.getTime() - YEAR),
  });
  assert.equal(chart.previousValue, 20);
  assert.equal(chart.delta, -50);
  const [compared] = chart.comparisonSeries;
  assert.equal(compared.data[21].y, 20);
  assert.equal(
    compared.data.reduce((sum, p) => sum + p.y, 0),
    20,
  );
});

test("too few compared runs: the line, but no change to read", () => {
  const ctx = context(
    [procedure("p", "Sync")],
    [run("p", "ok", 30), run("p", "ok", 1), run("p", "ok", 2)],
  );
  const chart = runsPerDayChart(ctx, {
    from: ago(24),
    to: NOW,
    compareFrom: ago(48),
    compareTo: ago(24),
  });
  assert.equal(chart.previousValue, 1);
  assert.equal("delta" in chart, false);
  assert.equal(chart.comparisonSeries.length, 1);
});

test("needs attention reads degraded over the period it is given", () => {
  const ctx = context(
    [procedure("p", "Export")],
    [run("p", "failed", 72), run("p", "ok", 2)],
  );
  assert.equal(attentionRows(ctx).total, 1);
  assert.equal(attentionRows(ctx, ago(24)).total, 0);
});

test("a sliding period ends at the request, its comparison with it", () => {
  const { periodWindow } = require("../dist/routes/stats.js");
  const query = {
    from: ago(24).toISOString(),
    to: NOW.toISOString(),
    compareFrom: ago(48).toISOString(),
    compareTo: ago(24).toISOString(),
  };
  const later = new Date(NOW.getTime() + 50 * 1000);
  const sliding = periodWindow({ ...query, preset: "last-24h" }, later);
  assert.equal(sliding.to.getTime(), later.getTime());
  assert.equal(sliding.from.getTime(), ago(24).getTime() + 50 * 1000);
  assert.equal(sliding.compareTo.getTime(), ago(24).getTime() + 50 * 1000);
  const week = periodWindow({ ...query, preset: "last-7-days" }, later);
  assert.equal(week.to.getTime(), NOW.getTime());
});

test("the compared window is the one the scope resolved, a year back too", () => {
  const { periodWindow } = require("../dist/routes/stats.js");
  const YEAR = 365 * 24 * 3600 * 1000;
  const query = {
    from: ago(24).toISOString(),
    to: NOW.toISOString(),
    compareFrom: new Date(ago(24).getTime() - YEAR).toISOString(),
    compareTo: new Date(NOW.getTime() - YEAR).toISOString(),
    comparison: "previous-year",
  };
  const week = periodWindow({ ...query, preset: "last-7-days" }, NOW);
  assert.equal(week.compareFrom.getTime(), ago(24).getTime() - YEAR);
  assert.equal(week.compareTo.getTime(), NOW.getTime() - YEAR);
  const later = new Date(NOW.getTime() + 50 * 1000);
  const sliding = periodWindow({ ...query, preset: "last-24h" }, later);
  assert.equal(sliding.compareTo.getTime(), later.getTime() - YEAR);
});

test("no comparison: no compared window, whatever dates come with it", () => {
  const { periodWindow } = require("../dist/routes/stats.js");
  const window = periodWindow({
    from: ago(24).toISOString(),
    to: NOW.toISOString(),
    compareFrom: ago(48).toISOString(),
    compareTo: ago(24).toISOString(),
    comparison: "none",
  });
  assert.equal(window.compareFrom, undefined);
  assert.equal(window.compareTo, undefined);
  assert.doesNotThrow(() =>
    periodWindow({
      from: ago(24).toISOString(),
      compareFrom: "garbage",
      comparison: "none",
    }),
  );
});

test("a period that cannot be read is refused", () => {
  const { periodWindow } = require("../dist/routes/stats.js");
  const refused = (query) =>
    assert.throws(
      () => periodWindow(query),
      (e) => e.status === 400,
    );
  refused({ from: "garbage" });
  refused({ from: "1700-01-01T00:00:00Z" });
  refused({ from: NOW.toISOString(), to: ago(24).toISOString() });
});
