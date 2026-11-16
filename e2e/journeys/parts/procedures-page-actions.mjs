import { auto, check, list, same, text } from "../../auto.mjs";
import { runNow } from "../../procs.mjs";
import { summaryOf } from "./procedures-common.mjs";
import { seedStates } from "./procedures-page-seed.mjs";
import { dialogText, openMenu, openPage, pickMenuItem, rowsWhen } from "./procedures-page-ui.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const PAGE_URL = "/modules/automation/procedures";



export const journeys = [
  {
    id: "the-row-menu-offers-the-documented-actions-for-each-state",
    title: "the row menu holds Open in builder, Run now, Pause or Resume, Open last run, View runs, Duplicate and Delete: Drafts have no Run now or Resume, Open last run needs a run",
    entryPoint: "/modules/automation/procedures, Actions for <procedure>",
    async run(/** @type {Ctx} */ ctx) {
      await seedStates(ctx);
      const tab = await openPage(ctx, /Okay one/);
      await rowsWhen(tab, 7);
      const menus = {};
      for (const name of ["Bad one", "Arm one", "Hook one", "Okay one", "Cron one", "Draft one"]) {
        menus[name] = await openMenu(tab, name);
        await tab.page.keyboard.press("Escape");
        await tab.page.waitForTimeout(300);
      }
      await ctx.verify("menus by state", [
        same("failing with a run", menus["Bad one"], ["Open in builder", "Run now", "Pause", "Open last run", "View runs", "Duplicate", "Delete"]),
        same("failing and never ran: no Open last run", menus["Arm one"], ["Open in builder", "Run now", "Pause", "View runs", "Duplicate", "Delete"]),
        same("healthy and never ran: no Open last run", menus["Hook one"], ["Open in builder", "Run now", "Pause", "View runs", "Duplicate", "Delete"]),
        same("healthy with a run", menus["Okay one"], ["Open in builder", "Run now", "Pause", "Open last run", "View runs", "Duplicate", "Delete"]),
        same("paused and never ran: Resume instead of Pause", menus["Cron one"], ["Open in builder", "Run now", "Resume", "View runs", "Duplicate", "Delete"]),
        same("a draft: no Run now, no Pause, no Resume", menus["Draft one"], ["Open in builder", "View runs", "Duplicate", "Delete"]),
      ]);
    },
  },
  {
    id: "row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say",
    title: "Pause, Resume, Duplicate and Run now act on the procedure after their toast or confirmation, and Open in builder, Open last run and View runs open the documented pages",
    entryPoint: "/modules/automation/procedures, Actions for <procedure>",
    async run(/** @type {Ctx} */ ctx) {
      const ids = await seedStates(ctx);
      const tab = await openPage(ctx, /Okay one/);
      await rowsWhen(tab, 7);
      await pickMenuItem(tab, "Okay one", "Pause");
      const pausedToast = await tab.shows(/“Okay one” paused/);
      const afterPause = await summaryOf(ctx, ids.okay);
      await pickMenuItem(tab, "Okay one", "Resume");
      const resumedToast = await tab.shows(/“Okay one” resumed/);
      const afterResume = await summaryOf(ctx, ids.okay);
      await pickMenuItem(tab, "Okay one", "Duplicate");
      const duplicatedToast = await tab.shows(/“Okay one” duplicated: the copy is disabled/);
      const all = (await auto(ctx, "list", "GET", "/procedures?limit=50")).body;
      const copy = list(all, "results").find((p) => p.name === "Okay one (copy)");
      await pickMenuItem(tab, "Okay one", "Run now");
      const confirm = await dialogText(tab);
      await tab.page.getByRole("dialog").last().getByRole("button", { name: "Cancel" }).click();
      const untouched = (await summaryOf(ctx, ids.okay)).runs;
      await pickMenuItem(tab, "Okay one", "Run now");
      await dialogText(tab);
      await tab.page.getByRole("dialog").last().getByRole("button", { name: "Run now", exact: true }).click();
      const finished = await tab.shows(/Run finished/);
      const runs = (await summaryOf(ctx, ids.okay)).runs;
      await ctx.verify("the actions", [
        same("Pause toast, and the procedure is paused", [pausedToast.pass, afterPause.status], [true, "paused"]),
        same("Resume toast, and the procedure is enabled again", [resumedToast.pass, afterResume.status], [true, "healthy"]),
        same("Duplicate toast, and the copy is a disabled draft", [duplicatedToast.pass, copy?.enabled, copy?.name], [true, false, "Okay one (copy)"]),
        same("Run now asks first, with the documented question and warning", confirm.replace(/(?: ?(?:ESC to cancel|Cancel|Run now))+$/, "").trim(), "Run “Okay one” now? Runs the saved version with the payload of its last real call, or an empty payload if it was never called. Side effects are real."),
        same("Cancel runs nothing", untouched, 1),
        same("confirming runs it once: toast, one more run", [finished.pass, runs], [true, 2]),
      ]);
      const target = async (/** @type {string} */ name, /** @type {string} */ item) => {
        await tab.goto(PAGE_URL);
        await tab.shows(/Okay one/);
        await pickMenuItem(tab, name, item);
        await tab.page.waitForTimeout(1500);
        return new URL(tab.page.url()).pathname + new URL(tab.page.url()).search;
      };
      const last = await summaryOf(ctx, ids.okay);
      const urls = [await target("Okay one", "Open last run"), await target("Okay one", "View runs"), await target("Okay one", "Open in builder")];
      await ctx.verify("the links", [
        same("Open last run opens the trace of the last run", urls[0], `/modules/automation/trace?run=${text(last, "lastRunId")}`),
        same("View runs opens the run history on this procedure", [urls[1].split("?")[0], new URLSearchParams(urls[1].split("?")[1]).get("procedure")], ["/modules/automation/runs", ids.okay]),
        same("Open in builder opens the procedure", urls[2], `/modules/automation/builder?selected=${ids.okay}`),
      ]);
      await tab.goto(PAGE_URL);
      await tab.shows(/Okay one/);
      await tab.page.getByRole("link", { name: /^Okay one/ }).first().click();
      const byName = await tab.at(/\/builder$/, { timeoutMs: 15_000 });
      await tab.goto(PAGE_URL);
      await tab.shows(/Hook one/);
      await tab.page.locator("tbody tr", { hasText: "Hook one" }).dblclick();
      const byDouble = await tab.at(/\/builder$/, { timeoutMs: 15_000 });
      await ctx.verify("opening", [byName, byDouble, same("the builder opens on the double-clicked procedure", new URL(tab.page.url()).searchParams.get("selected"), ids.hook)]);
    },
  },
  {
    id: "delete-asks-first-and-an-enabled-procedure-by-typing-its-name",
    title: "Delete asks for confirmation: a draft is told the delete cannot be undone, an enabled procedure is told how often it ran this week, offered Pause instead, shown what stops and must have its name typed",
    entryPoint: "/modules/automation/procedures, Actions > Delete",
    async run(/** @type {Ctx} */ ctx) {
      const ids = await seedStates(ctx);
      await runNow(ctx, ids.okay, {});
      const tab = await openPage(ctx, /Okay one/);
      await rowsWhen(tab, 7);
      await pickMenuItem(tab, "Draft one", "Delete");
      const draft = await dialogText(tab);
      await tab.page.getByRole("dialog").last().getByRole("button", { name: "Cancel" }).click();
      await pickMenuItem(tab, "Hook one", "Delete");
      const hook = await dialogText(tab);
      await tab.page.getByRole("dialog").last().getByRole("button", { name: "Cancel" }).click();
      await tab.page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10_000 });
      await pickMenuItem(tab, "Okay one", "Delete");
      const okay = await dialogText(tab);
      const dialogBox = tab.page.getByRole("dialog").last();
      const tryDelete = async (/** @type {string} */ typed) => {
        await dialogBox.getByRole("textbox").fill(typed);
        await dialogBox.getByRole("button", { name: "Delete procedure" }).click();
        await tab.page.waitForTimeout(1500);
        return { open: await dialogBox.isVisible(), status: (await auto(ctx, "read it after the attempt", "GET", `/procedures/${ids.okay}`)).status };
      };
      const emptyTry = await tryDelete("");
      const wrongTry = await tryDelete("Okay on");
      const caseTry = await tryDelete("okay one");
      await dialogBox.getByRole("textbox").fill("Okay one");
      await dialogBox.getByRole("button", { name: "Delete procedure" }).click();
      const rows = await rowsWhen(tab, 6);
      const gone = await auto(ctx, "read the deleted procedure", "GET", `/procedures/${ids.okay}`);
      await pickMenuItem(tab, "Draft one", "Delete");
      await dialogText(tab);
      await tab.page.getByRole("dialog").last().getByRole("button", { name: "Delete procedure" }).click();
      await rowsWhen(tab, 5);
      const draftGone = await auto(ctx, "read the deleted draft", "GET", `/procedures/${ids.draft}`);
      await ctx.verify("the dialogs", [
        check("a draft: title, no Pause suggestion, Export JSON first, run history stays", /^Delete “Draft one”\? The graph is deleted for good: this can’t be undone\. Export JSON from the builder first to keep a copy\. Its run history stays until retention removes it\. .*Delete procedure$/.test(draft), draft),
        check("an enabled webhook procedure: Pause suggested, what stops, name to type", /^Delete “Hook one”\? This procedure is enabled and did not run this week\. Only need it to stop\? Pause it instead: that keeps the graph and can be undone\. Deleting can’t be undone\. Webhook stops POST \/hooks\/stripe Type Hook one to confirm .*Delete procedure$/.test(hook), hook),
        check("it says how often it ran this week (twice)", /This procedure is enabled and ran 2 times this week\./.test(okay), okay),
        same("nothing typed, a name that is not it, or the name in another case deletes nothing and keeps the dialog", [emptyTry, wrongTry, caseTry], Array(3).fill({ open: true, status: 200 })),
        same("the typed name deletes it: row gone, 404 from the API", [rows.length, gone.status], [6, 404]),
        same("a draft deletes without typing", draftGone.status, 404),
      ]);
    },
  },
];
