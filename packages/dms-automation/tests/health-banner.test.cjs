const assert = require("node:assert/strict");
const { test } = require("node:test");
const { healthBanner } = require("../dist/stats/health-banner.js");
const { isObject } = require("../dist/types/guards.js");

/** @typedef {import("../dist/stats/overview.js").HealthHero} HealthHero */
/** @typedef {import("../dist/stats/health-banner.js").HealthBannerLinks} HealthBannerLinks */
/** @typedef {import("@antelopejs/interface-dms/base").BannerContent} BannerContent */
/** @typedef {import("@antelopejs/interface-dms/base/types").BlockText} BlockText */
/** @typedef {import("@antelopejs/interface-dms/base/types").ComposedText} ComposedText */

/** @type {HealthBannerLinks} */
const LINKS = {
  runsUrl: "/runs",
  traceUrl: "/trace",
  proceduresUrl: "/procedures",
  recipes: [{ label: "$recipe", target: { type: "page", url: "/x" } }],
};

/**
 * @param {Partial<HealthHero>} [overrides]
 * @returns {HealthHero}
 */
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

/**
 * @param {BlockText | undefined} text
 * @returns {ComposedText}
 */
function composed(text) {
  assert.ok(isObject(text));
  return text;
}

/**
 * @param {BlockText | undefined} text
 * @returns {NonNullable<ComposedText["params"]>}
 */
function paramsOf(text) {
  const { params } = composed(text);
  assert.ok(params);
  return params;
}

/**
 * @param {BannerContent} banner
 * @returns {string[]}
 */
function linkTargets(banner) {
  assert.ok(banner.actions);
  return banner.actions.map((action) => {
    assert.ok("to" in action);
    return action.to;
  });
}

void test("with no procedure, the banner offers the first-run recipes", () => {
  const banner = healthBanner(hero({ state: "empty", procedures: 0 }), LINKS);
  assert.equal(banner.tone, "primary");
  assert.equal(banner.title, "$dms_automation.firstRun.title");
  assert.deepEqual(banner.actions, LINKS.recipes);
});

void test("a healthy window sums up its runs, without actions", () => {
  const banner = healthBanner(hero(), LINKS);
  assert.equal(banner.tone, "success");
  assert.deepEqual(banner.title, { key: "dms_automation.health.healthy" });
  assert.deepEqual(banner.description, {
    key: "dms_automation.health.summaryCount",
    params: {
      count: { type: "count", value: 12 },
      failed: 0,
      enabled: 2,
      total: 3,
    },
  });
  assert.deepEqual(banner.actions, []);
});

void test("a failing procedure names itself, its cause, and links its trace", () => {
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
          armError: null,
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
  assert.equal(
    composed(banner.description).key,
    "dms_automation.health.failingDetail",
  );
  assert.equal(paramsOf(banner.description).name, "Stripe to CRM");
  assert.deepEqual(paramsOf(banner.description).cause, {
    key: "dms_automation.health.lastFailureAt",
    params: {
      error: "fetch failed",
      step: { key: "dms_automation.types.http.name" },
    },
  });
  assert.deepEqual(linkTargets(banner), ["/trace?run=r1", "/runs?tab=failed"]);
});

/** @type {NonNullable<HealthHero["lastFailure"]>} */
const failure = {
  runId: "r9",
  procedureId: "p9",
  procedureName: "Old job",
  startedAt: "2026-09-20T09:30:00.000Z",
  error: "fetch failed",
  step: null,
};

/**
 * @param {string} id
 * @param {string} name
 * @returns {HealthHero["failing"][number]}
 */
const failingProcedure = (id, name) => ({
  procedureId: id,
  name,
  since: "2026-10-10T09:00:00.000Z",
  streak: 2,
  lastRunId: `r-${id}`,
  armError: null,
});

void test("several failing: the first is named with how many more, and the list is offered", () => {
  const banner = healthBanner(
    hero({
      state: "failing",
      failing: [
        failingProcedure("p1", "Stripe to CRM"),
        failingProcedure("p2", "Nightly export"),
        failingProcedure("p3", "Slack alert"),
      ],
      figures: { total: 9, ok: 3, failed: 6, successRate: 0.33 },
      lastFailure: { ...failure, runId: "r-p1" },
    }),
    LINKS,
  );
  assert.equal(
    composed(banner.description).key,
    "dms_automation.health.failingDetailMany",
  );
  assert.equal(paramsOf(banner.description).name, "Stripe to CRM");
  assert.deepEqual(paramsOf(banner.description).others, {
    type: "count",
    value: 2,
  });
  assert.deepEqual(linkTargets(banner), [
    "/trace?run=r-p1",
    "/procedures?tab=failing",
  ]);
});

void test("a failing trigger that never armed says so", () => {
  const banner = healthBanner(
    hero({
      state: "failing",
      failing: [
        {
          ...failingProcedure("p1", "Digest"),
          since: null,
          streak: 0,
          lastRunId: null,
          armError: {
            code: "cronInvalid",
            params: { cron: "every monday" },
            message: 'invalid cron expression: "every monday"',
          },
        },
      ],
    }),
    LINKS,
  );
  assert.deepEqual(paramsOf(banner.description).cause, {
    key: "dms_automation.procedures.detail.triggerError",
    params: {
      error: {
        key: "dms_automation.editor.problems.codes.cronInvalid",
        params: { cron: "every monday" },
      },
    },
  });
});

void test("an idle window does not point to an old failure", () => {
  const banner = healthBanner(
    hero({
      state: "idle",
      figures: { total: 0, ok: 0, failed: 0, successRate: null },
      lastFailure: failure,
    }),
    LINKS,
  );
  assert.deepEqual(banner.actions, []);
});

void test("the failed runs open on the banner's period", () => {
  const banner = healthBanner(
    hero({
      state: "degraded",
      degraded: 1,
      figures: { total: 10, ok: 9, failed: 1, successRate: 0.9 },
      lastFailure: failure,
    }),
    {
      ...LINKS,
      runsPeriod: { scope: "automation-runs", preset: "last-7-days" },
    },
  );
  assert.deepEqual(linkTargets(banner), [
    "/trace?run=r9",
    "/runs?tab=failed&automation-runs.period=last-7-days",
  ]);
});
