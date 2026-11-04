import { auto, check, list, num, pick, same, text } from "../../auto.mjs";
import { allInnerTexts, byText, innerText, within } from "./overview-page.mjs";
import { aria, ariaUntil, bodyText, open, shows } from "./overview-kit.mjs";
import { LIBRARY, createTemplate } from "./library-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */

/**
 * The entry list as the page draws it: each group heading with the entries under it.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<{ heading: string, names: string[] }[]>} The groups, in order
 */
async function groupsOf(tab) {
  await tab.page.locator("[role=tabpanel] p.font-mono.uppercase").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
  return tab.page.evaluate(() =>
    [...document.querySelectorAll("[role=tabpanel] p.font-mono.uppercase")].map((heading) => ({
      heading: (heading.textContent ?? "").trim().toLowerCase(),
      names: [...(heading.parentElement?.querySelectorAll("button span.truncate.font-medium") ?? [])].map((name) => (name.textContent ?? "").trim()),
    })),
  );
}

/**
 * The names the entry list shows, in order.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The entries' titles
 */
async function entryNames(tab) {
  await tab.page.locator("[role=tabpanel] button span.truncate.font-medium").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
  return (await allInnerTexts(tab.page.locator("[role=tabpanel] button span.truncate.font-medium"))).map((name) => name.trim());
}

/**
 * The first column of every table of the detail, in page order.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[][]>} The names in each table
 */
async function detailTables(tab) {
  return tab.page.evaluate(() => [...document.querySelectorAll("[role=tabpanel] table")].map((table) => [...table.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent?.trim() ?? "")));
}

/** @type {import("../../auto.mjs").Row[]} */
export const catalogJourneys = [
  {
    id: "the-tabs-carry-the-counts-of-what-is-registered-and-the-link-keeps-the-open-tab",
    title: "the Library has the tabs Triggers, Actions, Data nodes, Templates and Flow & helpers with their counts (the registered types, the saved templates, the nine flow and helper blocks), and the link keeps the open tab",
    entryPoint: "GET /library/counts, /modules/automation/library",
    async run(/** @type {Ctx} */ ctx) {
      const counts = await auto(ctx, "counts", "GET", "/library/counts");
      const lengths = await Promise.all(["trigger-types", "action-types", "data-node-types", "node-kinds"].map((path) => auto(ctx, `list ${path}`, "GET", `/${path}`)));
      const flowKinds = list(lengths[3]?.body).filter((entry) => ["flow", "helper"].includes(text(entry, "meta", "ui", "category")));
      await ctx.verify("the counts route", [
        same("triggers", pick(counts.body, "triggers"), list(lengths[0]?.body).length),
        same("actions", pick(counts.body, "actions"), list(lengths[1]?.body).length),
        same("data nodes", pick(counts.body, "dataNodes"), list(lengths[2]?.body).length),
        same("flow blocks are the nine of the docs", pick(counts.body, "flow"), 9),
        same("the flow kinds the page lists", flowKinds.map((entry) => text(entry, "kind")).sort(byText), ["delay", "foreach", "forRange", "if", "parallel", "retry", "setVariable", "switch", "tryCatch"].sort(byText)),
        same("no template yet", pick(counts.body, "templates"), 0),
        same("the built-in triggers are the three of the docs", list(lengths[0]?.body).filter((t) => t.module === undefined).map((t) => text(t, "id")).sort(byText), ["manual", "schedule.cron", "webhook"]),
        same("the built-in actions are HTTP request and Log", list(lengths[1]?.body).filter((t) => t.module === undefined).map((t) => text(t, "id")).sort(byText), ["http.request", "log.message"]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, LIBRARY);
      const c = { triggers: num(counts.body, "triggers"), actions: num(counts.body, "actions"), dataNodes: num(counts.body, "dataNodes") };
      await ctx.verify("the tabs", [
        await shows(tab, "the five tabs in order with their counts", `Triggers ${c.triggers} Actions ${c.actions} Data nodes ${c.dataNodes} Templates 0 Flow & helpers 9`),
        await tab.visible({ role: "tab", name: `Triggers ${c.triggers}` }),
        await tab.visible({ role: "tab", name: `Flow & helpers 9` }),
      ]);
      await tab.click({ role: "tab", name: /^Data nodes/ });
      const url = new URL(tab.page.url());
      await ctx.verify("the link keeps the open tab", [check("tab=dataNodes in the link", url.searchParams.get("tab") === "dataNodes", url.href), await shows(tab, "the data nodes", "COMPARISON")]);
      await tab.page.reload();
      await ctx.verify("a reload lands on the same tab", [check("Data nodes selected", await tab.page.getByRole("tab", { name: /^Data nodes/ }).getAttribute("aria-selected") === "true", tab.page.url())]);
      await createTemplate(ctx, "Counted template");
      await open(tab, `${LIBRARY}?tab=templates`);
      await ctx.verify("a saved template is counted", [
        same("route", pick((await auto(ctx, "counts again", "GET", "/library/counts")).body, "templates"), 1),
        await shows(tab, "the tab", "Templates 1"),
        await shows(tab, "the template", "Counted template 1 use", { not: true, timeoutMs: 800 }).then(() => shows(tab, "the template is listed", "Counted template")),
      ]);
    },
  },
  {
    id: "entries-are-grouped-by-module-built-ins-first-and-data-nodes-by-category",
    title: "entries are grouped by the module that registered them, built-ins first; data nodes are also grouped by category, and flow blocks into Flow and Helpers",
    entryPoint: "/modules/automation/library",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      /** @type {Record<string, { heading: string, names: string[] }[]>} */
      const tabs = {};
      for (const name of ["triggers", "actions", "dataNodes", "flow"]) {
        await open(tab, `${LIBRARY}?tab=${name}`);
        tabs[name] = await groupsOf(tab);
      }
      const headingsOf = (/** @type {string} */ name) => (tabs[name] ?? []).map((group) => group.heading);
      const under = (/** @type {string} */ name, /** @type {string} */ heading) => (tabs[name] ?? []).find((group) => group.heading === heading)?.names;
      await ctx.verify("triggers", [
        same("groups", headingsOf("triggers"), ["built-in", "app", "dms"]),
        same("the built-ins first", under("triggers", "built-in"), ["Manual", "Schedule (cron)", "Webhook"]),
        same("the fixture module's", under("triggers", "app"), ["Fixture event", "Fixture leader event", "Fixture trigger that cannot arm", "Fixture trigger that never arms", "Fixture trigger that never disarms"]),
        same("the DMS events", under("triggers", "dms"), ["Member added", "Member removed", "Invite created", "User registered", "Record created", "Record updated", "Record deleted"]),
      ]);
      await ctx.verify("actions", [
        same("groups", headingsOf("actions"), ["built-in", "app", "dms"]),
        same("the built-ins", under("actions", "built-in"), ["HTTP request", "Log"]),
        same("the DMS actions", under("actions", "dms"), ["Send email", "Send notification", "Invite user"]),
        same("the fixture's fifteen", under("actions", "app")?.length, 15),
      ]);
      await ctx.verify("data nodes", [
        same("groups by module then category", headingsOf("dataNodes"), ["built-in · comparison", "built-in · constants", "built-in · json", "built-in · logic", "built-in · math", "built-in · objects", "built-in · text", "app · verify"]),
        same("the comparison nodes", under("dataNodes", "built-in · comparison"), ["Equals", "Not equal", "Less than", "Greater than", "Less or equal", "Greater or equal"]),
        same("the constants", under("dataNodes", "built-in · constants"), ["Text", "Number", "True or false", "JSON"]),
        same("all forty-eight", (tabs.dataNodes ?? []).reduce((sum, group) => sum + group.names.length, 0), 48),
        same("the fixture's category is shown as registered", under("dataNodes", "app · verify"), ["Fixture upper-case", "Fixture suffix", "Fixture bad data node", "Fixture throwing data node"]),
      ]);
      await ctx.verify("flow & helpers", [
        same("groups", headingsOf("flow"), ["flow", "helpers"]),
        same("flow", [...(under("flow", "flow") ?? [])].sort(byText), ["For each", "For range", "If", "Parallel", "Retry", "Switch", "Try / Catch"]),
        same("helpers", [...(under("flow", "helpers") ?? [])].sort(byText), ["Delay", "Set variable"]),
      ]);
    },
  },
  {
    id: "search-filters-the-entries-by-id-name-description-and-module",
    title: "Search… filters the entries of the open tab, case-insensitively, by name, description, id and module; with nothing found the list says Nothing matches. and the detail moves to the first entry left",
    entryPoint: "/modules/automation/library",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, `${LIBRARY}?tab=actions`);
      await entryNames(tab);
      const search = async (/** @type {string} */ query) => {
        await tab.fill({ role: "textbox", name: "Search…" }, query);
        await tab.page.waitForTimeout(600);
        return entryNames(tab);
      };
      const byName = await search("FIXTURE FLAKY");
      const byDescription = await search("ledger");
      const byId = await search("verify.sl");
      const byModule = await search("dms");
      const none = await search("zzzz-nothing");
      await ctx.verify("search", [
        same("by name, whatever the case", byName, ["Fixture flaky action"]),
        same("by description", byDescription, ["Fixture verify.effect", "Fixture verify.effect-nodry", "Fixture verify.effect-pure", "Fixture tick"]),
        same("by id", byId, ["Fixture sleep"]),
        same("by module", byModule, ["Send email", "Send notification", "Invite user"]),
        same("nothing", none, []),
        await shows(tab, "the empty list says so", "Nothing matches."),
      ]);
      await search("sleep");
      await ctx.verify("the detail follows the first entry left", [await shows(tab, "the detail", "id · verify.sleep"), check("the URL keeps the item", new URL(tab.page.url()).searchParams.get("item") === "verify.sleep", tab.page.url())]);
      await open(tab, `${LIBRARY}?tab=triggers`);
      await search("webhook");
      const hits = await entryNames(tab);
      await ctx.verify("another tab", [same("only the webhook", hits, ["Webhook"])]);
    },
  },
  {
    id: "an-entry-shows-its-name-description-id-group-settings-inputs-and-outputs",
    title: "selecting a trigger, an action, a data node or a flow block shows its name, description and id, the group it is listed under, Settings on each node (trigger, data node), Inputs (action, data node, flow block) and Outputs",
    entryPoint: "/modules/automation/library?item=",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      const cases = [
        { tab: "triggers", item: "verify.event", head: ["Fixture event", "app", "Fixture trigger verify.event", "id · verify.event · cluster · replicated"], tables: [["topic"], ["topic", "value"]] },
        { tab: "actions", item: "verify.context", head: ["Fixture context", "app", "Returns the execution context's identifiers and dryRun", "id · verify.context"], tables: [["procedureId", "runId", "nodeId", "dryRun"]] },
        { tab: "actions", item: "log.message", head: ["Log", "Built-in", "Writes a message (and an optional value) to the run log", "id · log.message"], tables: [["message", "value", "level"], ["message", "value"]] },
        { tab: "dataNodes", item: "verify.suffix", head: ["Fixture suffix", "app · Verify", "Appends the configured suffix to its text; the suffix is a config field, not a port", "id · verify.suffix"], tables: [["suffix"], ["text"], ["text"]] },
        { tab: "flow", item: "if", head: ["If", "Flow", "Goes one way or the other depending on a condition.", "id · if"], tables: [["cond"]] },
        { tab: "flow", item: "delay", head: ["Delay", "Helpers", "Waits for a set time before going on.", "id · delay"], tables: [["ms"]] },
      ];
      for (const entry of cases) {
        await open(tab, `${LIBRARY}?tab=${entry.tab}&item=${entry.item}`);
        await ariaUntil(tab, "h2", (s) => s.includes(entry.head[0] ?? ""));
        const page = await bodyText(tab);
        const tables = await detailTables(tab);
        await ctx.verify(`the detail of ${entry.item}`, [
          check("the name is the heading", (await innerText(tab.page.locator("h2").first())).trim() === entry.head[0], page.slice(0, 200)),
          check("the group badge", (await innerText(within(tab.page.locator("h2").first(), "xpath=following-sibling::span").first())).trim() === entry.head[1], entry.head[1] ?? ""),
          await shows(tab, "the description", entry.head[2] ?? ""),
          await shows(tab, "the id line", entry.head[3] ?? ""),
          same("the tables of the detail, in page order", tables, entry.tables),
          check("Settings on each node is for triggers and data nodes, an action has Inputs instead", entry.tab === "actions" ? !page.includes("SETTINGS ON EACH NODE") : entry.tab === "triggers" || entry.tab === "dataNodes" ? page.includes("SETTINGS ON EACH NODE") : true, page.slice(0, 100)),
          check("Inputs is for actions, data nodes and flow blocks, not triggers", entry.tab === "triggers" ? !page.includes("INPUTS") : entry.item === "delay" ? true : page.includes("INPUTS"), page.slice(0, 100)),
          check("Outputs always", page.includes("OUTPUTS"), page.slice(0, 100)),
        ]);
      }
      await aria(tab, "main", 500);
    },
  },
  {
    id: "a-trigger-shows-its-cluster-mode-after-its-id-and-in-a-banner",
    title: "a trigger shows its cluster mode after its id and in a banner: Replicated across instances (replicated), where every instance listens and one of them handles each call, or Runs on one instance (singleton), where only the leader runs it; actions and data nodes show none",
    entryPoint: "/modules/automation/library?tab=triggers",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      const expected = [
        ["manual", "replicated", "Replicated across instances", "Every automation instance listens; each call is handled by exactly one of them."],
        ["webhook", "replicated", "Replicated across instances", "Every automation instance listens; each call is handled by exactly one of them."],
        ["verify.event", "replicated", "Replicated across instances", "Every automation instance listens; each call is handled by exactly one of them."],
        ["schedule.cron", "singleton", "Runs on one instance", "Only the leader instance runs it, so it fires once however many instances run."],
        ["verify.leader-event", "singleton", "Runs on one instance", "Only the leader instance runs it, so it fires once however many instances run."],
      ];
      const types = await auto(ctx, "trigger types", "GET", "/trigger-types");
      for (const [id, mode, title, hint] of expected) {
        await open(tab, `${LIBRARY}?tab=triggers&item=${id}`);
        await ctx.verify(`the cluster mode of ${id}`, [
          same("the API", list(types.body).find((t) => t.id === id)?.cluster, mode),
          await shows(tab, "after its id", `id · ${id} · cluster · ${mode}`),
          await shows(tab, "the banner title and hint", `${title} ${hint}`),
        ]);
      }
      await open(tab, `${LIBRARY}?tab=actions&item=log.message`);
      await ctx.verify("an action has none", [await shows(tab, "the id line", "id · log.message"), await shows(tab, "no cluster", "cluster ·", { not: true, timeoutMs: 800 }), await shows(tab, "no banner", "Runs on one instance", { not: true, timeoutMs: 300 })]);
    },
  },
];
