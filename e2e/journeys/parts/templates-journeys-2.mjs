import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { createProcedure, graph, statusIs } from "../../procs.mjs";
import { createTemplate, idsOf, instance, port, runGroup, templateBody } from "./templates-kit.mjs";
import { pause, readTemplate, nestingSubgraph, nestedGroups } from "./templates-helpers.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @typedef {import("../../auto.mjs").Row} Row */

/** @type {import("../../auto.mjs").Row[]} */
export const templatesJourneys2 = [
  {
    id: "a-template-with-broken-ports-or-graph-is-refused-whole",
    title: "duplicate ports, a nameless port, an unknown node kind, a data field with two sources, a trigger loop and groups nested more than 20 deep are refused with 400 and the documented text; 20 levels are accepted; nothing is stored by a refusal",
    entryPoint: "POST /templates, PUT /templates/:id",
    async run(/** @type {Ctx} */ ctx) {
      const keep = await createTemplate(ctx, "Keeper");
      const before = await readTemplate(ctx, keep);
      const node = (/** @type {string} */ id, /** @type {string} */ typeId, /** @type {Row} */ config = {}) => ({ id, kind: typeId.startsWith("const") ? "data" : "action", typeId, config, position: { x: 0, y: 0 } });
      /** @type {[string, Row, string, { paths?: unknown[], messages?: string[], issues?: string[] }][]} */
      const cases = [
        ["a duplicated port", { ports: [port("a", "data", "in"), port("b", "data", "in"), port("a", "data", "in")] }, "invalid body", { paths: [["ports", 2, "name"]], messages: ["duplicate port in/data/a"] }],
        ["a duplicated trigger port", { ports: [port("main", "trigger", "out"), port("main", "trigger", "out")] }, "invalid body", { paths: [["ports", 1, "name"]], messages: ["duplicate port out/trigger/main"] }],
        ["a nameless port", { ports: [port("", "data", "in")] }, "invalid body", { paths: [["ports", 0, "name"]] }],
        ["a port of an unknown kind", { ports: [{ name: "a", kind: "x", direction: "in" }] }, "invalid body", { paths: [["ports", 0, "kind"]] }],
        ["a port of an unknown direction", { ports: [{ name: "a", kind: "data", direction: "sideways" }] }, "invalid body", { paths: [["ports", 0, "direction"]] }],
        ["a port schema that is not an object", { ports: [{ name: "a", kind: "data", direction: "in", schema: "string" }] }, "invalid body", { paths: [["ports", 0, "schema"]] }],
        ["an unknown node kind", { subgraph: { nodes: [{ id: "a", kind: "frobnicate", config: {}, position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] } }, "invalid body", { paths: [["subgraph", "nodes", 0, "kind"]], messages: ["unknown node kind"] }],
        ["a data field with two sources", { subgraph: { nodes: [node("a", "const.string"), node("b", "const.string"), node("c", "log.message")], triggerEdges: [], dataEdges: [{ id: "1", from: { node: "a", port: "value" }, to: { node: "c", field: "message" } }, { id: "2", from: { node: "b", port: "value" }, to: { node: "c", field: "message" } }] } }, "invalid graph", { issues: ["data field has more than one source: c::message"] }],
        ["a trigger loop", { subgraph: { nodes: [node("a", "log.message"), node("b", "log.message")], triggerEdges: [{ id: "1", from: { node: "a" }, to: { node: "b" } }, { id: "2", from: { node: "b" }, to: { node: "a" } }], dataEdges: [] } }, "invalid graph", { issues: ['cycle detected in trigger edges: "a", "b"'] }],
        ["an edge from a step that does not exist", { subgraph: { nodes: [node("a", "log.message")], triggerEdges: [{ id: "1", from: { node: "ghost" }, to: { node: "a" } }], dataEdges: [] } }, "invalid graph", { issues: ['trigger edge 1: unknown source node "ghost"'] }],
        ["two steps with one id", { subgraph: { nodes: [node("a", "log.message"), node("a", "log.message")], triggerEdges: [], dataEdges: [] } }, "invalid graph", { issues: ['two nodes share the id "a"'] }],
        ["a group with neither a template nor steps", { subgraph: { nodes: [{ id: "g", kind: "group", config: {}, ports: [port("main", "trigger", "in")], position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] } }, "invalid graph", { issues: ['group "g": exactly one of templateId / subgraph must be set (neither is set)'] }],
        ["a group with no trigger input", { subgraph: { nodes: [{ id: "g", kind: "group", config: {}, ports: [], templateId: "whatever", position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] } }, "invalid graph", { issues: ['group "g": must declare at least one trigger-input port (otherwise the group can never start)'] }],
        ["a local group without its sentinels", { subgraph: { nodes: [{ id: "g", kind: "group", config: {}, ports: [port("main", "trigger", "in")], subgraph: { nodes: [], triggerEdges: [], dataEdges: [] }, position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] } }, "invalid graph", { issues: ['group "g": subgraph must contain exactly one groupInput node (found 0)', 'group "g": subgraph must contain exactly one groupOutput node (found 0)'] }],
        ["a trigger inside a group", { subgraph: { nodes: [{ id: "g", kind: "group", config: {}, ports: [port("main", "trigger", "in")], subgraph: { nodes: [{ id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } }, { id: "go", kind: "groupOutput", config: {}, position: { x: 0, y: 0 } }, { id: "tt", kind: "trigger", typeId: "manual", config: {}, position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] }, position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] } }, "invalid graph", { issues: ['group:g > node "tt" is a trigger inside a group (triggers must live at the top level)'] }],
        ["groups nested 21 levels deep", { subgraph: nestedGroups(21) }, "invalid body", { paths: [["subgraph"]], messages: ["groups are nested more than 20 levels deep"] }],
      ];
      for (const [label, extra, error, wanted] of cases) {
        const created = await auto(ctx, `create with ${label}`, "POST", "/templates", { body: templateBody(ctx.unique("Bad"), extra) });
        const edited = await auto(ctx, `edit with ${label}`, "PUT", `/templates/${keep}`, { body: templateBody("Keeper", extra) });
        const given = pick(created.body, "issues");
        const rows = list(created.body, "issues");
        await ctx.verify(label, [
          statusIs(created, 400, `${label}: create is refused`),
          same(`${label}: error`, text(created.body, "error"), error),
          ...(wanted.issues ? [same(`${label}: the issues`, given, wanted.issues)] : []),
          ...(wanted.paths ? [same(`${label}: the issue paths`, rows.map((issue) => issue.path), wanted.paths)] : []),
          ...(wanted.messages ? [same(`${label}: the issue messages`, rows.map((issue) => issue.message), wanted.messages)] : []),
          statusIs(edited, 400, `${label}: edit is refused`),
          same(`${label}: edit error`, text(edited.body, "error"), error),
          same(`${label}: edit issues are the same`, pick(edited.body, "issues"), given),
        ]);
      }
      const deep = await auto(ctx, "create 20 levels deep", "POST", "/templates", { body: templateBody(ctx.unique("Deep"), { subgraph: nestedGroups(20) }) });
      await ctx.verify("20 nested levels are accepted", [statusIs(deep, 200, "20 levels answer 200")]);
      const after = await readTemplate(ctx, keep);
      const all = await auto(ctx, "list after the refusals", "GET", "/templates");
      await ctx.verify("refusals stored and changed nothing", [same("the kept template is unchanged", after.body, before.body), same("only Keeper and the 20-level template exist", list(all.body, "results").length, 2)]);
    },
  },
  {
    id: "the-list-pages-newest-edit-first-and-counts-each-owner-once",
    title: "GET /templates lists templates by last edit, newest first, in pages of up to 1000; usageCount counts each procedure or template placing one once however many times; bad page values answer 400",
    entryPoint: "GET /templates?page&limit",
    async run(/** @type {Ctx} */ ctx) {
      const a = await createTemplate(ctx, "A one");
      await pause(30);
      const b = await createTemplate(ctx, "B two");
      await pause(30);
      const c = await createTemplate(ctx, "C three");
      const order = async (/** @type {string} */ query) => idsOf((await auto(ctx, `list ${query || "default"}`, "GET", `/templates${query}`)).body);
      await ctx.verify("newest created first", [same("order", await order(""), [c, b, a])]);
      await pause(30);
      await auto(ctx, "edit A", "PUT", `/templates/${a}`, { body: templateBody("A one", { description: "edited" }) });
      await ctx.verify("an edit moves a template to the front", [same("order", await order(""), [a, c, b])]);
      const page0 = await auto(ctx, "page 0 of 2", "GET", "/templates?page=0&limit=2");
      const page1 = await auto(ctx, "page 1 of 2", "GET", "/templates?page=1&limit=2");
      const page2 = await auto(ctx, "page 2 of 2", "GET", "/templates?page=2&limit=2");
      const big = await auto(ctx, "limit above the maximum", "GET", "/templates?limit=5000");
      await ctx.verify("pages", [
        same("page 0", [idsOf(page0.body), pick(page0.body, "total"), pick(page0.body, "page"), pick(page0.body, "limit")], [[a, c], 3, 0, 2]),
        same("page 1", [idsOf(page1.body), pick(page1.body, "page")], [[b], 1]),
        same("page 2 is empty but keeps the total", [idsOf(page2.body), pick(page2.body, "total")], [[], 3]),
        same("a limit above 1000 is read as 1000", pick(big.body, "limit"), 1000),
      ]);
      for (const query of ["?page=-1", "?page=abc", "?page=1.5", "?limit=0", "?limit=-3", "?limit=x", "?page=0&limit=0"]) {
        const bad = await auto(ctx, `list ${query}`, "GET", `/templates${query}`);
        await ctx.verify(`${query} is refused`, [
          statusIs(bad, 400, "400"),
          same("the body", bad.body, { error: "page must be an integer >= 0 and limit an integer >= 1", message: "$dms_automation.api.invalidPage" }),
        ]);
      }
      const counts = async () => {
        /** @type {Record<string, unknown>} */
        const byName = {};
        const rows = list((await auto(ctx, "list for counts", "GET", "/templates")).body, "results").sort((x, y) => text(x, "name").localeCompare(text(y, "name")));
        for (const row of rows) byName[text(row, "name")] = row.usageCount;
        return byName;
      };
      await ctx.verify("unused templates count 0", [same("counts", await counts(), { "A one": 0, "B two": 0, "C three": 0 })]);
      const twice = graph([...runGroup(instance("g1", a)).nodes, instance("g2", a)], runGroup(instance("g1", a)).triggerEdges, runGroup(instance("g1", a)).dataEdges);
      const p1 = await createProcedure(ctx, { graph: twice });
      await ctx.verify("a procedure placing a template twice counts once", [same("counts", await counts(), { "A one": 1, "B two": 0, "C three": 0 })]);
      const p2 = await createProcedure(ctx, { graph: runGroup(instance("g1", a)) });
      const host = await auto(ctx, "a template placing A and B", "POST", "/templates", { body: templateBody("Host", { subgraph: { nodes: [{ id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } }, instance("x", a), instance("y", a), instance("z", b), { id: "go", kind: "groupOutput", config: {}, position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] } }) });
      await ctx.verify("procedures and templates both count, each once", [
        statusIs(host, 200, "the host template is stored"),
        same("counts", await counts(), { "A one": 3, "B two": 1, "C three": 0, Host: 0 }),
      ]);
      await auto(ctx, "delete P2 usage by deleting the procedure", "DELETE", `/procedures/${p2}`);
      await ctx.verify("deleting a procedure lowers the count", [same("counts", await counts(), { "A one": 2, "B two": 1, "C three": 0, Host: 0 })]);
      void p1;
    },
  },
  {
    id: "a-template-reference-cycle-is-refused",
    title: "a template that would place itself, directly or through other templates, is refused with 400 template reference cycle and the path of template ids; the stored templates stay as they were",
    entryPoint: "PUT /templates/:id",
    async run(/** @type {Ctx} */ ctx) {
      const a = await createTemplate(ctx, "Cycle A");
      const b = await createTemplate(ctx, "Cycle B", { subgraph: nestingSubgraph(a) });
      const c = await createTemplate(ctx, "Cycle C", { subgraph: nestingSubgraph(b) });
      const beforeA = await readTemplate(ctx, a);
      const direct = await auto(ctx, "A places A", "PUT", `/templates/${a}`, { body: templateBody("Cycle A", { subgraph: nestingSubgraph(a) }) });
      const viaB = await auto(ctx, "A places B which places A", "PUT", `/templates/${a}`, { body: templateBody("Cycle A", { subgraph: nestingSubgraph(b) }) });
      const viaC = await auto(ctx, "A places C which places B which places A", "PUT", `/templates/${a}`, { body: templateBody("Cycle A", { subgraph: nestingSubgraph(c) }) });
      const inLocalGroup = await auto(ctx, "A places B inside a local group", "PUT", `/templates/${a}`, {
        body: templateBody("Cycle A", {
          subgraph: {
            nodes: [
              { id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } },
              { id: "outer", kind: "group", config: {}, ports: [port("main", "trigger", "in")], subgraph: nestingSubgraph(b), position: { x: 0, y: 0 } },
              { id: "go", kind: "groupOutput", config: {}, position: { x: 0, y: 0 } },
            ],
            triggerEdges: [],
            dataEdges: [],
          },
        }),
      });
      const middle = await auto(ctx, "B places C which places B", "PUT", `/templates/${b}`, { body: templateBody("Cycle B", { subgraph: nestingSubgraph(c) }) });
      await ctx.verify("every loop is refused with its path", [
        statusIs(direct, 400, "A -> A answers 400"),
        same("A -> A", direct.body, { error: "template reference cycle", cycle: [a, a] }),
        same("A -> B -> A", viaB.body, { error: "template reference cycle", cycle: [a, b, a] }),
        same("A -> C -> B -> A", viaC.body, { error: "template reference cycle", cycle: [a, c, b, a] }),
        same("a loop through a local group", inLocalGroup.body, { error: "template reference cycle", cycle: [a, b, a] }),
        same("a loop that does not pass through the edited template", middle.body, { error: "template reference cycle", cycle: [b, c, b] }),
      ]);
      const afterA = await readTemplate(ctx, a);
      const fine = await auto(ctx, "A places nothing again", "PUT", `/templates/${a}`, { body: templateBody("Cycle A", { description: "still fine" }) });
      const diamond = await createTemplate(ctx, "Diamond", {
        subgraph: {
          nodes: [{ id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } }, instance("l", b), instance("r", c), { id: "go", kind: "groupOutput", config: {}, position: { x: 0, y: 0 } }],
          triggerEdges: [],
          dataEdges: [],
        },
      });
      await ctx.verify("nothing was stored by a refusal and a diamond is no loop", [
        same("A is unchanged", afterA.body, beforeA.body),
        statusIs(fine, 200, "a harmless edit still works"),
        check("a template placing two templates that share a base is stored", diamond.length > 0, diamond),
      ]);
    },
  },
];
