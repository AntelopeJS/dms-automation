const assert = require("node:assert/strict");
const { mock, test } = require("node:test");
const redis = require("@antelopejs/interface-redis");
const leader = require("../dist/cluster/leader.js");

const SHUTDOWN_GRACE_MS = 5_000;

/**
 * A Redis holding one key, whose `SET` answers only when the test says so,
 * and which runs the owner-checked renew and release scripts of leader.ts.
 */
function fakeRedis() {
  const fake = {
    /** @type {string | undefined} */
    owner: undefined,
    /** @type {PromiseWithResolvers<void>[]} */
    pendingSets: [],
    /** @param {string} _key @param {string} value */
    async set(_key, value) {
      /** @type {PromiseWithResolvers<void>} */
      const answer = Promise.withResolvers();
      fake.pendingSets.push(answer);
      await answer.promise;
      if (fake.owner !== undefined) return null;
      fake.owner = value;
      return "OK";
    },
    /** @param {string} script @param {number} _keys @param {string} _key @param {string} value */
    async eval(script, _keys, _key, value) {
      if (fake.owner !== value) return 0;
      if (script.includes("'del'")) fake.owner = undefined;
      return 1;
    },
  };
  return fake;
}

void test("stop() returns within its grace while SET is unanswered, and a late OK neither promotes the instance nor leaves the key held", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  t.after(() => mock.timers.reset());
  const fake = fakeRedis();
  redis.internal.SetClient(fake);
  let promotions = 0;
  await leader.start({
    async onBecameLeader() {
      promotions += 1;
    },
    async onLostLeadership() {},
  });
  assert.equal(fake.pendingSets.length, 1, "the first tick sent SET NX");

  const stopped = leader.stop();
  mock.timers.tick(SHUTDOWN_GRACE_MS);
  await stopped;
  fake.pendingSets[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(leader.isLeader(), false, "a stopped instance does not lead");
  assert.equal(promotions, 0, "a stopped instance arms nothing");
  assert.equal(fake.owner, undefined, "a stopped instance holds no key");
});
