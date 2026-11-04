import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { action, chain, createEnabled, createProcedure, manualLog, runNow, trigger, withConfig } from "../../procs.mjs";
import { byText } from "./overview-page.mjs";
import { ariaUntil, bodyText, open, pause, shows } from "./overview-kit.mjs";
import { LIBRARY, createTemplate, procedureWithGroups } from "./library-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */

/**
 * Clicks the Enabled switch of the open entry.
 *
 * @param {Tab} tab The tab
 * @param {string} name The entry's name
 * @returns {Promise<void>}
 */
async function flip(tab, name) {
  await tab.page.getByRole("switch", { name: `Enable ${name}` }).click();
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} kind actions or triggers
 * @param {string} id The type
 * @returns {Promise<unknown>} Whether the library lists it enabled
 */
async function enabledOf(ctx, kind, id) {
  const answer = await auto(ctx, `list ${kind}`, "GET", `/${kind}`);
  return list(answer.body).find((entry) => entry.id === id)?.enabled;
}

/** @type {import("../../auto.mjs").Row[]} */
export const useJourneys = [
  {
    id: "used-by-lists-the-procedures-with-their-state-where-the-node-sits-and-open",
    title: "Used by lists the procedures that use an entry, each with its state, where the node sits (in a group or through a template) and Open to open it in the builder; the list shows how many procedures use it, and an unused entry says so",
    entryPoint: "GET /library/usage/:catalog, /modules/automation/library",
    async run(/** @type {Ctx} */ ctx) {
      const template = await createTemplate(ctx, "Shared template");
      const grouped = await procedureWithGroups(ctx, "Used A grouped", template);
      const healthyOne = await createEnabled(ctx, { name: "Used B healthy", graph: chain([trigger("t"), { id: "greet", kind: "action", typeId: "log.message", label: "Send greeting", config: { message: "hi" }, position: { x: 0, y: 0 } }]) });
      await runNow(ctx, healthyOne.id);
      const paused = await createEnabled(ctx, { name: "Used C paused", graph: manualLog("paused") });
      await pause(ctx, paused.id);
      const broken = await createEnabled(ctx, { name: "Used D failing", graph: chain([trigger("t"), action("log", "log.message", { message: "x" }), action("f", "verify.fail", {})]) });
      await runNow(ctx, broken.id);
      const usage = await auto(ctx, "usage of the actions", "GET", "/library/usage/actions");
      const uses = list(pick(usage.body, "log.message"));
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, `${LIBRARY}?tab=actions&item=log.message`);
      await ariaUntil(tab, "h2", (s) => s.includes("Log"));
      const groupUse = uses.find((use) => use.procedureId === grouped && Array.isArray(use.groupPath) && use.groupPath.length > 0);
      const templateUse = uses.find((use) => use.procedureId === grouped && use.viaTemplate);
      await ctx.verify("the usage route", [
        same("every node placing the action, across procedures", uses.map((use) => `${text(use, "procedureName")}/${text(use, "nodeId")}/${text(use, "state")}`).sort(byText), ["Used A grouped/i1/draft", "Used A grouped/inner/draft", "Used B healthy/greet/healthy", "Used C paused/log/paused", "Used D failing/log/failing"]),
        same("the local group", [groupUse?.groupPath, groupUse?.groupLabel, groupUse?.viaTemplate], [["g1"], "Notify team", null]),
        same("the template", [templateUse?.viaTemplate, templateUse?.groupPath], [{ id: template, name: "Shared template" }, []]),
        same("a node's own name", uses.find((use) => use.procedureId === healthyOne.id)?.nodeLabel, "Send greeting"),
        same("an unused action has no entry", pick(usage.body, "verify.sleep"), undefined),
        same("an unknown catalog is a 404", (await auto(ctx, "unknown catalog", "GET", "/library/usage/widgets")).status, 404),
      ]);
      await ctx.verify("the page", [
        await shows(tab, "the list says how many procedures use it", "Log Writes a message (and an optional value) to the run log 4 uses"),
        await shows(tab, "the card, by state then name", "USED BY 4 Disabling it stops the 2 enabled procedures that use it. Failing Used D failing Log Open Healthy Used B healthy Send greeting Open Paused Used C paused Log Open Draft Used A grouped Log · in group Notify team Open Log · via template Shared template Open"),
      ]);
      const links = await tab.page.getByRole("button", { name: "Open" }).count();
      await tab.page.locator("div.min-w-0.items-center", { hasText: "via template Shared template" }).getByRole("button", { name: "Open" }).click();
      await ctx.verify("Open", [
        check("one Open per node", links === 5, String(links)),
        await tab.at(/\/modules\/automation\/builder$/),
        check("the builder is opened on the procedure and the node", new URL(tab.page.url()).searchParams.get("selected") === grouped && new URL(tab.page.url()).searchParams.get("node") === "i1", tab.page.url()),
      ]);
      await open(tab, `${LIBRARY}?tab=actions&item=log.message`);
      await tab.page.locator("div.min-w-0.items-center", { hasText: "in group Notify team" }).getByRole("button", { name: "Open" }).click();
      await ctx.verify("Open inside a group", [await tab.at(/\/modules\/automation\/builder$/), check("the path names the group", new URL(tab.page.url()).searchParams.get("path") === "g1" && new URL(tab.page.url()).searchParams.get("node") === "inner", tab.page.url())]);
      await open(tab, `${LIBRARY}?tab=actions&item=verify.sleep`);
      await ctx.verify("an unused entry", [await shows(tab, "says so", "No procedure uses this block yet."), await shows(tab, "counts none", "USED BY 0")]);
    },
  },
  {
    id: "a-webhook-use-shows-its-full-url-built-on-the-api-base-url",
    title: "a webhook trigger shows the full URL of each use under Used by, built on the DMS apiBaseUrl (trailing slash dropped); a loopback or empty apiBaseUrl is reported as not configured",
    entryPoint: "GET /library/webhook-base, /modules/automation/library?tab=triggers&item=webhook",
    async run(/** @type {Ctx} */ ctx) {
      await createProcedure(ctx, { name: "Hook one", graph: chain([trigger("t", "webhook", { path: "/webhooks/hook-one", method: "POST" })]) });
      await createProcedure(ctx, { name: "Hook two", graph: chain([trigger("t", "webhook", { path: "/webhooks/hook-two", method: "PUT" })]) });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      const base = await auto(ctx, "webhook base", "GET", "/library/webhook-base");
      const web = ctx.state.webUrl;
      await open(tab, `${LIBRARY}?tab=triggers&item=webhook`);
      await ctx.verify("the project's base URL", [
        same("the route: a loopback address counts as not configured", base.body, { url: web, configured: false }),
        await shows(tab, "the first use", `POST ${web}/webhooks/hook-one`),
        await shows(tab, "the second use, with its method", `PUT ${web}/webhooks/hook-two`),
      ]);
      await withConfig(ctx, { VERIFY_AUTO_API_BASE_URL: "https://hooks.example.com/" }, async () => {
        const custom = await auto(ctx, "webhook base, configured", "GET", "/library/webhook-base");
        await open(tab, `${LIBRARY}?tab=triggers&item=webhook`);
        await ctx.verify("a configured apiBaseUrl", [
          same("the route drops the trailing slash", custom.body, { url: "https://hooks.example.com", configured: true }),
          await shows(tab, "the use", "POST https://hooks.example.com/webhooks/hook-one"),
        ]);
      });
      await withConfig(ctx, { VERIFY_AUTO_API_BASE_URL: "empty" }, async () => {
        const empty = await auto(ctx, "webhook base, empty", "GET", "/library/webhook-base");
        await ctx.verify("an empty apiBaseUrl", [same("the request's own origin, not configured", empty.body, { url: ctx.state.apiUrl, configured: false })]);
      });
      await withConfig(ctx, { VERIFY_AUTO_API_BASE_URL: "http://localhost:4321" }, async () => {
        const loopback = await auto(ctx, "webhook base, loopback", "GET", "/library/webhook-base");
        await ctx.verify("a loopback apiBaseUrl", [same("reported as not configured", loopback.body, { url: "http://localhost:4321", configured: false })]);
      });
    },
  },
  {
    id: "disabling-a-type-asks-first-and-says-how-many-enabled-procedures-it-stops",
    title: "Triggers and actions have an Enabled switch that turns the type off for the whole project; when enabled procedures use the type, Used by says how many of them disabling it stops (a procedure counts once, a disabled one not at all) and Disable asks for confirmation; a type no enabled procedure uses switches off without asking",
    entryPoint: "PUT /action-types/:id/config, /modules/automation/library",
    async run(/** @type {Ctx} */ ctx) {
      await createEnabled(ctx, { name: "Echo one", graph: chain([trigger("t"), action("a", "verify.echo", { value: 1 })]) });
      await createEnabled(ctx, { name: "Echo two", graph: chain([trigger("t"), action("a", "verify.echo", { value: 1 }), action("b", "verify.echo", { value: 2 })]) });
      await createProcedure(ctx, { name: "Echo draft", graph: chain([trigger("t"), action("a", "verify.echo", { value: 1 })]) });
      await createEnabled(ctx, { name: "Tick only", graph: chain([trigger("t"), action("a", "verify.tick", { key: "k" })]) });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, `${LIBRARY}?tab=actions&item=verify.echo`);
      await ctx.verify("Used by says how many it stops", [
        await shows(tab, "the plural sentence", "Disabling it stops the 2 enabled procedures that use it."),
        await tab.visible({ role: "switch", name: "Enable Fixture echo" }),
        check("the switch is on", await tab.page.getByRole("switch", { name: "Enable Fixture echo" }).isChecked(), "on"),
        await shows(tab, "the label", "Enabled"),
      ]);
      await flip(tab, "Fixture echo");
      await ctx.verify("Disable asks first", [
        await tab.visible({ role: "dialog", name: "Disable Fixture echo?" }),
        await shows(tab, "the count", "Disabling it stops the 2 enabled procedures that use it."),
        await tab.visible({ role: "button", name: "Disable" }),
      ]);
      await tab.click({ role: "button", name: "Cancel" });
      await ctx.verify("Cancel changes nothing", [same("still enabled", await enabledOf(ctx, "action-types", "verify.echo"), true)]);
      await flip(tab, "Fixture echo");
      await tab.click({ role: "button", name: "Disable" });
      await ctx.verify("Disable", [
        await shows(tab, "the toast", "Fixture echo disabled"),
        await shows(tab, "the label", "Disabled"),
        await shows(tab, "the list marks it Off", "Fixture echo Off"),
        same("the library lists it disabled", await enabledOf(ctx, "action-types", "verify.echo"), false),
      ]);
      await flip(tab, "Fixture echo");
      await ctx.verify("enabling again asks nothing", [await shows(tab, "the toast", "Fixture echo enabled"), same("enabled", await enabledOf(ctx, "action-types", "verify.echo"), true)]);
      await open(tab, `${LIBRARY}?tab=actions&item=verify.tick`);
      await ctx.verify("one procedure: the singular sentence", [await shows(tab, "the sentence", "Disabling it stops 1 enabled procedure that uses it.")]);
      await open(tab, `${LIBRARY}?tab=actions&item=verify.sleep`);
      await flip(tab, "Fixture sleep");
      await ctx.verify("a type nobody uses switches off at once", [await shows(tab, "the toast", "Fixture sleep disabled"), same("disabled", await enabledOf(ctx, "action-types", "verify.sleep"), false), await tab.visible({ role: "dialog" }, { hidden: true, timeoutMs: 500 })]);
    },
  },
  {
    id: "steps-of-a-disabled-type-fail-and-a-disabled-trigger-is-not-armed",
    title: "steps of a disabled action type fail when they run, and a disabled trigger type is not armed; both work again once enabled",
    entryPoint: "PUT /action-types/:id/config, PUT /trigger-types/:id/config",
    async run(/** @type {Ctx} */ ctx) {
      const echo = await createEnabled(ctx, { name: "Uses echo", graph: chain([trigger("t"), action("a", "verify.echo", { value: "v" })]) });
      const event = await createEnabled(ctx, { name: "Listens", graph: chain([trigger("t", "verify.event", { topic: "library" }), action("l", "log.message", { message: "heard" })]) });
      const ok = await runNow(ctx, echo.id);
      const switched = await auto(ctx, "disable the action", "PUT", "/action-types/verify.echo/config", { body: { enabled: false } });
      const failed = await runNow(ctx, echo.id);
      const failedRun = await auto(ctx, "read the failed run", "GET", `/runs/${failed.runId}`);
      await auto(ctx, "enable the action", "PUT", "/action-types/verify.echo/config", { body: { enabled: true } });
      const again = await runNow(ctx, echo.id);
      await ctx.verify("a disabled action", [
        same("works while enabled", ok.status, "ok"),
        same("the switch answers the id", pick(switched.body, "id"), "verify.echo"),
        same("the run fails", failed.status, "failed"),
        same("with the reason", text(failedRun.body, "errorMessage"), 'action type "verify.echo" is disabled in the library'),
        same("it fails at that step", text(failedRun.body, "failedNodeId"), "a"),
        same("works again once enabled", again.status, "ok"),
      ]);
      const before = await ctx.api("fixture emit", { method: "POST", path: "/verify-auto/emit", body: { topic: "library", payload: { n: 1 } }, as: "anon" });
      await auto(ctx, "disable the trigger", "PUT", "/trigger-types/verify.event/config", { body: { enabled: false } });
      const during = await ctx.api("fixture emit while disabled", { method: "POST", path: "/verify-auto/emit", body: { topic: "library", payload: { n: 2 } }, as: "anon" });
      await auto(ctx, "enable the trigger", "PUT", "/trigger-types/verify.event/config", { body: { enabled: true } });
      const after = await ctx.api("fixture emit enabled again", { method: "POST", path: "/verify-auto/emit", body: { topic: "library", payload: { n: 3 } }, as: "anon" });
      const runs = await auto(ctx, "the procedure's runs", "GET", `/procedures/${event.id}/runs`);
      await ctx.verify("a disabled trigger", [
        same("armed while enabled", pick(before.body, "emitted"), 1),
        same("not armed while disabled", pick(during.body, "emitted"), 0),
        same("armed again once enabled", pick(after.body, "emitted"), 1),
        same("only the armed emissions ran the procedure", list(runs.body).length, 2),
      ]);
    },
  },
  {
    id: "flow-blocks-data-nodes-and-unknown-types-cannot-be-switched-off",
    title: "flow and helper blocks are built into the builder and cannot be switched off (no switch, and it says so); data nodes have no switch either; the switch routes refuse a type no module registered and a body without enabled",
    entryPoint: "/modules/automation/library, PUT /*-types/:id/config",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, `${LIBRARY}?tab=flow&item=if`);
      await ctx.verify("a flow block", [await shows(tab, "the note", "Built into the builder: it can’t be switched off."), check("no switch", (await tab.page.getByRole("switch").count()) === 0, "switch count")]);
      await open(tab, `${LIBRARY}?tab=flow&item=setVariable`);
      await ctx.verify("a helper", [await shows(tab, "the note", "Built into the builder: it can’t be switched off."), check("no switch", (await tab.page.getByRole("switch").count()) === 0, "switch count")]);
      await open(tab, `${LIBRARY}?tab=dataNodes&item=verify.upper`);
      await ctx.verify("a data node", [await shows(tab, "the detail", "id · verify.upper"), check("no switch", (await tab.page.getByRole("switch").count()) === 0, "switch count")]);
      const answers = {
        flow: await auto(ctx, "switch off a flow block", "PUT", "/node-kinds/if/config", { body: { enabled: false } }),
        data: await auto(ctx, "switch off a data node", "PUT", "/data-node-types/verify.upper/config", { body: { enabled: false } }),
        missingTrigger: await auto(ctx, "unknown trigger type", "PUT", "/trigger-types/nope/config", { body: { enabled: false } }),
        missingAction: await auto(ctx, "unknown action type", "PUT", "/action-types/nope/config", { body: { enabled: false } }),
        badBody: await auto(ctx, "a body without enabled", "PUT", "/action-types/verify.echo/config", { body: { on: false } }),
        stringBody: await auto(ctx, "enabled as text", "PUT", "/action-types/verify.echo/config", { body: { enabled: "no" } }),
      };
      await ctx.verify("the routes", [
        check("a flow block has no switch route", answers.flow.status === 404 || answers.flow.status === 405, `status ${answers.flow.status}`),
        check("a data node has no switch route", answers.data.status === 404 || answers.data.status === 405, `status ${answers.data.status}`),
        same("an unknown trigger type", [answers.missingTrigger.status, pick(answers.missingTrigger.body, "error")], [404, 'type "nope" not found']),
        same("an unknown action type", [answers.missingAction.status, pick(answers.missingAction.body, "error")], [404, 'type "nope" not found']),
        same("a body without enabled", answers.badBody.status, 400),
        same("enabled must be a boolean", answers.stringBody.status, 400),
        same("nothing changed", list((await auto(ctx, "list", "GET", "/action-types")).body).filter((entry) => entry.enabled === false).length, 0),
      ]);
      void bodyText;
    },
  },
];
