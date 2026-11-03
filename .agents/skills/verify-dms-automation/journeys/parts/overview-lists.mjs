import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { action, chain, createEnabled, createProcedure, graph, manualLog, runNow, tedge, trigger } from "../../procs.mjs";
import { distinctAttributes } from "./overview-page.mjs";
import { DAY, HOUR, OVERVIEW, aria, ariaUntil, backdateMany, bodyText, degraded, draft, failing, healthy, open, pause, seedRuns, shows, thisHour, unarmed } from "./overview-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @type {import("../../auto.mjs").Row[]} */
export const listJourneys = [
  {
    id: "recent-runs-lists-the-last-eight-newest-first-each-linking-to-its-trace",
    title: "Recent runs lists the last eight runs, newest first, each linking to its trace, with a Run history link; a failed run says its error and step, a duration is shown in ms or s, a deleted procedure keeps the name its runs were stored with",
    entryPoint: "GET /stats/recent-runs, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const empty = await auto(ctx, "recent runs of an empty project", "GET", "/stats/recent-runs");
      const hour = thisHour();
      const specs = Array.from({ length: 10 }, (_, i) => ({ at: hour - (12 - i) * HOUR, durationMs: [640, 2400, 999, 1000, 5, 12, 1500, 30, 200, 70][i] ?? 1, failed: i === 3 || i === 9 }));
      const { runIds, okId } = await seedRuns(ctx, specs);
      const recent = await auto(ctx, "recent runs", "GET", "/stats/recent-runs");
      const items = list(recent.body, "items");
      const newest = [...runIds].reverse().slice(0, 8);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      const links = await ariaUntil(tab, "main", (s) => s.includes(`run=${newest[7]}`), 20_000).catch(() => "");
      const traceLinks = await distinctAttributes(tab.page.locator(`a[href^="/modules/automation/trace?run="]`), "href");
      await ctx.verify("eight runs, newest first", [
        same("empty at first", list(empty.body, "items").length, 0),
        same("the ids", items.map((item) => item.id), newest),
        same("each links to its trace", items.map((item) => item.to), newest.map((id) => `/modules/automation/trace?run=${id}`)),
        same("the dates", items.map((item) => item.date), newest.map((_, i) => new Date(hour - (12 - (9 - i)) * HOUR).toISOString())),
        same("the durations", items.map((item) => pick(item, "params", "duration")), ["70 ms", "200 ms", "30 ms", "1.5 s", "12 ms", "5 ms", "1.0 s", "999 ms"]),
        same("the tones", items.map((item) => item.tone), ["error", "success", "success", "success", "success", "success", "error", "success"]),
        same("a failed run names its error and step", [pick(items[0], "params", "error"), pick(items[0], "params", "step")], ["seeded", "Fixture failure"]),
        check("the ninth and tenth runs are not listed", !items.some((item) => item.id === runIds[0] || item.id === runIds[1]), "older"),
        check("the page links the same eight runs, in order", JSON.stringify(traceLinks.filter((href) => newest.some((id) => href?.endsWith(id)))) === JSON.stringify(newest.map((id) => `/modules/automation/trace?run=${id}`)), JSON.stringify(traceLinks) + links.slice(0, 100)),
        await shows(tab, "a failed run says error at step and duration", "seeded at Fixture failure · 70 ms"),
        await shows(tab, "a succeeded run", "Succeeded · 200 ms"),
        await shows(tab, "seconds with a decimal", "Succeeded · 1.5 s"),
        await tab.visible({ role: "link", name: "Run history" }),
      ]);
      await auto(ctx, "delete the succeeding procedure", "DELETE", `/procedures/${okId}`);
      const after = await auto(ctx, "recent runs after the deletion", "GET", "/stats/recent-runs");
      await open(tab, OVERVIEW);
      await ctx.verify("a deleted procedure", [
        check("its runs carry its stored name and (deleted)", list(after.body, "items").some((item) => text(item, "title").endsWith("(deleted)") || text(item, "title").startsWith("$dms_automation.feed.deletedProcedure")), JSON.stringify(list(after.body, "items").map((i) => i.title))),
        await shows(tab, "the page says deleted", "(deleted)"),
      ]);
    },
  },
  {
    id: "with-no-run-recent-runs-says-so",
    title: "with no run the Recent runs card says No runs yet",
    entryPoint: "/modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      await draft(ctx, "Never ran");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the empty card", [
        await shows(tab, "title", "No runs yet"),
        await shows(tab, "hint", "Runs show up here as soon as a procedure fires."),
        await shows(tab, "the By trigger card of a project with a Manual draft", "Manual"),
      ]);
    },
  },
  {
    id: "the-procedure-counts-are-the-last-seven-days-add-up-and-link-to-their-tabs",
    title: "Procedures · last 7 days counts the procedures by state (Total, then Failing, Degraded, Healthy, Paused and Drafts), the counts add up to the total, and each count links to the matching tab of the Procedures list",
    entryPoint: "GET /stats/procedures, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      await failing(ctx, "Count failing one", 1);
      await failing(ctx, "Count failing two", 2);
      await degraded(ctx, "Count degraded");
      await healthy(ctx, "Count healthy");
      const gone = await healthy(ctx, "Count paused");
      await pause(ctx, gone.id);
      await draft(ctx, "Count draft");
      await unarmed(ctx, "Count unarmed");
      const older = await degraded(ctx, "Count failed eight days ago");
      const now = Date.now();
      await backdateMany(ctx, [
        { runId: older.failedRunId, startedAt: now - 8 * DAY, durationMs: 5 },
        { runId: older.okRunId, startedAt: now - 7 * DAY + HOUR, durationMs: 5 },
      ]);
      const counts = await auto(ctx, "procedure counts", "GET", "/stats/procedures");
      const items = list(counts.body, "items");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await shows(tab, "wait", "Count failing one");
      const card = await ariaUntil(tab, "dl", (s) => s.includes("Drafts"));
      await ctx.verify("the counts", [
        same("lines in order", items.map((item) => `${text(item, "id")}=${String(item.value)}`), ["total=8", "failing=3", "degraded=1", "healthy=2", "paused=1", "draft=1"]),
        same("they add up", items.slice(1).reduce((sum, item) => sum + Number(item.value), 0), items[0]?.value),
        same("each links to its tab", items.map((item) => item.to), ["/modules/automation/procedures", ...["failing", "degraded", "healthy", "paused", "draft"].map((tabName) => `/modules/automation/procedures?tab=${tabName}`)]),
        same("failing and degraded counts above 0 are marked", items.map((item) => item.tone ?? null), [null, "error", "warning", null, null, null]),
        check("a failure older than 7 days no longer degrades", items.find((i) => i.id === "healthy")?.value === 2, JSON.stringify(items)),
        await shows(tab, "the card title", "PROCEDURES · LAST 7 DAYS"),
        await shows(tab, "the lines", "PROCEDURES · LAST 7 DAYS Total 8 Failing 3 Degraded 1 Healthy 2 Paused 1 Drafts 1"),
        check("the links on the page", ["", "?tab=failing", "?tab=degraded", "?tab=healthy", "?tab=paused", "?tab=draft"].every((q) => card.includes(`/url: /modules/automation/procedures${q}`)), card),
      ]);
      await tab.page.locator("dl").getByRole("link", { name: "3" }).click();
      await ctx.verify("a count opens its tab", [
        await tab.at(/\/modules\/automation\/procedures$/),
        check("tab=failing", new URL(tab.page.url()).searchParams.get("tab") === "failing", tab.page.url()),
      ]);
    },
  },
  {
    id: "by-trigger-counts-the-procedures-each-trigger-type-starts-most-used-first",
    title: "By trigger shows how many procedures each trigger type starts, most used first; a procedure with two triggers of one type is one procedure of that type",
    entryPoint: "GET /stats/triggers, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const none = await auto(ctx, "triggers of an empty project", "GET", "/stats/triggers");
      for (const name of ["Manual A", "Manual B", "Manual C"]) await draft(ctx, name);
      for (const [index, name] of ["Hook A", "Hook B"].entries()) await createProcedure(ctx, { name, graph: chain([trigger("t", "webhook", { path: `/webhooks/by-trigger-${index}`, method: "POST" })]) });
      await createProcedure(ctx, { name: "Clock", graph: chain([trigger("t", "schedule.cron", { cron: "0 9 * * 1" })]) });
      const counts = await auto(ctx, "triggers", "GET", "/stats/triggers");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the counts by type", [
        same("an empty project has none", list(none.body, "items"), []),
        same("most used first", list(counts.body, "items").map((item) => `${text(item, "id")}=${String(item.value)}`), ["manual=3", "webhook=2", "schedule.cron=1"]),
        await shows(tab, "the card", "BY TRIGGER How many procedures each trigger starts"),
        await shows(tab, "the order on the page", "1 Manual 3 2 Webhook 2 3 Schedule (cron) 1"),
      ]);
    },
  },
  {
    id: "by-trigger-counts-a-procedure-once-per-trigger-type",
    title: "By trigger shows how many procedures each trigger type starts: a procedure that places two triggers of one type is one procedure of that type",
    entryPoint: "GET /stats/triggers, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      await createProcedure(ctx, { name: "Two triggers", graph: graph([trigger("a", "verify.event", { topic: "x" }), trigger("b", "verify.event", { topic: "y" }), action("log", "log.message", { message: "m" })], [tedge("a", "log"), tedge("b", "log")]) });
      const counts = await auto(ctx, "triggers", "GET", "/stats/triggers");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("one procedure, one count", [
        same("the type's count", list(counts.body, "items").map((item) => `${text(item, "id")}=${String(item.value)}`), ["verify.event=1"]),
        await shows(tab, "the page", "1 Fixture event 1"),
      ]);
    },
  },
  {
    id: "the-overview-follows-new-runs-live-until-paused-and-resume-catches-up",
    title: "the page follows new runs live: each stored run and each changed procedure makes it read the figures, the chart and the lists again, at most once every 10 seconds; Pause keeps the figures still, the switch counts what came in, and Resume catches up at once",
    entryPoint: "/modules/automation/overview live toolbar",
    async run(/** @type {Ctx} */ ctx) {
      const a = await healthy(ctx, "Live one");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the page starts live", [
        await shows(tab, "one run", "RUNS 1"),
        await shows(tab, "when it was updated", "Updated"),
        check("Live is pressed", await tab.page.getByRole("button", { name: "Live" }).getAttribute("aria-pressed") === "true", "live"),
      ]);
      await runNow(ctx, a.id);
      await ctx.verify("a new run arrives without a reload", [
        await shows(tab, "the card", "RUNS 2", { timeoutMs: 30_000 }),
        await shows(tab, "the line", "2 runs, 0 failed · 1 of 1 procedures enabled"),
      ]);
      await draft(ctx, "A changed procedure");
      await ctx.verify("a changed procedure is read too", [await shows(tab, "the count", "1 of 2 procedures enabled", { timeoutMs: 30_000 })]);
      await tab.click({ role: "button", name: "Pause" });
      await runNow(ctx, a.id);
      await runNow(ctx, a.id);
      await tab.page.waitForTimeout(14_000);
      const paused = await bodyText(tab);
      await ctx.verify("Pause keeps the figures still", [
        check("the figures did not move", paused.includes("RUNS 2") && !paused.includes("RUNS 4"), paused.slice(0, 600)),
        check("the switch counts what came in", /Paused · [1-9]\d* new/.test(paused), paused.slice(0, 600)),
        await tab.visible({ role: "button", name: "Resume" }),
      ]);
      await tab.click({ role: "button", name: "Resume" });
      await ctx.verify("Resume catches up", [await shows(tab, "four runs", "RUNS 4", { timeoutMs: 8000 }), await shows(tab, "live again", "Updated")]);
      /** @type {number[]} */
      const reads = [];
      tab.page.on("request", (request) => {
        if (request.url().includes("/stats/kpi/runs")) reads.push(Date.now());
      });
      for (let index = 0; index < 5; index += 1) await runNow(ctx, a.id);
      await tab.page.waitForTimeout(12_000);
      const quick = reads.length;
      await ctx.verify("a burst is read at most once per interval", [
        check("five runs in a row make one or two reads in twelve seconds", quick >= 1 && quick <= 2, `${quick} reads`),
        await shows(tab, "and the page catches up", "RUNS 9", { timeoutMs: 20_000 }),
      ]);
      void createEnabled; void manualLog; void aria;
    },
  },
];
