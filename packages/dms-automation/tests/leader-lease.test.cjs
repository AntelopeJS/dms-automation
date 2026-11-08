const assert = require("node:assert/strict");
const { mock, test } = require("node:test");
const redis = require("@antelopejs/interface-redis");
const leader = require("../dist/cluster/leader.js");

const TTL_MS = 30_000;
const TICK_MS = 10_000;

/**
 * A Redis holding the leader key with its expiry on its own clock, running
 * the owner-checked renew and release of leader.ts. A `"lost"` renew never
 * reaches Redis; a `"late"` one renews the key but its answer waits in
 * `lateAnswers`, as when the leader's event loop or its connection stalls; a
 * `"failing"` one rejects without reaching Redis. While `setsWait`, a `SET`
 * reaches Redis only once the test calls `setArrives`.
 * @param {() => number} clock
 */
function fakeRedis(clock) {
  const fake = {
    /** @type {string | undefined} */
    owner: undefined,
    expiresAt: 0,
    /** @type {"answered" | "lost" | "late" | "failing"} */
    renews: "answered",
    setsWait: false,
    /** @type {(() => void) | undefined} */
    setArrives: undefined,
    /** @type {(() => void)[]} */
    lateAnswers: [],
    holder() {
      return clock() < fake.expiresAt ? fake.owner : undefined;
    },
    /** @param {string} _key @param {string} value */
    async set(_key, value) {
      if (fake.setsWait) {
        /** @type {Promise<void>} */
        const arrived = new Promise((resolve) => {
          fake.setArrives = resolve;
        });
        await arrived;
      }
      if (fake.holder() !== undefined) return null;
      fake.owner = value;
      fake.expiresAt = clock() + TTL_MS;
      return "OK";
    },
    /** @param {string} _script @param {number} _keys @param {string} _key @param {string} value */
    async eval(script, _keys, _key, value) {
      const answer = () => {
        if (fake.holder() !== value) return 0;
        if (script.includes("'del'")) fake.owner = undefined;
        else fake.expiresAt = clock() + TTL_MS;
        return 1;
      };
      if (script.includes("'del'")) return answer();
      if (fake.renews === "failing") throw new Error("connection reset");
      if (fake.renews === "answered") return answer();
      const applied = fake.renews === "late" ? answer() : 0;
      /** @type {Promise<number>} */
      const answered = new Promise((resolve) => {
        fake.lateAnswers.push(() => resolve(applied));
      });
      return await answered;
    },
  };
  return fake;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Mocked timers and wall clock, a monotonic clock that only `advance` moves,
 * and a leader started on a fake Redis that keeps time on that monotonic clock,
 * whose first `SET` reaches Redis `setAnswerMs` after it was sent.
 * @param {import("node:test").TestContext} t
 * @param {number} [setAnswerMs]
 */
async function leading(t, setAnswerMs = 0) {
  mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 100_000,
  });
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  const fake = fakeRedis(() => elapsed);
  t.after(async () => {
    mock.timers.reset();
    fake.renews = "answered";
    for (const answer of fake.lateAnswers) answer();
    await leader.stop();
  });
  void redis.internal.UnsetClient();
  redis.internal.SetClient(fake);
  const run = { fake, promotions: 0 };
  /** @param {number} ms */
  const advance = async (ms) => {
    elapsed += ms;
    mock.timers.tick(ms);
    await settle();
  };
  fake.setsWait = setAnswerMs > 0;
  await leader.start({
    async onBecameLeader() {
      run.promotions += 1;
    },
    async onLostLeadership() {},
  });
  if (fake.setsWait) {
    fake.setsWait = false;
    await advance(setAnswerMs);
    fake.setArrives?.();
  }
  await settle();
  assert.equal(leader.isLeader(), true, "the instance won the key");
  return { ...run, run, advance };
}

void test(
  "a leader whose renew goes unanswered stops leading before a peer can take the expired key",
  { timeout: 10_000 },
  async (t) => {
    const { fake, advance } = await leading(t);

    fake.renews = "lost";
    await advance(TICK_MS);
    await advance(TTL_MS - TICK_MS);

    assert.equal(
      fake.holder(),
      undefined,
      "the key expired, so a peer can win it",
    );
    assert.equal(
      leader.isLeader(),
      false,
      "the stalled leader no longer leads",
    );
  },
);

void test(
  "a wall clock stepped back does not stretch the lease",
  { timeout: 10_000 },
  async (t) => {
    const { fake, advance } = await leading(t);

    fake.renews = "lost";
    mock.timers.setTime(Date.now() - 60_000);
    await advance(TICK_MS);
    await advance(TTL_MS - TICK_MS);

    assert.equal(fake.holder(), undefined, "the key expired on Redis");
    assert.equal(
      leader.isLeader(),
      false,
      "the stalled leader no longer leads",
    );
  },
);

void test(
  "a renew confirmed after the lease ran out runs the promotion again",
  { timeout: 10_000 },
  async (t) => {
    const { fake, run, advance } = await leading(t);
    assert.equal(run.promotions, 1, "the first win promotes");

    fake.renews = "late";
    await advance(TICK_MS);
    await advance(TTL_MS - TICK_MS);
    assert.equal(leader.isLeader(), false, "the lease ran out");
    assert.equal(fake.lateAnswers.length, 1, "Redis renewed the key in time");

    fake.lateAnswers[0]();
    await settle();

    assert.equal(
      leader.isLeader(),
      true,
      "the late confirmation restores the lease",
    );
    assert.equal(
      run.promotions,
      2,
      "the singletons a lapse let a reconcile disarm are armed again",
    );
  },
);

void test(
  "a renew confirmed late while stop() runs promotes nothing",
  { timeout: 10_000 },
  async (t) => {
    const { fake, run, advance } = await leading(t);

    fake.renews = "late";
    await advance(TICK_MS);
    await advance(TTL_MS - TICK_MS);
    fake.renews = "answered";
    const stopped = leader.stop();
    fake.lateAnswers[0]();
    await stopped;

    assert.equal(run.promotions, 1, "a stopping instance arms nothing");
    assert.equal(leader.isLeader(), false, "a stopped instance does not lead");
  },
);

void test(
  "a Redis error past the lease keeps the hold while the key lives, so stop() releases it",
  { timeout: 10_000 },
  async (t) => {
    const { fake, advance } = await leading(t, 5_000);

    fake.renews = "failing";
    await advance(TICK_MS - 5_000);
    await advance(TICK_MS);
    await advance(TICK_MS);
    assert.equal(leader.isLeader(), false, "the lease ran out");
    assert.notEqual(fake.holder(), undefined, "the key still lives");

    await leader.stop();

    assert.equal(fake.holder(), undefined, "a stopped instance holds no key");
  },
);
