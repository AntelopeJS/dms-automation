const assert = require("node:assert/strict");
const { test } = require("node:test");
const { nextOccurrence } = require("../dist/runtime/schedule.js");
const { retentionCutoff } = require("../dist/runtime/retention.js");

const at = (s) => new Date(s);

test("the next occurrence of common schedules", () => {
  const from = at("2026-10-07T10:07:30");
  assert.deepEqual(
    nextOccurrence("*/15 * * * *", from),
    at("2026-10-07T10:15:00"),
  );
  assert.deepEqual(
    nextOccurrence("0 2 * * *", from),
    at("2026-10-08T02:00:00"),
  );
  // 2026-10-07 is a Wednesday: next Monday is the 12th.
  assert.deepEqual(
    nextOccurrence("0 9 * * 1", from),
    at("2026-10-12T09:00:00"),
  );
  assert.deepEqual(
    nextOccurrence("0 9 * * mon", from),
    at("2026-10-12T09:00:00"),
  );
  assert.deepEqual(
    nextOccurrence("30 0 9 1 * *", from),
    at("2026-11-01T09:00:00"),
  );
});

test("an invalid expression has no occurrence", () => {
  assert.equal(nextOccurrence("not a cron"), undefined);
  assert.equal(nextOccurrence("61 * * * *"), undefined);
});

test("retention cuts off the runs older than the given days", () => {
  const now = at("2026-10-31T00:00:00Z");
  assert.deepEqual(retentionCutoff(30, now), at("2026-10-01T00:00:00Z"));
});
