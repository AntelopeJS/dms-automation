import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { action, chain, createEnabled, runNow, trigger } from "../../procs.mjs";
import { allInnerTexts } from "./overview-page.mjs";
import { DAY, OVERVIEW, aria, ariaUntil, backdateMany, degraded, failing, healthy, open, pause, shows, unarmed, windowQuery } from "./overview-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const TRACE = "/modules/automation/trace";
const BUILDER = "/modules/automation/builder";
const ROW = (/** @type {string} */ name) => `li:has(span.truncate:text-is(${JSON.stringify(name)}))`;

/**
 * An enabled procedure that fails `failTimes` times and then succeeds.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @param {number} failTimes How many leading runs fail
 * @returns {Promise<{ id: string, runIds: string[] }>} The procedure and its runs, oldest first
 */
async function recovering(ctx, name, failTimes) {
  const key = ctx.unique("recovering");
  const { id } = await createEnabled(ctx, { name, graph: chain([trigger("t"), action("f", "verify.flaky", { key, failTimes })]) });
  /** @type {string[]} */
  const runIds = [];
  for (let index = 0; index <= failTimes; index += 1) runIds.push((await runNow(ctx, id)).runId);
  return { id, runIds };
}

/**
 * @param {unknown} attention The attention answer
 * @returns {string[]} The names of its rows, in order
 */
function rowNames(attention) {
  return list(attention, "items").map((row) => text(row, "name"));
}

/** @type {import("../../auto.mjs").Row[]} */
export const attentionJourneys = [
  {
    id: "needs-attention-lists-failing-then-degraded-then-paused-longest-streak-first-at-most-five",
    title: "Needs attention lists the procedures that need someone, at most five, with Show all (N) when there are more: failing first, then degraded, then paused; within a state the longest run of failures first; each row says how many runs in a row failed at which step and with which error, why the trigger could not be armed, how many runs failed in the period and when the last one did, or when it was paused and by whom; actions Open trace, Dismiss, Resume and Open in builder by state",
    entryPoint: "GET /stats/attention, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const paused = await healthy(ctx, "Paused first");
      await pause(ctx, paused.id);
      const d1 = await recovering(ctx, "Degraded once", 1);
      const d2 = await recovering(ctx, "Degraded twice", 2);
      const f1 = await failing(ctx, "Failing once", 1, "single é");
      const f3 = await failing(ctx, "Failing three times", 3, "triple 日本");
      const attention = await auto(ctx, "attention with five", "GET", "/stats/attention");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      const rowOf = async (/** @type {string} */ name, /** @type {(snapshot: string) => boolean} */ done) => ariaUntil(tab, ROW(name), done);
      const failingThree = await rowOf("Failing three times", (s) => s.includes("Open trace"));
      const failingOne = await rowOf("Failing once", (s) => s.includes("Open trace"));
      const degradedTwo = await rowOf("Degraded twice", (s) => s.includes("Dismiss"));
      const pausedRow = await rowOf("Paused first", (s) => s.includes("Resume"));
      await ctx.verify("five procedures, in order", [
        same("rows", rowNames(attention.body), ["Failing three times", "Failing once", "Degraded twice", "Degraded once", "Paused first"]),
        same("total", pick(attention.body, "total"), 5),
        same("states", list(attention.body, "items").map((row) => text(row, "state")), ["failing", "failing", "degraded", "degraded", "paused"]),
        same("streaks", list(attention.body, "items").map((row) => row.streak), [3, 1, 0, 0, 0]),
        same("failed counts of the degraded", list(attention.body, "items").slice(2, 4).map((row) => row.failed), [2, 1]),
        same("the failing row's last failure", pick(list(attention.body, "items")[0], "lastFailure", "runId"), f3.runIds[2]),
        same("the degraded row's last failure is its failed run", pick(list(attention.body, "items")[3], "lastFailure", "runId"), d1.runIds[0]),
        await shows(tab, "the count", "NEEDS ATTENTION 5"),
        check("failing, many runs: how many in a row, the step and the error", failingThree.includes("Last 3 runs failed at Fixture failure · triple 日本"), failingThree),
        check("failing, one run", failingOne.includes("Last run failed at Fixture failure · single é"), failingOne),
        check("degraded: failed of runs in the period and when", /2 of 3 runs failed in this period · last at \d{1,2}:\d{2} (AM|PM), none since/.test(degradedTwo), degradedTwo),
        check("paused: when and by whom", /Paused by Verify Admin .+ ago/.test(pausedRow), pausedRow),
        check("failing row: Open trace to its last failure", failingThree.includes(`/url: ${TRACE}?run=${f3.runIds[2]}`), failingThree),
        check("failing row: Open in builder", failingThree.includes(`link "Open in builder"`) && failingThree.includes(`${BUILDER}?selected=${f3.id}`), failingThree),
        check("failing row has no Dismiss or Resume", !/Dismiss|Resume/.test(failingThree), failingThree),
        check("degraded row: Open trace, Dismiss, Open in builder", /Open trace/.test(degradedTwo) && /button "Dismiss"/.test(degradedTwo) && /Open in builder/.test(degradedTwo) && degradedTwo.includes(`run=${d2.runIds[1]}`), degradedTwo),
        check("paused row: Resume and Open in builder, no trace", /button "Resume"/.test(pausedRow) && /Open in builder/.test(pausedRow) && !/Open trace/.test(pausedRow), pausedRow),
        check("Failing three times shows before Failing once", (await allInnerTexts(tab.page.locator("li:has(span.truncate)"))).findIndex((t) => t.includes("Failing three times")) < (await allInnerTexts(tab.page.locator("li:has(span.truncate)"))).findIndex((t) => t.includes("Failing once")), "order"),
      ]);
      const arm = await unarmed(ctx, "Cannot arm");
      const paused2 = await healthy(ctx, "Paused second");
      await pause(ctx, paused2.id);
      const crowded = await auto(ctx, "attention with seven", "GET", "/stats/attention");
      await open(tab, OVERVIEW);
      const armRow = await ariaUntil(tab, ROW("Cannot arm"), (s) => s.includes("Open in builder"));
      await ctx.verify("seven procedures, five rows", [
        same("the first five", rowNames(crowded.body), ["Failing three times", "Failing once", "Cannot arm", "Degraded twice", "Degraded once"]),
        same("the whole count", pick(crowded.body, "total"), 7),
        check("the arm failure exists", arm.length > 0, arm),
        check("an unarmed trigger gives its reason", armRow.includes("Trigger not armed: This trigger could not start: the fixture refuses to arm"), armRow),
        check("and has no trace to open", !armRow.includes("Open trace") && armRow.includes(`${BUILDER}?selected=${arm}`), armRow),
        await shows(tab, "the count is the whole list", "NEEDS ATTENTION 7"),
        await shows(tab, "Show all", "Show all (7)"),
        await tab.visible({ role: "link", name: "Show all (7)" }),
        await tab.visible({ role: "link", name: "All procedures" }),
        await shows(tab, "the sixth is not drawn", "Paused first", { not: true, timeoutMs: 1500 }),
      ]);
      await tab.click({ role: "link", name: "Show all (7)" });
      await ctx.verify("Show all opens the Procedures list", [await tab.at(/\/modules\/automation\/procedures$/)]);
      await open(tab, OVERVIEW);
      await aria(tab, ROW("Failing once"));
      await tab.page.locator(ROW("Failing once")).getByRole("link", { name: "Open in builder" }).click();
      await ctx.verify("Open in builder", [await tab.at(/\/modules\/automation\/builder$/), check("selected", new URL(tab.page.url()).searchParams.get("selected") === f1.id, tab.page.url())]);
    },
  },
  {
    id: "dismiss-hides-a-degraded-procedure-until-its-next-failure-and-undo-brings-it-back",
    title: "Dismiss hides a degraded procedure until its next failure and offers Undo in the message that confirms it; with nothing to list the card reads Nothing needs attention",
    entryPoint: "POST/DELETE /procedures/:id/dismiss-attention, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const d = await degraded(ctx, "Dismiss me");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ariaUntil(tab, ROW("Dismiss me"), (s) => s.includes("Dismiss"));
      await tab.page.locator(ROW("Dismiss me")).getByRole("button", { name: "Dismiss" }).click();
      const toast = await shows(tab, "the confirming message", "Dismiss me dismissed until its next failure");
      const afterDismiss = await auto(ctx, "attention after Dismiss", "GET", "/stats/attention");
      await ctx.verify("Dismiss", [
        toast,
        await tab.visible({ role: "button", name: "Undo" }),
        await shows(tab, "the empty card", "Nothing needs attention"),
        await shows(tab, "and its hint", "No procedure is failing, degraded or paused."),
        same("the list is empty", rowNames(afterDismiss.body), []),
        same("total", pick(afterDismiss.body, "total"), 0),
      ]);
      await tab.click({ role: "button", name: "Undo" });
      await tab.visible({ role: "button", name: "Dismiss" });
      const afterUndo = await auto(ctx, "attention after Undo", "GET", "/stats/attention");
      await ctx.verify("Undo", [
        await tab.visible({ role: "button", name: "Dismiss" }),
        await shows(tab, "the row is back", "2 runs failed", { not: true, timeoutMs: 500 }).then(() => shows(tab, "the row is back", "1 of 2 runs failed in this period")),
        same("the list again", rowNames(afterUndo.body), ["Dismiss me"]),
      ]);
      const posted = await auto(ctx, "dismiss through the API", "POST", `/procedures/${d.id}/dismiss-attention`, { body: {} });
      const hidden = await auto(ctx, "attention hidden", "GET", "/stats/attention");
      const undone = await auto(ctx, "undo through the API", "DELETE", `/procedures/${d.id}/dismiss-attention`);
      const back = await auto(ctx, "attention back", "GET", "/stats/attention");
      const unknown = await auto(ctx, "dismiss an unknown procedure", "POST", "/procedures/nope/dismiss-attention", { body: {} });
      await ctx.verify("the routes", [
        same("POST answers the id", pick(posted.body, "_id"), d.id),
        same("hidden", rowNames(hidden.body), []),
        same("DELETE answers the id", pick(undone.body, "_id"), d.id),
        same("listed again", rowNames(back.body), ["Dismiss me"]),
        same("an unknown procedure is a 404", unknown.status, 404),
      ]);
      await auto(ctx, "dismiss again", "POST", `/procedures/${d.id}/dismiss-attention`, { body: {} });
      const read = await auto(ctx, "read the procedure", "GET", `/procedures/${d.id}`);
      const graph = chain([trigger("t"), action("f", "verify.flaky", { key: ctx.unique("second"), failTimes: 1 })]);
      await auto(ctx, "save a graph that fails once more", "PUT", `/procedures/${d.id}`, { body: { name: "Dismiss me", enabled: true, graph, expectedRevision: pick(read.body, "revision") } });
      await runNow(ctx, d.id);
      const stillHidden = await auto(ctx, "attention while its last run failed", "GET", "/stats/attention");
      await runNow(ctx, d.id);
      const revived = await auto(ctx, "attention after its next failure and recovery", "GET", "/stats/attention");
      await ctx.verify("the next failure brings it back", [
        same("a new failure makes it failing, listed", list(stillHidden.body, "items").map((row) => `${text(row, "name")}:${text(row, "state")}`), ["Dismiss me:failing"]),
        same("degraded again after recovering, listed despite the earlier dismissal", list(revived.body, "items").map((row) => `${text(row, "name")}:${text(row, "state")}:${String(row.failed)}`), ["Dismiss me:degraded:2"]),
      ]);
    },
  },
  {
    id: "resume-restarts-a-paused-procedure-and-undo-pauses-it-again-as-it-was",
    title: "Resume on a paused row enables the procedure and offers Undo in the message that confirms it; Undo puts the pause back as it was, with who paused it and when",
    entryPoint: "PUT /procedures/:id/enabled, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const p = await healthy(ctx, "Resume me");
      await pause(ctx, p.id);
      const before = await auto(ctx, "read the paused procedure", "GET", `/procedures/${p.id}`);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ariaUntil(tab, ROW("Resume me"), (s) => s.includes("Resume"));
      await tab.page.locator(ROW("Resume me")).getByRole("button", { name: "Resume" }).click();
      const resumedToast = await shows(tab, "the confirming message", "Resume me resumed");
      const resumed = await auto(ctx, "read the resumed procedure", "GET", `/procedures/${p.id}`);
      await ctx.verify("Resume", [
        resumedToast,
        await tab.visible({ role: "button", name: "Undo" }),
        await shows(tab, "nothing needs attention", "Nothing needs attention"),
        same("the procedure is enabled", pick(resumed.body, "enabled"), true),
      ]);
      await tab.click({ role: "button", name: "Undo" });
      await tab.visible({ role: "button", name: "Resume" });
      const undone = await auto(ctx, "read the procedure after Undo", "GET", `/procedures/${p.id}`);
      const attention = await auto(ctx, "attention after Undo", "GET", "/stats/attention");
      await ctx.verify("Undo", [
        await tab.visible({ role: "button", name: "Resume" }),
        same("paused again", pick(undone.body, "enabled"), false),
        same("by the same person", pick(undone.body, "pausedBy"), pick(before.body, "pausedBy")),
        same("at the same time", pick(undone.body, "pausedAt"), pick(before.body, "pausedAt")),
        same("listed as paused", list(attention.body, "items").map((row) => `${text(row, "name")}:${text(row, "state")}`), ["Resume me:paused"]),
      ]);
    },
  },
  {
    id: "a-failing-procedure-is-listed-whatever-the-period-a-degraded-one-only-with-failures-inside-it",
    title: "a failing procedure is listed whatever the period; a degraded one is listed when runs failed within the period",
    entryPoint: "GET /stats/attention, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const now = Date.now();
      const old = await failing(ctx, "Failing long ago", 1, "old news");
      const rec = await recovering(ctx, "Recovered long ago", 1);
      await backdateMany(ctx, [
        { runId: old.runIds[0] ?? "", startedAt: now - 20 * DAY, durationMs: 5 },
        { runId: rec.runIds[0] ?? "", startedAt: now - 10 * DAY, durationMs: 5 },
        { runId: rec.runIds[1] ?? "", startedAt: now - 9 * DAY, durationMs: 5 },
      ]);
      const day = await auto(ctx, "attention over 24 hours", "GET", `/stats/attention${windowQuery(now - DAY, now)}`);
      const month = await auto(ctx, "attention over 30 days", "GET", `/stats/attention${windowQuery(now - 30 * DAY, now)}`);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("24 hours", [
        same("only the failing one", rowNames(day.body), ["Failing long ago"]),
        await shows(tab, "the page", "Failing long ago"),
        check("no degraded row in the card", (await aria(tab, ROW("Recovered long ago"), 1500)) === "", "row"),
      ]);
      await tab.click({ role: "radio", name: "Last 30 days" });
      await ctx.verify("30 days", [
        same("both", rowNames(month.body), ["Failing long ago", "Recovered long ago"]),
        check("the degraded row appears with the period's runs", (await ariaUntil(tab, ROW("Recovered long ago"), (s) => s.includes("1 of 2 runs failed in this period"))).includes("1 of 2 runs failed in this period"), "row"),
      ]);
      void pause;
    },
  },
];
