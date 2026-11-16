import { auto, check, isRow, isText, list, parseJson, same, text } from "../../auto.mjs";
import { OVERVIEW, bodyText, open, shows } from "./overview-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */

const FIRST_RUN_TEXT =
  "A procedure listens for a trigger — a webhook, a schedule or a click — then runs actions like HTTP calls, emails or data updates. Start from a recipe: name it, and the builder opens with the trigger in place.";

/**
 * The trigger nodes of a stored procedure.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<{ procedure: Record<string, unknown>, triggers: Record<string, unknown>[] }>} The procedure and its trigger nodes
 */
async function triggersOf(ctx, id) {
  const read = await auto(ctx, "read the procedure", "GET", `/procedures/${id}`);
  const procedure = isRow(read.body) ? read.body : {};
  const graph = isText(procedure.graph) ? parseJson(procedure.graph) : procedure.graph;
  return { procedure, triggers: list(graph, "nodes").filter((node) => node.kind === "trigger") };
}

/** @type {import("../../auto.mjs").Row[]} */
export const recipeJourneys = [
  {
    id: "with-no-procedure-the-banner-offers-three-recipes",
    title: "with no procedure the banner reads Automate your first procedure and offers the recipes Forward a webhook, Send a scheduled digest and Run it on demand, in that order, over a primary banner",
    entryPoint: "GET /stats/health, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const health = await auto(ctx, "banner of an empty project", "GET", "/stats/health");
      const actions = list(health.body, "actions");
      await ctx.verify("the banner route", [
        same("tone", text(health.body, "tone"), "primary"),
        same("title", text(health.body, "title"), "$dms_automation.firstRun.title"),
        same("description", text(health.body, "description"), "$dms_automation.firstRun.description"),
        same("the recipes, in order", actions.map((a) => a.label), ["$dms_automation.recipes.webhook.title", "$dms_automation.recipes.digest.title", "$dms_automation.recipes.manual.title"]),
        same("each recipe opens a modal", actions.map((a) => text(a, "target", "type")), ["modal", "modal", "modal"]),
        same("each recipe's modal title is its own", actions.map((a) => text(a, "target", "title")), actions.map((a) => text(a, "label"))),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the overview page", [
        await shows(tab, "title", "Automate your first procedure"),
        await shows(tab, "description", FIRST_RUN_TEXT),
        await tab.visible({ role: "button", name: "Forward a webhook" }),
        await tab.visible({ role: "button", name: "Send a scheduled digest" }),
        await tab.visible({ role: "button", name: "Run it on demand" }),
        await shows(tab, "no failing state is claimed", "procedures failing", { not: true, timeoutMs: 1500 }),
      ]);
    },
  },
  {
    id: "a-recipe-opens-new-procedure-with-its-trigger-and-creates-a-disabled-draft",
    title: "each recipe opens the New procedure dialog with its trigger picked; naming it and choosing Create and open the builder opens the builder on a disabled draft holding that trigger: a webhook on POST /webhooks/<name in lower case with dashes>, a schedule on 0 9 * * 1, or a manual trigger",
    entryPoint: "/modules/automation/overview recipes, POST /procedures/new",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      const recipes = [
        { button: "Forward a webhook", hint: "Receive events from Stripe or Shopify and push them to another system.", picked: "A webhook is called", name: "Forward Stripe Events", typeId: "webhook", config: { path: "/webhooks/forward-stripe-events", method: "POST" } },
        { button: "Send a scheduled digest", hint: "Every Monday at 09:00, send a summary of last week.", picked: "On a schedule", name: "Weekly digest", typeId: "schedule.cron", config: { cron: "0 9 * * 1" } },
        { button: "Run it on demand", hint: "A procedure you start yourself, with Run now or from the API.", picked: "I run it", name: "On demand", typeId: "manual", config: {} },
      ];
      const created = [];
      for (const recipe of recipes) {
        await open(tab, OVERVIEW);
        await tab.click({ role: "button", name: recipe.button });
        await ctx.verify(`the ${recipe.button} dialog`, [
          await tab.visible({ role: "dialog", name: recipe.button }),
          await shows(tab, "the recipe's hint", recipe.hint),
          check("its trigger is picked", await tab.page.getByRole("radio", { name: recipe.picked }).isChecked(), recipe.picked),
          await shows(tab, "the button", "Create and open the builder"),
        ]);
        await tab.fill({ role: "textbox", name: "Name" }, recipe.name);
        await tab.click({ role: "button", name: "Create and open the builder" });
        const at = await tab.at(/\/modules\/automation\/builder$/);
        const selected = new URL(tab.page.url()).searchParams.get("selected") ?? "";
        const { procedure, triggers } = await triggersOf(ctx, selected);
        created.push(selected);
        const removed = await auto(ctx, "delete the draft so the recipes come back", "DELETE", `/procedures/${selected}`);
        await ctx.verify(`the draft of ${recipe.button}`, [
          at,
          check("the builder names the new procedure", selected.length > 0, tab.page.url()),
          same("its name", procedure.name, recipe.name),
          same("it is a disabled draft", procedure.enabled, false),
          same("its only node is the recipe's trigger", triggers.map((node) => node.typeId), [recipe.typeId]),
          same("the trigger's settings", triggers[0]?.config, recipe.config),
          check("the draft is deleted again", removed.status === 200, removed.body),
        ]);
      }
      await ctx.verify("three different drafts were made", [same("three ids", new Set(created).size, 3)]);
    },
  },
  {
    id: "new-procedure-in-the-header-opens-the-dialog-with-a-webhook-picked",
    title: "New procedure in the header opens the same dialog at any time with A webhook is called picked and the line that it starts as a disabled draft; Run history in the header opens the run history",
    entryPoint: "/modules/automation/overview header",
    async run(/** @type {Ctx} */ ctx) {
      await auto(ctx, "a draft so the recipes are gone", "POST", "/procedures/new", { body: { name: "Existing", trigger: "manual" } });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("with a procedure the recipes are gone", [
        await shows(tab, "no first-run title", "Automate your first procedure", { not: true }),
        await shows(tab, "the idle title shows", "Nothing ran in this window"),
      ]);
      await tab.click({ role: "button", name: "New procedure" });
      await ctx.verify("the dialog", [
        await tab.visible({ role: "dialog", name: "New procedure" }),
        await shows(tab, "its description", "Name it and pick what starts it. It starts as a disabled draft: nothing fires until you enable it."),
        check("A webhook is called is picked", await tab.page.getByRole("radio", { name: "A webhook is called" }).isChecked(), "webhook"),
        check("On a schedule is not", !(await tab.page.getByRole("radio", { name: "On a schedule" }).isChecked()), "schedule"),
        await shows(tab, "the schedule card text", "Every hour, every Monday at 09:00…"),
        await shows(tab, "the manual card text", "With Run now, or from the API"),
        await shows(tab, "the webhook card text", "An HTTP call from Stripe, Shopify or any service"),
      ]);
      await tab.click({ role: "button", name: "Cancel" });
      await tab.page.getByRole("link", { name: "Run history" }).first().click();
      await ctx.verify("Run history", [await tab.at(/\/modules\/automation\/runs$/), check("page text", (await bodyText(tab)).includes("Run history"), tab.page.url())]);
    },
  },
];
