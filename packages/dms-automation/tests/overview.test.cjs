const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  attentionRows,
  healthHero,
  procedureCounts,
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
  // Failed three days ago, fine since: degraded over 7 days, not over 24 h.
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
    [run("p", "ok", 1), run("p", "failed", 1)],
  );
  const chart = runsPerDayChart(ctx, {
    from: new Date(ago(24).getTime() + 7 * 60 * 1000),
    to: NOW,
    compareFrom: ago(48),
    compareTo: ago(24),
  });
  assert.equal(chart.value, 2);
  assert.equal("delta" in chart, false);
  assert.equal(chart.series[0].data[0].x, ago(24).toISOString());
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
  // A calendar preset already ends at midnight: it stays as asked.
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
  // A sliding window keeps its year back as it follows the request.
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
  // Without a comparison, stale compared dates are not even read.
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
