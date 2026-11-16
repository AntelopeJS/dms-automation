import { auto, check, fixture, pick, same, text } from "../../auto.mjs";
import { clearLedger, runOf, runsOfProcedure, until } from "../../procs.mjs";
import { declareProcedure, defineType, stepOf, valueOf } from "./interface-calls.mjs";
import { declaration } from "./interface-declare-shared.mjs";
import { armErrorsOf, entriesOf, eventGraph } from "./interface-contract-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * A trigger whose deactivate throws once, or never settles, keeps its handle for a later reconcile.
 *
 * @param {Ctx} ctx The journey
 */
async function checkFailedDeactivates(ctx) {
  const stamp = Date.now().toString(36);
  const stubborn = `verify.stubborn-${stamp}`;
  const topic = `stubborn-${stamp}`;
  await defineType(ctx, {
    kind: "trigger",
    id: stubborn,
    name: "Stubborn",
    cluster: "replicated",
    deactivation: "throw-once",
  });
  await declareProcedure(
    ctx,
    declaration("arm.stubborn", {
      enabled: true,
      graph: eventGraph(topic, stubborn, "s"),
    }),
  );
  await clearLedger(ctx);
  await auto(ctx, "pause", "PUT", "/procedures/arm.stubborn/enabled", {
    body: { enabled: false },
  });
  const refused = await entriesOf(ctx, "deactivate-refused");
  const afterRefusal = await entriesOf(ctx, "deactivate");
  await auto(ctx, "resume", "PUT", "/procedures/arm.stubborn/enabled", {
    body: { enabled: true },
  });
  await auto(ctx, "pause again", "PUT", "/procedures/arm.stubborn/enabled", { body: { enabled: false } });
  const retried = await until(
    () => entriesOf(ctx, "deactivate"),
    (entries) => entries.length >= 1,
  );
  const hangType = `verify.slow-leaver-${stamp}`;
  const hangTopic = `slow-${stamp}`;
  await defineType(ctx, {
    kind: "trigger",
    id: hangType,
    name: "Slow leaver",
    cluster: "replicated",
    deactivation: "hang-once",
  });
  await declareProcedure(
    ctx,
    declaration("arm.slow-leaver", {
      enabled: true,
      graph: eventGraph(hangTopic, hangType, "s"),
    }),
  );
  await clearLedger(ctx);
  const pausing = Date.now();
  await auto(ctx, "pause while deactivate never settles", "PUT", "/procedures/arm.slow-leaver/enabled", { body: { enabled: false } });
  const pausedFor = Date.now() - pausing;
  await auto(ctx, "resume", "PUT", "/procedures/arm.slow-leaver/enabled", {
    body: { enabled: true },
  });
  await auto(ctx, "pause again", "PUT", "/procedures/arm.slow-leaver/enabled", { body: { enabled: false } });
  const slow = await until(
    () => entriesOf(ctx, "deactivate"),
    (entries) => entries.length >= 1,
  );
  await ctx.verify("a deactivate that never settles", [
    check("deactivate was given about 10 seconds", pausedFor >= 9500 && pausedFor < 20000, `${pausedFor} ms`),
    same(
      "the handle is kept and deactivated by a later reconcile",
      slow.map((entry) => entry.topic),
      [hangTopic],
    ),
  ]);
  await ctx.verify("a failed deactivate", [
    same(
      "the first deactivate refused",
      refused.map((entry) => entry.topic),
      [topic],
    ),
    same("it did not complete", afterRefusal.length, 0),
    same(
      "a later reconcile deactivates the same handle",
      retried.map((entry) => entry.topic),
      [topic],
    ),
  ]);
}

export const armingJourneys = [
  {
    id: "unregistering-a-trigger-type-deactivates-its-handles-and-a-let-go-handle-starts-no-run",
    title: "removing a trigger type calls deactivate on its active handles before the unregister call returns; a handle let go starts no run even if its trigger still emits; registering the type again re-arms",
    entryPoint: "UnregisterTriggerType, POST /verify-auto/emit, GET /procedures",
    async run(/** @type {Ctx} */ ctx) {
      const topic = ctx.unique("unreg").replace(/\W+/g, "-");
      const leaderTopic = `${topic}-leader`;
      const replicated = await declareProcedure(
        ctx,
        declaration("unreg.replicated", {
          enabled: true,
          graph: eventGraph(topic, "verify.event", "r"),
        }),
      );
      const singleton = await declareProcedure(
        ctx,
        declaration("unreg.singleton", {
          enabled: true,
          graph: eventGraph(leaderTopic, "verify.leader-event", "s"),
        }),
      );
      await fixture(ctx, "emit replicated", "POST", "/emit", {
        topic,
        payload: { topic, value: "один 日本" },
      });
      await fixture(ctx, "emit singleton", "POST", "/emit", {
        topic: leaderTopic,
        payload: { topic: leaderTopic, value: "two" },
      });
      const first = await until(
        () => runsOfProcedure(ctx, "unreg.replicated"),
        (rows) => rows.length >= 1,
      );
      const second = await until(
        () => runsOfProcedure(ctx, "unreg.singleton"),
        (rows) => rows.length >= 1,
      );
      const firstRun = await runOf(ctx, text(first[0], "_id"));
      await ctx.verify("both cluster modes fire on one instance", [
        same("created", [replicated.result.status, singleton.result.status], ["created", "created"]),
        same("the replicated trigger's payload", valueOf(stepOf(firstRun, "ev").output), { topic, value: "один 日本" }),
        same("one run each", [first.length, second.length], [1, 1]),
      ]);
      try {
        await clearLedger(ctx);
        await fixture(ctx, "unregister verify.event", "POST", "/types/unregister", { kind: "trigger", id: "verify.event" });
        const afterUnregister = await entriesOf(ctx, "deactivate");
        await ctx.verify("deactivate was called before the unregister returned", [
          same(
            "for the replicated handle only",
            afterUnregister.map((entry) => [entry.type, entry.topic]),
            [["verify.event", topic]],
          ),
        ]);
        const stale = await fixture(ctx, "a let-go handle still emits", "POST", "/emit", { topic, force: true, payload: { topic, value: "late" } });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const errors = await until(
          () => armErrorsOf(ctx, "unreg.replicated"),
          (found) => Object.keys(found).length > 0,
        );
        await ctx.verify("a let-go handle starts no run", [
          same("the stale handle did emit", pick(stale.body, "emitted"), 1),
          same("no new run", (await runsOfProcedure(ctx, "unreg.replicated")).length, 1),
          same("the procedure shows the type as not available", pick(errors, "ev", "message"), 'trigger type "verify.event" is not available'),
          same("the singleton procedure is untouched", (await runsOfProcedure(ctx, "unreg.singleton")).length, 1),
        ]);
        await clearLedger(ctx);
        await fixture(ctx, "register verify.event again", "POST", "/types/register", { kind: "trigger", id: "verify.event" });
        const rearmed = await until(
          () => entriesOf(ctx, "activate"),
          (entries) => entries.length >= 1,
        );
        await fixture(ctx, "emit again", "POST", "/emit", {
          topic,
          payload: { topic, value: "again" },
        });
        const rows = await until(
          () => runsOfProcedure(ctx, "unreg.replicated"),
          (found) => found.length >= 2,
        );
        await ctx.verify("registering the type again arms the procedure", [
          same(
            "activated with its settings",
            rearmed.map((entry) => [entry.type, entry.topic]),
            [["verify.event", topic]],
          ),
          same("a new run", rows.length, 2),
          same("the arming error is gone", Object.keys(await armErrorsOf(ctx, "unreg.replicated")), []),
        ]);
        await clearLedger(ctx);
        await auto(ctx, "pause", "PUT", "/procedures/unreg.replicated/enabled", { body: { enabled: false } });
        const paused = await entriesOf(ctx, "deactivate");
        const dropped = await fixture(ctx, "emit to a paused procedure", "POST", "/emit", { topic, payload: { topic, value: "paused" } });
        await ctx.verify("pausing deactivates the trigger", [
          same(
            "deactivate for this topic",
            paused.map((entry) => entry.topic),
            [topic],
          ),
          same("nobody listens", pick(dropped.body, "emitted"), 0),
        ]);
      } finally {
        await fixture(ctx, "make sure verify.event is registered", "POST", "/types/register", { kind: "trigger", id: "verify.event" });
      }
    },
  },
  {
    id: "an-arming-failure-is-not-a-registration-error-and-the-next-reconcile-retries",
    title: "a trigger whose activate throws or never settles is an arming failure (the procedure shows the reason, the declaration succeeds), activate gets 10 seconds, the next reconcile retries, and a failed deactivate keeps the handle for a later retry",
    entryPoint: "TriggerType.activate throwing or hanging, TriggerType.deactivate throwing, GET /procedures",
    async run(/** @type {Ctx} */ ctx) {
      await clearLedger(ctx);
      const bad = await declareProcedure(
        ctx,
        declaration("arm.bad", {
          enabled: true,
          graph: eventGraph("x", "verify.bad-arm", "never"),
        }),
      );
      const errors = await armErrorsOf(ctx, "arm.bad");
      const attempts = (await entriesOf(ctx, "activate-refused")).length;
      await ctx.verify("a throwing activate", [
        same("the declaration still succeeds and is enabled", [bad.ok, bad.result.status, bad.result.enabled], [true, "created", true]),
        same("the procedure carries the reason", [pick(errors, "ev", "code"), pick(errors, "ev", "message")], ["armFailed", "the fixture refuses to arm"]),
        check("activate was tried", attempts >= 1, attempts),
      ]);
      await auto(ctx, "pause", "PUT", "/procedures/arm.bad/enabled", {
        body: { enabled: false },
      });
      const paused = (await entriesOf(ctx, "activate-refused")).length;
      await auto(ctx, "resume", "PUT", "/procedures/arm.bad/enabled", {
        body: { enabled: true },
      });
      const resumed = await until(
        async () => (await entriesOf(ctx, "activate-refused")).length,
        (count) => count > paused,
      );
      await ctx.verify("the next reconcile retries", [check("activate was tried again after a resume", resumed > paused, [attempts, paused, resumed])]);
      await checkFailedDeactivates(ctx);
      const started = Date.now();
      const hang = await declareProcedure(
        ctx,
        declaration("arm.hang", {
          enabled: true,
          graph: eventGraph("x", "verify.hang-arm", "never"),
        }),
      );
      const elapsed = Date.now() - started;
      const hangErrors = await armErrorsOf(ctx, "arm.hang");
      await ctx.verify("an activate that never settles", [
        same("the declaration succeeds", [hang.ok, hang.result.status], [true, "created"]),
        check("activate was given about 10 seconds", elapsed >= 9500 && elapsed < 20000, `${elapsed} ms`),
        same("the reason names the type, the procedure, the node and the limit", pick(hangErrors, "ev", "message"), "[dms-automation] activate verify.hang-arm for arm.hang#ev timed out after 10000ms"),
      ]);
    },
  },
];
