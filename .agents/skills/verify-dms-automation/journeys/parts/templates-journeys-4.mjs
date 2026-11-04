import { auto, list, pick, raw, same, text } from "../../auto.mjs";
import { createProcedure, graph, runNow, statusIs } from "../../procs.mjs";
import { eventually, procedureOf } from "./builder-kit.mjs";
import { GREETER_PORTS, createTemplate, greeterSubgraph, idsOf, instance, runGroup, templateBody } from "./templates-kit.mjs";
import { pause, readTemplate, readProcedure, nestingSubgraph } from "./templates-helpers.mjs";
import { allInnerTexts, either, withText } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */


/** @type {import("../../auto.mjs").Row[]} */
export const templatesJourneys4 = [
  {
    id: "template-routes-answer-404-for-unknown-ids-and-refuse-other-methods",
    title: "an unknown template id answers 404 with its id in the text on GET, usages, PUT and DELETE; a malformed edit body is checked before the id; unsupported methods and paths answer 404 and change nothing",
    entryPoint: "GET|PUT|DELETE /templates/:id, PATCH|POST|OPTIONS /templates/:id",
    async run(/** @type {Ctx} */ ctx) {
      const t = await createTemplate(ctx, "Real");
      const before = await readTemplate(ctx, t);
      const ghost = "00000000-0000-4000-8000-000000000000";
      const notFound = { error: `template "${ghost}" not found` };
      const checks = [];
      /** @type {[string, string, unknown][]} */
      const attempts = [
        ["GET", `/templates/${ghost}`, undefined],
        ["GET", `/templates/${ghost}/usages`, undefined],
        ["PUT", `/templates/${ghost}`, templateBody("Ghost")],
        ["DELETE", `/templates/${ghost}`, undefined],
        ["DELETE", `/templates/${ghost}?force=1`, undefined],
      ];
      for (const [method, path, body] of attempts) {
        const answer = await auto(ctx, `${method} ${path}`, method, path, { body });
        checks.push(statusIs(answer, 404, `${method} ${path}: 404`), same(`${method} ${path}: body`, answer.body, notFound));
      }
      const invalid = await auto(ctx, "edit an unknown template with an empty body", "PUT", `/templates/${ghost}`, { body: {} });
      checks.push(statusIs(invalid, 400, "an invalid body is refused before the id is looked up"), same("it names the missing fields", list(invalid.body, "issues").map((issue) => issue.path), [["name"], ["ports"], ["subgraph"]]));
      await ctx.verify("unknown ids", checks);
      const other = [];
      for (const [method, path] of [
        ["PATCH", `/api/automation/templates/${t}`],
        ["POST", `/api/automation/templates/${t}`],
        ["OPTIONS", `/api/automation/templates/${t}`],
        ["PUT", "/api/automation/templates"],
        ["DELETE", "/api/automation/templates"],
        ["PATCH", "/api/automation/templates"],
        ["POST", `/api/automation/templates/${t}/usages`],
        ["PUT", `/api/automation/templates/${t}/usages`],
        ["DELETE", `/api/automation/templates/${t}/usages`],
        ["GET", `/api/automation/templates/${t}/nothing`],
      ]) {
        const answer = await raw(ctx, `${method} ${path}`, { method, path, as: "admin", headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(templateBody("Changed")) });
        other.push(same(`${method} ${path}: status`, answer.status, 404), same(`${method} ${path}: body`, answer.text, "Not Found"));
      }
      const head = await raw(ctx, "HEAD the list", { method: "HEAD", path: "/api/automation/templates", as: "admin" });
      other.push(same("HEAD answers like GET without a body", [head.status, head.text], [200, ""]));
      await ctx.verify("other methods and paths", other);
      const after = await readTemplate(ctx, t);
      const all = await auto(ctx, "list", "GET", "/templates");
      await ctx.verify("nothing changed", [same("the template", after.body, before.body), same("the list", idsOf(all.body), [t])]);
    },
  },
  {
    id: "a-procedure-placing-a-missing-template-cannot-be-enabled",
    title: "a procedure whose group names a template that does not exist is imported as a draft with an unknownTemplate problem, and enabling it is refused with 400 invalid graph",
    entryPoint: "POST /procedures/import, PUT /procedures/:id/enabled",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { graph: runGroup(instance("g1", "no-such-template")) });
      const stored = await readProcedure(ctx, id);
      const enable = await auto(ctx, "enable it", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const expected = [{ severity: "error", code: "unknownTemplate", params: { template: "no-such-template" }, message: 'template "no-such-template" not found', nodeId: "g1" }];
      await ctx.verify("the draft cannot be enabled", [
        same("it is a draft", stored.enabled, false),
        statusIs(enable, 400, "enabling answers 400"),
        same("error and message", [text(enable.body, "error"), text(enable.body, "message")], ["invalid graph", "$dms_automation.api.graphHasErrors"]),
        same("the problem names the template and the node", pick(enable.body, "issues"), expected),
        same("it is still a draft", (await readProcedure(ctx, id)).enabled, false),
      ]);
      const t = await createTemplate(ctx, "No-such-yet");
      const fixed = await createProcedure(ctx, { graph: runGroup(instance("g1", t)) });
      const ok = await auto(ctx, "enable one with a real template", "PUT", `/procedures/${fixed}/enabled`, { body: { enabled: true } });
      await ctx.verify("a real template enables", [statusIs(ok, 200, "200"), same("enabled", pick(ok.body, "enabled"), true)]);
    },
  },
  {
    id: "the-library-templates-tab-lists-searches-and-edits-templates",
    title: "the Library's Templates tab lists templates by name with how many places use each, searches them, shows Details, Ports and Used in, saves the name, description and icon, and refuses a taken name under the field",
    entryPoint: "/modules/automation/library?tab=templates",
    async run(/** @type {Ctx} */ ctx) {
      const café = await createTemplate(ctx, "Café ☕", { description: "Sert 日本語" });
      const alpha = await createTemplate(ctx, "Alpha", { description: "premier", icon: "i-lucide-git-fork" });
      const used = await createProcedure(ctx, { name: "Utilise Alpha", graph: runGroup(instance("g1", alpha)) });
      const twice = await createProcedure(ctx, { name: "Utilise Alpha deux fois", graph: graph([...runGroup(instance("g1", alpha)).nodes, instance("g2", alpha)], runGroup(instance("g1", alpha)).triggerEdges, runGroup(instance("g1", alpha)).dataEdges) });
      await auto(ctx, "pause one", "PUT", `/procedures/${twice}/enabled`, { body: { enabled: true } });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/library?tab=templates");
      await tab.visible({ role: "tab", name: "Templates 2" });
      await pause(1500);
      const rows = async () => allInnerTexts(withText(tab.page.getByRole("tabpanel").getByRole("button"), /uses?$/)).then((all) => all.map((t) => t.replace(/\s+/g, " ").trim()));
      await ctx.verify("the tab lists the templates by name with their uses", [
        tab.visible({ role: "tab", name: "Templates 2", exact: true }),
        same("the rows, A to Z", await rows(), ["Alpha premier 2 uses", "Café ☕ Sert 日本語 0 uses"]),
        tab.visible({ role: "textbox", name: "Search templates…" }),
        tab.shows(/Back to the list/i),
      ]);
      await ctx.verify("the first template is shown", [
        tab.visible({ role: "heading", name: "Alpha", level: 2 }),
        same("its id", await tab.page.getByText(alpha, { exact: true }).count(), 1),
        same("the link keeps the open tab", new URL(tab.page.url()).searchParams.get("tab"), "templates"),
        tab.visible({ role: "button", name: "Edit graph" }),
        same("name field", await tab.value({ role: "textbox", name: "Name", exact: true }), "Alpha"),
        same("description field", await tab.value({ role: "textbox", name: "Description", exact: true }), "premier"),
        tab.shows(/ports\s*4/i),
        tab.shows(/used in\s*2/i),
        tab.shows(/Changes apply live to every procedure below\./),
        tab.shows(/Utilise Alpha deux fois/),
        tab.shows(/2 places/),
        tab.shows(/Deleting forks each usage into a local group, so the procedures keep working\./),
      ]);
      const portRows = await allInnerTexts(tab.page.locator("table tbody tr"));
      await ctx.verify("the Ports table", [
        same("columns", (await allInnerTexts(tab.page.locator("table thead th"))).map((t) => t.trim().toLowerCase()), ["kind", "direction", "name", "type"]),
        same("rows", portRows.map((row) => row.replace(/\s+/g, " ").trim()), ["trigger in main —", "trigger out main —", "data in text string", "data out echo string"]),
        tab.shows(/Edit them inside the graph\./),
      ]);
      await tab.fill({ role: "textbox", name: "Search templates…" }, "café");
      await ctx.verify("search matches names in any case", [same("rows", await rows(), ["Café ☕ Sert 日本語 0 uses"])]);
      await tab.fill({ role: "textbox", name: "Search templates…" }, "SERT");
      await ctx.verify("and descriptions", [same("rows", await rows(), ["Café ☕ Sert 日本語 0 uses"])]);
      await tab.fill({ role: "textbox", name: "Search templates…" }, "zzz");
      await ctx.verify("nothing matching says so", [tab.shows(/Nothing matches\./)]);
      await tab.fill({ role: "textbox", name: "Search templates…" }, "");
      await tab.page.getByRole("button", { name: /^Café ☕/ }).click();
      await ctx.verify("picking another template shows it", [tab.visible({ role: "heading", name: "Café ☕", level: 2 }), tab.shows(/No procedure or template uses it yet\./), same("the URL follows", await eventually(async () => new URL(tab.page.url()).searchParams.get("template"), (v) => v === café, 4000), café)]);
      await tab.fill({ role: "textbox", name: "Name", exact: true }, "Alpha");
      await tab.click({ role: "button", name: "Save" });
      await ctx.verify("a taken name is refused under the field", [tab.shows(/Another template already has this name\./), same("the stored name", text((await auto(ctx, "read", "GET", `/templates/${café}`)).body, "name"), "Café ☕")]);
      await tab.fill({ role: "textbox", name: "Name", exact: true }, "Crème brûlée 🍮");
      await tab.fill({ role: "textbox", name: "Description", exact: true }, "Dessert\nligne 2");
      await tab.click({ role: "button", name: "Save" });
      const stored = await eventually(async () => (await auto(ctx, "read saved", "GET", `/templates/${café}`)).body, (b) => text(b, "name") === "Crème brûlée 🍮");
      await ctx.verify("Save stores the name and description", [same("name", text(stored, "name"), "Crème brûlée 🍮"), same("description", text(stored, "description"), "Dessert\nligne 2"), same("ports and steps are kept", [pick(stored, "ports"), pick(stored, "subgraph")], [GREETER_PORTS, greeterSubgraph()]), tab.shows(/Crème brûlée 🍮 saved/)]);
      await tab.click({ role: "button", name: "Edit graph" });
      await tab.at(/\/modules\/automation\/builder$/);
      await ctx.verify("Edit graph opens the template in the builder", [same("the URL", new URL(tab.page.url()).searchParams.get("template"), café)]);
      void used;
    },
  },
  {
    id: "deleting-a-template-from-the-library-says-how-many-places-it-forks",
    title: "Delete template confirms with the number of places that become local groups (one, several, or none), then turns every use into a local group so the procedures keep working",
    entryPoint: "/modules/automation/library?tab=templates, Delete template",
    async run(/** @type {Ctx} */ ctx) {
      const t = await createTemplate(ctx, "Condamné");
      const unused = await createTemplate(ctx, "Aucun usage");
      const one = await createProcedure(ctx, { name: "Un usage", graph: runGroup(instance("g1", t)) });
      const two = await createProcedure(ctx, { name: "Deux usages", graph: runGroup(instance("g1", t)) });
      const host = await createTemplate(ctx, "Hôte", { subgraph: nestingSubgraph(t) });
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(`/modules/automation/library?tab=templates&template=${unused}`);
      await tab.visible({ role: "heading", name: "Aucun usage", level: 2 });
      await pause(1500);
      await tab.click({ role: "button", name: "Delete template" });
      const confirmNone = either(tab.page.getByRole("alertdialog"), tab.page.getByRole("dialog"));
      await confirmNone.first().waitFor();
      await ctx.verify("an unused template says nothing uses it", [tab.shows(/Delete “Aucun usage”\?/), tab.shows(/No procedure or template uses it yet\./), tab.visible({ role: "button", name: "Delete template", exact: true })]);
      await tab.page.keyboard.press("Escape");
      await pause(400);
      await ctx.verify("cancelling deletes nothing", [same("templates", (await auto(ctx, "list", "GET", "/templates")).body && list((await auto(ctx, "list again", "GET", "/templates")).body, "results").length, 3)]);
      await tab.page.getByRole("button", { name: /^Condamné/ }).click();
      await tab.visible({ role: "heading", name: "Condamné", level: 2 });
      await pause(600);
      await tab.click({ role: "button", name: "Delete template" });
      await confirmNone.first().waitFor();
      await ctx.verify("the confirmation counts the places and who holds them", [
        tab.shows(/Delete “Condamné”\?/),
        tab.shows(/It is used 3 times, in 2 procedures and 1 template: each usage becomes a local group\./),
      ]);
      await tab.page.getByRole("dialog").getByRole("button", { name: "Delete template" }).click();
      await eventually(async () => (await auto(ctx, "gone?", "GET", `/templates/${t}`)).status, (status) => status === 404);
      const forked = await procedureOf(ctx, one);
      const hostAfter = await auto(ctx, "host after", "GET", `/templates/${host}`);
      await ctx.verify("the template is gone and every use became a local group", [
        tab.shows(/Condamné deleted/),
        same("the first procedure", [list(forked, "graph", "nodes").find((n) => n.id === "g1")?.templateId, list(forked, "graph", "nodes").find((n) => n.id === "g1")?.label], [undefined, "Condamné"]),
        same("the second procedure", list(await procedureOf(ctx, two), "graph", "nodes").find((n) => n.id === "g1")?.label, "Condamné"),
        same("the host template", list(hostAfter.body, "subgraph", "nodes").find((n) => n.id === "inner")?.label, "Condamné"),
      ]);
      const ran = await runNow(ctx, one, {});
      await ctx.verify("the procedure keeps working", [same("status", ran.status, "ok")]);
      await tab.page.getByRole("button", { name: /^Hôte/ }).click();
      await pause(500);
      await tab.click({ role: "button", name: "Delete template" });
      await confirmNone.first().waitFor();
      await ctx.verify("a template nobody uses any more says so", [tab.shows(/Delete “Hôte”\?/), tab.shows(/No procedure or template uses it yet\./)]);
    },
  },
];
