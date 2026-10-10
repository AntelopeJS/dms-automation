const assert = require("node:assert/strict");
const { test } = require("node:test");
const { healthBanner } = require("../dist/stats/health-banner.js");

const LINKS = {
  runsUrl: "/runs",
  traceUrl: "/trace",
  recipes: [{ label: "$recipe", target: { type: "page", url: "/x" } }],
};

function hero(overrides) {
  return {
    state: "healthy",
    updatedAt: "2026-10-10T10:00:00.000Z",
    procedures: 3,
    enabled: 2,
    failing: [],
    degraded: 0,
    paused: 0,
    figures: { total: 12, ok: 12, failed: 0, successRate: 1 },
    lastFailure: null,
    ...overrides,
  };
}

test("with no procedure, the banner offers the first-run recipes", () => {
  const banner = healthBanner(hero({ state: "empty", procedures: 0 }), LINKS);
  assert.equal(banner.tone, "primary");
  assert.equal(banner.title, "$dms_automation.firstRun.title");
  assert.deepEqual(banner.actions, LINKS.recipes);
});

test("a healthy window sums up its runs, without actions", () => {
  const banner = healthBanner(hero(), LINKS);
  assert.equal(banner.tone, "success");
  assert.deepEqual(banner.title, { key: "dms_automation.health.healthy" });
  assert.deepEqual(banner.description, {
    key: "dms_automation.health.summary",
    params: { runs: 12, failed: 0, enabled: 2, total: 3 },
  });
  assert.deepEqual(banner.actions, []);
});

test("a failing procedure names itself, its cause, and links its trace", () => {
  const banner = healthBanner(
    hero({
      state: "failing",
      failing: [
        {
          procedureId: "p1",
          name: "Stripe to CRM",
          since: "2026-10-10T09:00:00.000Z",
          streak: 3,
          lastRunId: "r1",
        },
      ],
      figures: { total: 5, ok: 2, failed: 3, successRate: 0.4 },
      lastFailure: {
        runId: "r1",
        procedureId: "p1",
        procedureName: "Stripe to CRM",
        startedAt: "2026-10-10T09:30:00.000Z",
        error: "fetch failed",
        step: { nodeId: "a1", typeName: "$dms_automation.types.http.name" },
      },
    }),
    LINKS,
  );
  assert.equal(banner.tone, "error");
  assert.deepEqual(banner.title, {
    key: "dms_automation.health.failing",
    params: { count: { type: "count", value: 1 } },
  });
  assert.equal(banner.description.key, "dms_automation.health.failingDetail");
  assert.equal(banner.description.params.name, "Stripe to CRM");
  assert.deepEqual(banner.description.params.cause, {
    key: "dms_automation.health.lastFailureAt",
    params: {
      error: "fetch failed",
      step: { key: "dms_automation.types.http.name" },
    },
  });
  assert.deepEqual(
    banner.actions.map((a) => a.to),
    ["/trace?run=r1", "/runs?tab=failed"],
  );
});
