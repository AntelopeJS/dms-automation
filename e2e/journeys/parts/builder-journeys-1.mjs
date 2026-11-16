import { same } from "../../auto.mjs";
import { createProcedure, manualLog, runsOfProcedure } from "../../procs.mjs";
import { barButtons, eventually, nodeLines, openBuilder, procedureOf, saveState, settle } from "./builder-kit.mjs";
import { allInnerTexts } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */


/** @type {import("../../auto.mjs").Row[]} */
export const builderJourneys1 = [
  {
    id: "the-bar-holds-the-documented-controls-and-their-states",
    title: "the builder's bar holds the procedure switcher, Hide/Show blocks, the name and state, the Enabled switch and save state, Discard, Run now, Test run, Save and the More actions menu in that order; unsaved changes are counted, Discard restores, an empty name blocks Save",
    entryPoint: "/modules/automation/builder?selected=<id>",
    async run(/** @type {Ctx} */ ctx) {
      const name = "Barre d'état ☕ 日本語";
      const id = await createProcedure(ctx, { name, graph: manualLog("hello") });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      const page = tab.page;
      await ctx.verify("the bar of a clean draft", [
        same("buttons left to right", await barButtons(tab), ["Procedures", "Hide blocks", "Discard", "Run now", "Test run Ctrl ↵", "Save Ctrl S", "More actions"]),
        same("the name field", await tab.value({ role: "textbox", name: "Procedure name" }), name),
        tab.shows(/\bDraft\b/),
        tab.visible({ role: "switch", name: "Disabled" }),
        same("the save state", await saveState(tab), "Saved"),
        tab.enabled({ role: "button", name: "Discard" }, { disabled: true }),
        tab.enabled({ role: "button", name: "Save Ctrl S" }, { disabled: true }),
        tab.enabled({ role: "button", name: "Run now" }),
        tab.enabled({ role: "button", name: "Test run Ctrl ↵" }),
      ]);
      await tab.click({ role: "button", name: "More actions" });
      const items = await allInnerTexts(page.getByRole("menuitem"));
      const viewAll = await page.getByRole("menuitem", { name: "View all runs" }).getAttribute("href");
      await ctx.verify("the More actions menu", [
        same("the items", items.map((item) => item.trim()), ["New procedure", "Export JSON", "View all runs", "Delete procedure"]),
        same("View all runs filters the history to this procedure", viewAll, `/modules/automation/runs?procedure=${id}`),
      ]);
      await page.getByRole("menuitem", { name: "New procedure" }).click();
      await ctx.verify("New procedure opens the dialog", [tab.visible({ role: "dialog", name: "New procedure" }), tab.visible({ role: "button", name: "Create and open the builder" })]);
      await page.keyboard.press("Escape");
      await tab.visible({ role: "dialog", name: "New procedure" }, { hidden: true });

      await tab.click({ role: "button", name: "Hide blocks" });
      await ctx.verify("Hide blocks puts the palette away", [
        tab.visible({ role: "button", name: "Show blocks" }),
        tab.visible({ role: "textbox", name: "Search blocks…" }, { hidden: true }),
        same("the toggle is no longer pressed", await page.getByRole("button", { name: "Show blocks" }).getAttribute("aria-pressed"), "false"),
      ]);
      await tab.goto(`/modules/automation/builder?selected=${id}`);
      await tab.visible({ role: "button", name: "Show blocks" });
      await ctx.verify("the choice is remembered across a reload", [tab.visible({ role: "textbox", name: "Search blocks…" }, { hidden: true })]);
      await settle(tab);
      if (await page.getByRole("button", { name: "Show blocks" }).count()) await page.getByRole("button", { name: "Show blocks" }).click();
      await ctx.verify("Show blocks brings it back", [tab.visible({ role: "textbox", name: "Search blocks…" }), tab.visible({ role: "button", name: "Hide blocks" })]);

      await tab.fill({ role: "textbox", name: "Procedure name" }, "Renamed ☕");
      await ctx.verify("one change is one unsaved change", [
        same("the save state", await saveState(tab), "1 unsaved change"),
        tab.enabled({ role: "button", name: "Discard" }),
        tab.enabled({ role: "button", name: "Save Ctrl S" }),
      ]);
      await tab.click({ role: "switch", name: "Disabled" });
      await ctx.verify("two changes are counted in the plural", [same("the save state", await saveState(tab), "2 unsaved changes"), tab.visible({ role: "switch", name: "Enabled" })]);
      await tab.click({ role: "button", name: "Discard" });
      await ctx.verify("Discard restores the saved procedure", [
        same("the name", await tab.value({ role: "textbox", name: "Procedure name" }), name),
        tab.visible({ role: "switch", name: "Disabled" }),
        same("the save state", await saveState(tab), "Saved"),
        tab.enabled({ role: "button", name: "Discard" }, { disabled: true }),
      ]);
      await tab.fill({ role: "textbox", name: "Procedure name" }, "");
      await ctx.verify("an empty name blocks Save", [tab.shows(/Give it a name to save it\./), tab.enabled({ role: "button", name: "Save Ctrl S" }, { disabled: true })]);
      await tab.fill({ role: "textbox", name: "Procedure name" }, "Saved name 🚀");
      await tab.click({ role: "switch", name: "Disabled" });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const stored = await eventually(() => procedureOf(ctx, id), (p) => p.enabled === true);
      await ctx.verify("Save stores the name and the switch", [
        same("name", stored.name, "Saved name 🚀"),
        same("enabled", stored.enabled, true),
        same("the graph is unchanged", nodeLines(stored), ["t trigger/manual", "log action/log.message"]),
        tab.shows(/Saved name 🚀 saved/),
        same("the save state", await saveState(tab), "Saved"),
        tab.visible({ role: "switch", name: "Enabled" }),
      ]);
      await tab.shows(/Healthy|Failing|Degraded|Paused/);
    },
  },
  {
    id: "ctrl-s-saves-ctrl-enter-tests-and-ctrl-p-switches-procedures",
    title: "Ctrl S saves (also from a field), Ctrl Enter runs a test of the draft, Ctrl P opens the procedure switcher; macOS prints the shortcuts with the command key",
    entryPoint: "/modules/automation/builder, keyboard shortcuts",
    async run(/** @type {Ctx} */ ctx) {
      const other = await createProcedure(ctx, { name: "Autre procédure", graph: manualLog("other") });
      const id = await createProcedure(ctx, { name: "Shortcuts", graph: manualLog("keys") });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      const page = tab.page;
      await tab.fill({ role: "textbox", name: "Procedure name" }, "Saved by Ctrl S");
      await page.keyboard.press("Control+s");
      const afterSave = await eventually(() => procedureOf(ctx, id), (p) => p.name === "Saved by Ctrl S");
      await ctx.verify("Ctrl S saves from the name field", [same("name", afterSave.name, "Saved by Ctrl S"), same("the save state", await eventually(() => saveState(tab), (state) => state === "Saved", 5000), "Saved")]);
      await page.locator("header").first().click({ position: { x: 4, y: 4 } });
      await page.keyboard.press("Control+Enter");
      const runs = await eventually(() => runsOfProcedure(ctx, id), (rows) => rows.length > 0);
      await ctx.verify("Ctrl Enter runs a test", [
        same("one run, a test", runs.map((run) => run.kind), ["test"]),
        tab.visible({ role: "tab", name: "Test run" }),
        tab.shows(/Test run · /),
        tab.visible({ role: "button", name: "Exit debug Esc" }),
      ]);
      await page.keyboard.press("Escape");
      await ctx.verify("Escape leaves the test view", [tab.visible({ role: "button", name: "Exit debug Esc" }, { hidden: true })]);
      await page.keyboard.press("Control+p");
      await ctx.verify("Ctrl P opens the switcher", [
        tab.visible({ role: "dialog", name: "Procedures" }),
        tab.visible({ role: "combobox", name: "Go to a procedure…" }),
        tab.shows(/All procedures \(2\)/),
        tab.shows(/Autre procédure/),
        tab.shows(/current/),
      ]);
      await page.getByRole("option", { name: /Autre procédure/ }).click();
      await ctx.verify("picking a procedure opens it", [tab.at(/\/modules\/automation\/builder$/), same("the URL selects it", await eventually(async () => new URL(page.url()).searchParams.get("selected"), (v) => v === other, 4000), other), tab.visible({ role: "textbox", name: "Procedure name" })]);
      await ctx.verify("the other procedure is loaded", [same("name", await tab.value({ role: "textbox", name: "Procedure name" }), "Autre procédure")]);

      const mac = await ctx.tab("admin", "mac");
      await mac.page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
        Object.defineProperty(navigator, "userAgentData", { get: () => ({ platform: "macOS" }) });
        Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
      });
      await openBuilder(ctx, `?selected=${id}`, { tab: mac });
      await mac.page.reload();
      await mac.visible({ role: "button", name: /^Test run/ });
      await ctx.verify("macOS prints the command key", [same("bar", (await barButtons(mac)).filter((b) => /Test run|Save/.test(b)), ["Test run ⌘↵", "Save ⌘S"])]);
    },
  },
];
