import { auto, list, pick, same, text } from "../../auto.mjs";
import { createProcedure, graph, logsOf, messages, runNow, runOf, statusIs } from "../../procs.mjs";
import { GREETER_PORTS, createTemplate, greeterSubgraph, idsOf, instance, localGroup, runGroup, templateBody } from "./templates-kit.mjs";
import { readTemplate, readProcedure, nodeOf, nestingSubgraph } from "./templates-helpers.mjs";
import { byText } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @typedef {import("../../auto.mjs").Row} Row */

/** @type {import("../../auto.mjs").Row[]} */
export const templatesJourneys3 = [
  {
    id: "usages-name-every-procedure-and-template-placing-a-template",
    title: "GET /templates/:id/usages lists each placement with its procedure or template id, node id and the ids of the local groups around it, outermost first; it follows renames, nesting and deletions",
    entryPoint: "GET /templates/:id/usages",
    async run(/** @type {Ctx} */ ctx) {
      const t = await createTemplate(ctx, "Placed");
      const empty = await auto(ctx, "usages of an unused template", "GET", `/templates/${t}/usages`);
      await ctx.verify("an unused template has no usages", [same("usages", empty.body, { procedures: [], templates: [] })]);
      const direct = await createProcedure(ctx, { graph: runGroup(instance("g1", t)) });
      const nestedGraph = runGroup({
        id: "outer",
        kind: "group",
        config: {},
        ports: GREETER_PORTS,
        position: { x: 0, y: 0 },
        subgraph: {
          nodes: [
            { id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } },
            {
              id: "middle",
              kind: "group",
              config: {},
              ports: GREETER_PORTS,
              position: { x: 0, y: 0 },
              subgraph: { nodes: [{ id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } }, instance("deep", t), { id: "go", kind: "groupOutput", config: {}, position: { x: 0, y: 0 } }], triggerEdges: [], dataEdges: [] },
            },
            instance("shallow", t),
            { id: "go", kind: "groupOutput", config: {}, position: { x: 0, y: 0 } },
          ],
          triggerEdges: [],
          dataEdges: [],
        },
      });
      const nested = await createProcedure(ctx, { graph: nestedGraph });
      const twice = await createProcedure(ctx, { graph: graph([...runGroup(instance("first", t)).nodes, instance("second", t)], runGroup(instance("first", t)).triggerEdges, runGroup(instance("first", t)).dataEdges) });
      const host = await createTemplate(ctx, "Host", { subgraph: nestingSubgraph(t) });
      const usages = await auto(ctx, "usages", "GET", `/templates/${t}/usages`);
      const byProcedure = (/** @type {Row} */ row) => String(row.procedureId);
      const procedures = list(usages.body, "procedures");
      const find = (/** @type {string} */ id) => procedures.filter((row) => byProcedure(row) === id).map((row) => ({ nodeId: row.nodeId, groupPath: row.groupPath }));
      await ctx.verify("each placement is listed with its place", [
        same("number of procedure placements", procedures.length, 5),
        same("a direct placement", find(direct), [{ nodeId: "g1", groupPath: [] }]),
        same("a placement inside two local groups", find(nested).sort((x, y) => String(x.nodeId).localeCompare(String(y.nodeId))), [
          { nodeId: "deep", groupPath: ["outer", "middle"] },
          { nodeId: "shallow", groupPath: ["outer"] },
        ]),
        same("two placements in one procedure are two rows", find(twice).map((row) => text(row, "nodeId")).sort(byText), ["first", "second"]),
        same("the template placing it", pick(usages.body, "templates"), [{ templateId: host, nodeId: "inner", groupPath: [] }]),
      ]);
      const renamed = await auto(ctx, "rename the placed template", "PUT", `/templates/${t}`, { body: templateBody("Placed again") });
      const afterRename = await auto(ctx, "usages after a rename", "GET", `/templates/${t}/usages`);
      await auto(ctx, "delete the direct procedure", "DELETE", `/procedures/${direct}`);
      const afterDelete = await auto(ctx, "usages after deleting a procedure", "GET", `/templates/${t}/usages`);
      await ctx.verify("usages follow edits", [
        statusIs(renamed, 200, "rename"),
        same("a rename keeps the usages", list(afterRename.body, "procedures").length, 5),
        same("a deleted procedure leaves the usages", list(afterDelete.body, "procedures").map(byProcedure).includes(direct), false),
        same("four placements are left", list(afterDelete.body, "procedures").length, 4),
      ]);
    },
  },
  {
    id: "editing-a-template-changes-every-procedure-placing-it",
    title: "an edit of a template changes what each procedure placing it runs, moves their version on, marks their earlier runs as older, and leaves procedures that do not place it alone",
    entryPoint: "PUT /templates/:id, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const t = await createTemplate(ctx, "Shared");
      const p1 = await createProcedure(ctx, { graph: runGroup(instance("g1", t), "un") });
      const p2 = await createProcedure(ctx, { graph: runGroup(instance("g1", t), "deux") });
      const other = await createProcedure(ctx, { graph: runGroup(localGroup("g1", "Own"), "trois") });
      for (const id of [p1, p2, other]) await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const stored = await readProcedure(ctx, p1);
      await ctx.verify("a linked instance stores the template id and no steps", [
        same("templateId", nodeOf(stored, "g1").templateId, t),
        same("no inline subgraph", nodeOf(stored, "g1").subgraph, undefined),
        same("the ports the instance declares", nodeOf(stored, "g1").ports, GREETER_PORTS),
      ]);
      const first = [];
      for (const id of [p1, p2, other]) first.push(await runNow(ctx, id, {}));
      const levelOf = async (/** @type {string} */ runId, /** @type {string} */ node) => {
        const entries = await logsOf(ctx, runId);
        return entries.filter((entry) => entry.nodeId === node && entry.source !== "exec").map((entry) => [entry.level, entry.message]);
      };
      await ctx.verify("before the edit each procedure logs at info", [
        same("p1", await levelOf(first[0].runId, "g1__log"), [["info", "un"]]),
        same("p2", await levelOf(first[1].runId, "g1__log"), [["info", "deux"]]),
        same("the procedure with its own group", await levelOf(first[2].runId, "g1__log"), [["info", "trois"]]),
        same("versions", [(await readProcedure(ctx, p1)).version, (await readProcedure(ctx, p2)).version, (await readProcedure(ctx, other)).version], [1, 1, 1]),
      ]);
      const oldRun = await runOf(ctx, first[0].runId);
      const edit = await auto(ctx, "edit the template", "PUT", `/templates/${t}`, { body: templateBody("Shared", { subgraph: greeterSubgraph("error") }) });
      const second = [];
      for (const id of [p1, p2, other]) second.push(await runNow(ctx, id, {}));
      const runP1 = await runOf(ctx, first[0].runId);
      const newRun = await runOf(ctx, second[0].runId);
      await ctx.verify("after the edit every placing procedure logs at error", [
        statusIs(edit, 200, "edit"),
        same("p1", await levelOf(second[0].runId, "g1__log"), [["error", "un"]]),
        same("p2", await levelOf(second[1].runId, "g1__log"), [["error", "deux"]]),
        same("the procedure with its own group is untouched", await levelOf(second[2].runId, "g1__log"), [["info", "trois"]]),
        same("versions move on for the two placing procedures only", [(await readProcedure(ctx, p1)).version, (await readProcedure(ctx, p2)).version, (await readProcedure(ctx, other)).version], [2, 2, 1]),
        same("the run before the edit ran version 1", runP1.procedureVersion, 1),
        same("the run before the edit is outdated against the new graph", [oldRun.graphOutdated, runP1.graphOutdated], [false, true]),
        same("the run after the edit ran version 2", [newRun.procedureVersion, newRun.graphOutdated], [2, false]),
        same("the run before the edit is marked as older", runP1.procedureCurrentVersion, 2),
      ]);
    },
  },
  {
    id: "deleting-a-used-template-needs-force-and-forks-every-usage",
    title: "DELETE of a template placed somewhere answers 409 in-use with the placements; only force=1 or force=true forks every usage into a local group holding a copy of the template and keeping its own name or taking the template's, then deletes it and answers how many were forked",
    entryPoint: "DELETE /templates/:id[?force], GET /procedures/:id, GET /templates/:id",
    async run(/** @type {Ctx} */ ctx) {
      const t = await createTemplate(ctx, "Doomed");
      const tpl = await readTemplate(ctx, t);
      const named = await createProcedure(ctx, { graph: runGroup(instance("g1", t, GREETER_PORTS, "Mon groupe 🚀")), name: ctx.unique("Named") });
      const plain = await createProcedure(ctx, { graph: runGroup(instance("g1", t)), name: ctx.unique("Plain") });
      const deep = await createProcedure(ctx, {
        name: ctx.unique("Deep"),
        graph: runGroup({
          id: "outer",
          kind: "group",
          config: {},
          label: "Outer",
          ports: GREETER_PORTS,
          position: { x: 0, y: 0 },
          subgraph: nestingSubgraph(t),
        }),
      });
      const host = await createTemplate(ctx, "Host of doomed", { subgraph: nestingSubgraph(t) });
      for (const id of [named, plain, deep]) await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const versions = async () => [(await readProcedure(ctx, named)).version, (await readProcedure(ctx, plain)).version, (await readProcedure(ctx, deep)).version];
      await ctx.verify("before", [same("versions", await versions(), [1, 1, 1])]);
      const refused = await auto(ctx, "delete without force", "DELETE", `/templates/${t}`);
      await ctx.verify("a used template is not deleted without force", [
        statusIs(refused, 409, "409"),
        same("error and code", [text(refused.body, "error"), text(refused.body, "code")], ["template has usages; pass ?force=1 to fork them", "in-use"]),
        same("procedures listed", list(refused.body, "procedures").map((row) => `${String(row.nodeId)}@${Array.isArray(row.groupPath) ? row.groupPath.join("/") : ""}`).sort(byText), ["g1@", "g1@", "inner@outer"]),
        same("templates listed", pick(refused.body, "templates"), [{ templateId: host, nodeId: "inner", groupPath: [] }]),
      ]);
      for (const force of ["0", "yes", "", "TRUE", "2"]) {
        const still = await auto(ctx, `delete with force=${force}`, "DELETE", `/templates/${t}?force=${force}`);
        await ctx.verify(`force=${force} does not force`, [statusIs(still, 409, "409"), same("code", text(still.body, "code"), "in-use")]);
      }
      const kept = await readTemplate(ctx, t);
      await ctx.verify("the refusals kept the template and the procedures", [same("template", kept.body, tpl.body), same("versions", await versions(), [1, 1, 1]), same("g1 still linked", nodeOf(await readProcedure(ctx, named), "g1").templateId, t)]);
      const forced = await auto(ctx, "delete with force=1", "DELETE", `/templates/${t}?force=1`);
      const namedAfter = await readProcedure(ctx, named);
      const plainAfter = await readProcedure(ctx, plain);
      const deepAfter = await readProcedure(ctx, deep);
      const hostAfter = await readTemplate(ctx, host);
      const innerOfHost = list(hostAfter.body, "subgraph", "nodes").find((node) => node.id === "inner") ?? {};
      const outerAfter = nodeOf(deepAfter, "outer");
      const insideAfter = list(outerAfter, "subgraph", "nodes").find((node) => node.id === "inner") ?? {};
      await ctx.verify("force=1 forks every usage and deletes", [
        statusIs(forced, 200, "200"),
        same("answer", forced.body, { _id: t, forked: 4 }),
        same("the named instance became a local group with its name", [nodeOf(namedAfter, "g1").templateId, nodeOf(namedAfter, "g1").label], [undefined, "Mon groupe 🚀"]),
        same("the named group holds a copy of the template", nodeOf(namedAfter, "g1").subgraph, pick(tpl.body, "subgraph")),
        same("the unnamed instance takes the template's name", nodeOf(plainAfter, "g1").label, "Doomed"),
        same("the unnamed group holds a copy of the template", nodeOf(plainAfter, "g1").subgraph, pick(tpl.body, "subgraph")),
        same("an instance inside a local group is forked in place", [insideAfter.templateId, insideAfter.label, insideAfter.subgraph], [undefined, "Doomed", pick(tpl.body, "subgraph")]),
        same("the local group around it is untouched", [outerAfter.label, outerAfter.templateId], ["Outer", undefined]),
        same("the template placing it keeps working with a local group", [innerOfHost.templateId, innerOfHost.label, innerOfHost.subgraph], [undefined, "Doomed", pick(tpl.body, "subgraph")]),
        same("the ports of the group are kept", nodeOf(plainAfter, "g1").ports, GREETER_PORTS),
        same("versions move on", await versions(), [2, 2, 2]),
        same("revisions move on", [namedAfter.revision, plainAfter.revision, deepAfter.revision], [3, 3, 3]),
      ]);
      const gone = await readTemplate(ctx, t);
      const goneUsages = await auto(ctx, "usages of the deleted template", "GET", `/templates/${t}/usages`);
      const again = await auto(ctx, "delete again", "DELETE", `/templates/${t}?force=1`);
      const listed = await auto(ctx, "list after the delete", "GET", "/templates");
      await ctx.verify("the template is gone", [
        statusIs(gone, 404, "GET one 404"),
        same("GET one body", gone.body, { error: `template "${t}" not found` }),
        statusIs(goneUsages, 404, "usages 404"),
        statusIs(again, 404, "a second delete 404"),
        same("a second delete body", again.body, { error: `template "${t}" not found` }),
        same("only the host is listed", idsOf(listed.body), [host]),
      ]);
      const ran = [];
      for (const id of [named, plain, deep]) ran.push(await runNow(ctx, id, {}));
      await ctx.verify("the procedures keep working", [
        same("statuses", ran.map((r) => r.status), ["ok", "ok", "ok"]),
        same("the named one logs from inside its group", (await logsOf(ctx, ran[0].runId)).filter((e) => e.nodeId === "g1__log" && e.source !== "exec").map((e) => e.message), ["hello"]),
        same("the nested one logs from inside both groups", messages((await logsOf(ctx, ran[2].runId)).filter((e) => e.nodeId === "outer__inner__log" && e.source !== "exec")), ["hello"]),
      ]);
      const unused = await createTemplate(ctx, "Unused");
      const lone = await auto(ctx, "delete an unused template without force", "DELETE", `/templates/${unused}`);
      const unused2 = await createTemplate(ctx, "Unused too");
      const lone2 = await auto(ctx, "delete an unused template with force", "DELETE", `/templates/${unused2}?force=true`);
      await ctx.verify("an unused template deletes with nothing forked", [same("without force", lone.body, { _id: unused, forked: 0 }), same("with force=true", lone2.body, { _id: unused2, forked: 0 })]);
      const truthy = await createTemplate(ctx, "Truthy");
      await createProcedure(ctx, { graph: runGroup(instance("g1", truthy)) });
      const viaTrue = await auto(ctx, "delete with force=true", "DELETE", `/templates/${truthy}?force=true`);
      await ctx.verify("force=true forks too", [same("answer", viaTrue.body, { _id: truthy, forked: 1 })]);
    },
  },
];
