const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  asParam,
  cronText,
  stepText,
  triggerText,
  triggerTypeText,
  withTriggerText,
} = require("../dist/runtime/wording.js");
const { scheduleTimeZone } = require("../dist/runtime/schedule.js");

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
  assert.deepEqual(cronText("0 2 * * *", "UTC"), {
    key: `${CRON}.daily`,
    params: { time: "02:00 (UTC)" },
  });
  assert.deepEqual(cronText("30 8 * * 1-5", "UTC"), {
    key: `${CRON}.weekdays`,
    params: { time: "08:30 (UTC)" },
  });
  assert.deepEqual(cronText("0 9 * * 1", "Europe/Brussels"), {
    key: `${CRON}.weekly`,
    params: {
      day: { key: `${CRON}.days.mon` },
      time: "09:00 (Europe/Brussels)",
    },
  });
  assert.equal(cronText("0 9 1 * *"), "0 9 1 * *");
  assert.equal(cronText("not a cron"), "not a cron");
});

test("a clock time names the zone the schedules fire in, the server's", () => {
  assert.deepEqual(cronText("0 2 * * *"), {
    key: `${CRON}.daily`,
    params: { time: `02:00 (${scheduleTimeZone()})` },
  });
});

test("a schedule with seconds keeps them, a step of hours its minute", () => {
  assert.deepEqual(cronText("*/20 * * * * *"), {
    key: `${CRON}.everySeconds`,
    params: { n: "20" },
  });
  assert.deepEqual(cronText("* * * * * *"), { key: `${CRON}.everySecond` });
  assert.deepEqual(cronText("0 */10 * * * *"), {
    key: `${CRON}.everyMinutes`,
    params: { n: "10" },
  });
  assert.equal(cronText("15 0 2 * * *"), "15 0 2 * * *");
  assert.equal(cronText("*/20 0 * * * *"), "*/20 0 * * * *");
  assert.deepEqual(cronText("30 */2 * * *"), {
    key: `${CRON}.everyHoursAt`,
    params: { n: "2", minute: "30" },
  });
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

test("a schedule trigger reads in the zone its summary names", () => {
  const schedule = {
    nodeId: "t1",
    typeId: "cron",
    typeName: "$dms_automation.types.cron.name",
    cron: "0 9 * * 1",
    timeZone: "Europe/Brussels",
  };
  const text = {
    key: `${CRON}.weekly`,
    params: {
      day: { key: `${CRON}.days.mon` },
      time: "09:00 (Europe/Brussels)",
    },
  };
  assert.deepEqual(triggerText(schedule), text);
  assert.deepEqual(withTriggerText(schedule), { ...schedule, text });
  const { timeZone: _zone, ...unzoned } = schedule;
  assert.deepEqual(
    triggerText(unzoned).params.time,
    `09:00 (${scheduleTimeZone()})`,
  );
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

test("the saved triggers of a procedure come with their text", () => {
  const { savedTriggersOf } = require("../dist/routes/procedures.js");
  const graph = {
    nodes: [
      {
        id: "s",
        kind: "trigger",
        typeId: "cron",
        config: { cron: "0 2 * * *" },
      },
      {
        id: "w",
        kind: "trigger",
        typeId: "webhook",
        config: { path: "/hooks/in", method: "PUT" },
      },
      { id: "m", kind: "trigger", typeId: "manual", config: {} },
      { id: "a", kind: "action", typeId: "log", config: {} },
    ],
    triggerEdges: [],
    dataEdges: [],
  };
  const from = new Date("2026-01-01T00:00:00Z");
  const triggers = savedTriggersOf(graph, from);
  assert.deepEqual(
    triggers.map((t) => t.nodeId),
    ["s", "w", "m"],
  );
  assert.deepEqual(triggers[0].text, {
    key: `${CRON}.daily`,
    params: { time: `02:00 (${scheduleTimeZone()})` },
  });
  assert.match(triggers[0].nextAt, /\S/);
  assert.equal(triggers[1].text, "PUT /hooks/in");
  assert.equal(triggers[1].nextAt, null);
  assert.equal(triggers[2].text, triggers[2].typeName);
});

test("a schedule placed in a procedure is listed in the library in words", () => {
  const { triggerUsageOf } = require("../dist/routes/library.js");
  const schedule = triggerUsageOf({
    id: "s",
    kind: "trigger",
    typeId: "cron",
    config: { cron: "*/15 * * * *" },
  });
  assert.deepEqual(schedule.cronText, {
    key: `${CRON}.everyMinutes`,
    params: { n: "15" },
  });
  assert.equal(schedule.timeZone, scheduleTimeZone());
  const webhook = triggerUsageOf({
    id: "w",
    kind: "trigger",
    typeId: "webhook",
    config: { path: "/hooks/in" },
  });
  assert.equal(webhook.cronText, undefined);
  assert.equal(webhook.path, "/hooks/in");
});
