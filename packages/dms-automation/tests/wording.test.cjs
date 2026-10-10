const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  asParam,
  cronText,
  stepText,
  triggerText,
  triggerTypeText,
} = require("../dist/runtime/wording.js");

const CRON = "dms_automation.cron";

test("a schedule reads in words, composed in the reader's language", () => {
  assert.deepEqual(cronText("* * * * *"), { key: `${CRON}.everyMinute` });
  assert.deepEqual(cronText("*/10 * * * *"), {
    key: `${CRON}.everyMinutes`,
    params: { n: "10" },
  });
  assert.deepEqual(cronText("5 * * * *"), {
    key: `${CRON}.hourly`,
    params: { minute: "05" },
  });
  assert.deepEqual(cronText("0 */6 * * *"), {
    key: `${CRON}.everyHours`,
    params: { n: "6" },
  });
  assert.deepEqual(cronText("0 2 * * *"), {
    key: `${CRON}.daily`,
    params: { time: "02:00" },
  });
  assert.deepEqual(cronText("30 8 * * 1-5"), {
    key: `${CRON}.weekdays`,
    params: { time: "08:30" },
  });
  assert.deepEqual(cronText("0 9 * * 1"), {
    key: `${CRON}.weekly`,
    params: { day: { key: `${CRON}.days.mon` }, time: "09:00" },
  });
  assert.equal(cronText("0 9 1 * *"), "0 9 1 * *");
  assert.equal(cronText("not a cron"), "not a cron");
});

test("a trigger reads as its settings, its type under them", () => {
  const webhook = {
    nodeId: "t1",
    typeId: "webhook",
    typeName: "$dms_automation.types.webhook.name",
    path: "/hooks/in",
    method: "PUT",
  };
  assert.equal(triggerText(webhook), "PUT /hooks/in");
  assert.equal(triggerTypeText(webhook), webhook.typeName);
  const manual = { nodeId: "t1", typeId: "manual", typeName: "Manual" };
  assert.equal(triggerText(manual), "Manual");
  assert.equal(triggerTypeText(manual), null);
  assert.equal(triggerText(null), "$dms_automation.trigger.none");
});

test("a step reads as its label, else its type, else its id", () => {
  assert.equal(
    stepText({ nodeId: "a1", label: "Notify", typeName: "Log" }),
    "Notify",
  );
  assert.equal(stepText({ nodeId: "a1", typeName: "Log" }), "Log");
  assert.equal(stepText({ nodeId: "a1" }), "a1");
  assert.equal(stepText(null), null);
});

test("a key nested in a composed text is composed, a name is kept", () => {
  assert.deepEqual(asParam("$dms_automation.types.log.name"), {
    key: "dms_automation.types.log.name",
  });
  assert.equal(asParam("Notify the team"), "Notify the team");
});
