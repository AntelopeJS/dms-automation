import { auto, check, isRow, isText, list, pick, same, text } from "../../auto.mjs";
import { statusIs } from "../../procs.mjs";
import { createTemplate, greeterSubgraph, idsOf, port, templateBody } from "./templates-kit.mjs";
import { pause, readTemplate } from "./templates-helpers.mjs";
import { byText } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @typedef {import("../../auto.mjs").Row} Row */

/** @type {import("../../auto.mjs").Row[]} */
export const templatesJourneys1 = [
  {
    id: "a-saved-template-reads-back-exactly-in-every-view",
    title: "a template saved with a name, description, icon, ports and a subgraph (unicode included) reads back identical from the create answer, GET one and the list, with usageCount 0; an edit keeps created_at and moves updated_at",
    entryPoint: "POST /templates, GET /templates/:id, GET /templates, PUT /templates/:id",
    async run(/** @type {Ctx} */ ctx) {
      const name = "Café ☕ 日本語 🚀 \"quoted\"";
      const ports = [
        port("main", "trigger", "in"),
        port("main", "trigger", "out"),
        port("texte", "data", "in", { type: "string", title: "Texte" }),
        port("résumé", "data", "out", { type: "object", properties: { n: { type: ["number", "null"] } }, required: ["n"] }),
        port("any", "data", "in", {}),
      ];
      const subgraph = greeterSubgraph();
      subgraph.nodes[1].label = "Journal 日本語";
      subgraph.nodes[1].config = { message: "Héllo 🌍", level: "warn" };
      const body = { name, description: "Dit bonjour\nligne 2 — «é»", icon: "i-lucide-git-fork", ports, subgraph };
      const created = await auto(ctx, "create the template", "POST", "/templates", { body });
      const id = text(created.body, "_id");
      await ctx.verify("the create answer", [
        statusIs(created, 200, "create answers 200"),
        check("the id is a uuid", /^[0-9a-f-]{36}$/.test(id), id),
        same("name", text(created.body, "name"), name),
        same("description", text(created.body, "description"), body.description),
        same("icon", text(created.body, "icon"), "i-lucide-git-fork"),
        same("ports", pick(created.body, "ports"), ports),
        same("subgraph", pick(created.body, "subgraph"), subgraph),
        same("created_at equals updated_at on creation", text(created.body, "created_at"), text(created.body, "updated_at")),
        check("created_at is an ISO date", !Number.isNaN(Date.parse(text(created.body, "created_at"))), text(created.body, "created_at")),
      ]);
      const one = await readTemplate(ctx, id);
      const listed = await auto(ctx, "list the templates", "GET", "/templates");
      const row = list(listed.body, "results")[0] ?? {};
      const createdRow = isRow(created.body) ? created.body : {};
      await ctx.verify("the same row in GET one and the list", [
        same("GET one is the create answer", one.body, created.body),
        same("the list holds one template", idsOf(listed.body), [id]),
        same("the list total", pick(listed.body, "total"), 1),
        same("the list row is the template plus usageCount 0", row, { ...createdRow, usageCount: 0 }),
        same("the list's page and limit", [pick(listed.body, "page"), pick(listed.body, "limit")], [0, 1000]),
      ]);
      await pause(40);
      const edited = await auto(ctx, "edit the template", "PUT", `/templates/${id}`, { body: { ...body, description: "", icon: "", ports: [port("main", "trigger", "in")] } });
      const after = await readTemplate(ctx, id);
      await ctx.verify("an edit replaces every field", [
        statusIs(edited, 200, "edit answers 200"),
        same("description is empty", text(after.body, "description"), ""),
        same("icon is empty", text(after.body, "icon"), ""),
        same("ports are replaced", pick(after.body, "ports"), [port("main", "trigger", "in")]),
        same("the subgraph is kept", pick(after.body, "subgraph"), subgraph),
        same("created_at is kept", text(after.body, "created_at"), text(created.body, "created_at")),
        check("updated_at moved on", Date.parse(text(after.body, "updated_at")) > Date.parse(text(created.body, "updated_at")), `${text(created.body, "updated_at")} -> ${text(after.body, "updated_at")}`),
        same("the edit answer is the stored row", edited.body, after.body),
      ]);
      const omitted = await auto(ctx, "create without description and icon", "POST", "/templates", { body: { name: "Bare", ports: [], subgraph: { nodes: [], triggerEdges: [], dataEdges: [] } } });
      await ctx.verify("description and icon default to empty text", [
        statusIs(omitted, 200, "an empty template is accepted"),
        same("description", text(omitted.body, "description"), ""),
        same("icon", text(omitted.body, "icon"), ""),
        same("ports", pick(omitted.body, "ports"), []),
      ]);
    },
  },
  {
    id: "template-names-are-unique-whatever-their-case",
    title: "a second template with the same name in any case, trimmed, or with accents in another case is refused with 409 name-taken; a template may be saved under its own name; a deleted template frees its name",
    entryPoint: "POST /templates, PUT /templates/:id, DELETE /templates/:id",
    async run(/** @type {Ctx} */ ctx) {
      const first = await createTemplate(ctx, "Greeter");
      const second = await createTemplate(ctx, "École Élève");
      /** @type {[string, string, string][]} */
      const attempts = [
        ["same case", "Greeter", "Greeter"],
        ["lower case", "greeter", "greeter"],
        ["upper case", "GREETER", "GREETER"],
        ["padded", "  Greeter  ", "Greeter"],
        ["accents in another case", "école élève", "école élève"],
        ["accents upper", "ÉCOLE ÉLÈVE", "ÉCOLE ÉLÈVE"],
      ];
      for (const [label, name, shown] of attempts) {
        const answer = await auto(ctx, `create ${label}`, "POST", "/templates", { body: templateBody(name) });
        await ctx.verify(`${label} is refused`, [
          statusIs(answer, 409, `${label} answers 409`),
          same("the body", answer.body, { error: `a template named "${shown}" already exists`, code: "name-taken" }),
        ]);
      }
      const all = await auto(ctx, "list after the refusals", "GET", "/templates");
      await ctx.verify("nothing was stored by a refusal", [same("two templates", list(all.body, "results").map((row) => text(row, "name")).sort(byText), ["Greeter", "École Élève"].sort(byText))]);
      const own = await auto(ctx, "save under its own name in another case", "PUT", `/templates/${first}`, { body: templateBody("GREETER") });
      const clash = await auto(ctx, "rename onto another template", "PUT", `/templates/${second}`, { body: templateBody("greeter") });
      const readSecond = await readTemplate(ctx, second);
      await ctx.verify("an edit may keep its own name but not take another's", [
        statusIs(own, 200, "own name in another case answers 200"),
        same("the name is now GREETER", text(own.body, "name"), "GREETER"),
        statusIs(clash, 409, "another template's name answers 409"),
        same("the clash body", clash.body, { error: 'a template named "greeter" already exists', code: "name-taken" }),
        same("the refused edit changed nothing", text(readSecond.body, "name"), "École Élève"),
      ]);
      const removed = await auto(ctx, "delete the first", "DELETE", `/templates/${first}`);
      const reused = await auto(ctx, "reuse its name", "POST", "/templates", { body: templateBody("Greeter") });
      await ctx.verify("a deleted template frees its name", [statusIs(removed, 200, "delete answers 200"), statusIs(reused, 200, "the name is free again")]);
    },
  },
  {
    id: "template-fields-have-limits-and-defaults",
    title: "a template name is 1-200 characters after trimming, a description at most 2000, an icon is empty or i-<set>-<name> in lower case; each refusal is a 400 invalid body that names the field",
    entryPoint: "POST /templates",
    async run(/** @type {Ctx} */ ctx) {
      /** @param {string} label @param {Row} extra @param {number} status @param {string[]} [path] */
      const attempt = async (label, extra, status, path) => {
        const answer = await auto(ctx, label, "POST", "/templates", { body: templateBody(isText(extra.name) && extra.name ? extra.name : ctx.unique("T"), extra) });
        const issues = list(answer.body, "issues");
        await ctx.verify(label, [
          statusIs(answer, status, `${label}: ${status}`),
          ...(status === 400
            ? [same(`${label}: error`, text(answer.body, "error"), "invalid body"), same(`${label}: issue path`, issues.map((issue) => issue.path), [path])]
            : []),
        ]);
        return answer;
      };
      const name200 = `${"é".repeat(199)}Z`;
      const ok200 = await attempt("a name of 200 characters is stored", { name: name200 }, 200);
      await ctx.verify("the 200-character name is stored whole", [same("name", text(ok200.body, "name"), name200)]);
      await attempt("a name of 201 characters is refused", { name: `${"é".repeat(200)}Z` }, 400, ["name"]);
      const padded = await attempt("a padded name is trimmed", { name: `  ${"x".repeat(200)}  ` }, 200);
      await ctx.verify("the padded name is stored trimmed", [same("name", text(padded.body, "name"), "x".repeat(200))]);
      await attempt("a blank name is refused", { name: "   " }, 400, ["name"]);
      await attempt("an empty name is refused", { name: "" }, 400, ["name"]);
      const emoji = await attempt("an emoji and CJK name is stored", { name: "🚀日本語" }, 200);
      await ctx.verify("the emoji name is stored whole", [same("name", text(emoji.body, "name"), "🚀日本語")]);
      const d2000 = await attempt("a description of 2000 characters is stored", { name: ctx.unique("D"), description: "é".repeat(2000) }, 200);
      await ctx.verify("the 2000-character description is stored whole", [same("length", text(d2000.body, "description").length, 2000)]);
      await attempt("a description of 2001 characters is refused", { description: "é".repeat(2001) }, 400, ["description"]);
      for (const icon of ["i-ph-package", "i-lucide-git-fork", "i-a1-b-c-d", ""]) {
        const ok = await attempt(`the icon "${icon}" is accepted`, { icon }, 200);
        await ctx.verify(`the icon "${icon}" is stored`, [same("icon", text(ok.body, "icon"), icon)]);
      }
      for (const icon of ["ph-package", "i-ph", "I-ph-package", "i-ph-Package", "i-ph-pack age", "i-ph_x-y", "i--package", " i-ph-package", "i-ph-package "]) {
        const refused = await attempt(`the icon "${icon}" is refused`, { icon }, 400, ["icon"]);
        await ctx.verify(`the icon "${icon}" says what is expected`, [same("message", list(refused.body, "issues").map((issue) => issue.message), ["expected an icon name like i-ph-package"])]);
      }
    },
  },
];
