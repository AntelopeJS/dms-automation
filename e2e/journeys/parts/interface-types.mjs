import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { createProcedure, runNow, runOf } from "../../procs.mjs";
import { actionNode, defineType, invokeProcedure, listedTypes, runProcedure, stepOf, triggerNode, unregisterType, valueOf } from "./interface-calls.mjs";
import { byId, times } from "./interface-types-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const typeJourneys = [
  {
    id: "registered-types-are-listed-with-their-definition",
    title: "ListTriggerTypes, ListActionTypes and ListDataNodeTypes return what modules registered, the library shows each with its module, name, description, icon and schemas, and the built-ins are there",
    entryPoint: "RegisterTriggerType, RegisterActionType, RegisterDataNodeType, List*Types, GET /trigger-types, /action-types, /data-node-types",
    async run(/** @type {Ctx} */ ctx) {
      const listed = await listedTypes(ctx);
      await ctx.verify("the List* functions", [
        check(
          "the fixture triggers are listed",
          ["verify.event", "verify.leader-event", "verify.bad-arm", "verify.hang-arm"].every((id) => listed.triggers.includes(id)),
          listed.triggers,
        ),
        check(
          "the built-in triggers are listed",
          ["manual", "schedule.cron", "webhook"].every((id) => listed.triggers.includes(id)),
          listed.triggers,
        ),
        check(
          "the fixture and built-in actions are listed",
          ["verify.echo", "verify.effect", "log.message", "http.request"].every((id) => listed.actions.includes(id)),
          listed.actions,
        ),
        check(
          "the fixture and built-in data nodes are listed",
          ["verify.upper", "verify.suffix", "const.string", "math.add"].every((id) => listed.data.includes(id)),
          listed.data,
        ),
        same(
          "the DMS registers its event triggers",
          ["dms.member-added", "dms.member-removed", "dms.invite-created", "dms.user-registered", "dms.record-created", "dms.record-updated", "dms.record-deleted"].filter((id) => !listed.triggers.includes(id)),
          [],
        ),
        same(
          "the DMS registers its actions",
          ["dms.send-email", "dms.send-notification", "dms.invite-user"].filter((id) => !listed.actions.includes(id)),
          [],
        ),
        same("each id is listed once", [times(listed.triggers, "manual"), times(listed.actions, "verify.echo"), times(listed.data, "verify.upper")], [1, 1, 1]),
      ]);
      const triggers = list((await auto(ctx, "trigger types", "GET", "/trigger-types")).body);
      const actions = list((await auto(ctx, "action types", "GET", "/action-types")).body);
      const data = list((await auto(ctx, "data node types", "GET", "/data-node-types")).body);
      const event = byId(triggers, "verify.event");
      const leader = byId(triggers, "verify.leader-event");
      await ctx.verify("a trigger type as the library lists it", [
        same("id, name, description, icon", [event.id, event.name, event.description, event.icon], ["verify.event", "Fixture event", "Fixture trigger verify.event", "i-lucide-zap"]),
        same("the cluster mode replicated", event.cluster, "replicated"),
        same("the cluster mode singleton", leader.cluster, "singleton"),
        same("the registering module", event.module, "app"),
        same("the configSchema", event.configSchema, {
          type: "object",
          properties: { topic: { type: "string", title: "Topic" } },
        }),
        same("the outputSchema", event.outputSchema, {
          type: "object",
          properties: { topic: { type: "string" }, value: { type: "string" } },
        }),
        same("it is on by default", event.enabled, true),
        same("a module's trigger has no activate or deactivate on the wire", [Object.hasOwn(event, "activate"), Object.hasOwn(event, "deactivate")], [false, false]),
        same("the built-in triggers' modes", [byId(triggers, "manual").cluster, byId(triggers, "schedule.cron").cluster, byId(triggers, "webhook").cluster], ["replicated", "singleton", "replicated"]),
        check("a built-in carries no module", !Object.hasOwn(byId(triggers, "manual"), "module"), byId(triggers, "manual")),
      ]);
      const echo = byId(actions, "verify.echo");
      const nodry = byId(actions, "verify.effect-nodry");
      await ctx.verify("an action type as the library lists it", [
        same("id, name, description, icon", [echo.id, echo.name, echo.description, echo.icon], ["verify.echo", "Fixture echo", "Returns its input; reads and computes only", "i-lucide-repeat"]),
        same("sideEffects false", echo.sideEffects, false),
        same("sideEffects absent when not declared", Object.hasOwn(nodry, "sideEffects"), false),
        same("the inputSchema", echo.inputSchema, {
          type: "object",
          properties: { value: {}, n: { type: "number" } },
        }),
        same("the outputSchema", echo.outputSchema, {
          type: "object",
          properties: { value: {}, n: { type: "number" } },
        }),
        same("the registering module", echo.module, "app"),
        same("execute is not on the wire", Object.hasOwn(echo, "execute"), false),
      ]);
      const upper = byId(data, "verify.upper");
      const suffix = byId(data, "verify.suffix");
      await ctx.verify("a data node type as the library lists it", [
        same("id, category, name, description, icon", [upper.id, upper.category, upper.name, upper.description, upper.icon], ["verify.upper", "Verify", "Fixture upper-case", "Upper-cases its text", "i-lucide-case-upper"]),
        same("the inputSchema keeps its default", upper.inputSchema, {
          type: "object",
          properties: { text: { type: "string", default: "fallback" } },
        }),
        same(
          "the configSchema is separate from the inputSchema",
          [suffix.configSchema, suffix.inputSchema],
          [
            {
              type: "object",
              properties: { suffix: { type: "string", title: "Suffix" } },
            },
            { type: "object", properties: { text: { type: "string" } } },
          ],
        ),
        same("evaluate is not on the wire", Object.hasOwn(upper, "evaluate"), false),
      ]);
    },
  },
  {
    id: "a-colliding-id-replaces-the-definition",
    title: "registering an id twice keeps one node, the second definition, for triggers, actions and data nodes",
    entryPoint: "RegisterActionType, RegisterDataNodeType, RegisterTriggerType, GET /action-types, /data-node-types, /trigger-types",
    async run(/** @type {Ctx} */ ctx) {
      const stamp = Date.now().toString(36);
      const action = `verify.collide-a-${stamp}`;
      const node = `verify.collide-d-${stamp}`;
      const trig = `verify.collide-t-${stamp}`;
      await defineType(ctx, {
        kind: "action",
        id: action,
        name: "First action",
        output: { v: 1 },
      });
      await defineType(ctx, {
        kind: "data",
        id: node,
        name: "First data node",
        output: { v: 1 },
      });
      await defineType(ctx, {
        kind: "trigger",
        id: trig,
        name: "First trigger",
        cluster: "replicated",
      });
      await defineType(ctx, {
        kind: "action",
        id: action,
        name: "Second action — é",
        output: { v: 2 },
      });
      await defineType(ctx, {
        kind: "data",
        id: node,
        name: "Second data node",
        output: { v: 2 },
      });
      await defineType(ctx, {
        kind: "trigger",
        id: trig,
        name: "Second trigger",
        cluster: "singleton",
      });
      const listed = await listedTypes(ctx);
      await ctx.verify("List* returns one node per id", [same("one action", times(listed.actions, action), 1), same("one data node", times(listed.data, node), 1), same("one trigger", times(listed.triggers, trig), 1)]);
      const actions = list((await auto(ctx, "action types", "GET", "/action-types")).body).filter((row) => row.id === action);
      const data = list((await auto(ctx, "data node types", "GET", "/data-node-types")).body).filter((row) => row.id === node);
      const triggers = list((await auto(ctx, "trigger types", "GET", "/trigger-types")).body).filter((row) => row.id === trig);
      await ctx.verify("the library shows the second definition", [
        same(
          "the action",
          actions.map((row) => row.name),
          ["Second action — é"],
        ),
        same(
          "the data node",
          data.map((row) => row.name),
          ["Second data node"],
        ),
        same(
          "the trigger",
          triggers.map((row) => [row.name, row.cluster]),
          [["Second trigger", "singleton"]],
        ),
      ]);
      const id = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("t"), actionNode("a", action)],
          triggerEdges: [{ id: "e", from: { node: "t" }, to: { node: "a" } }],
          dataEdges: [],
        },
      });
      const ran = await runNow(ctx, id);
      const run = await runOf(ctx, ran.runId);
      await ctx.verify("a run calls the second definition", [same("the action's output", valueOf(stepOf(run, "a").output), { v: 2 })]);
    },
  },
  {
    id: "a-removed-type-leaves-saved-graphs-and-run-history",
    title: "the unregister functions remove the declaration only: the saved graph and the run history stay, and a run of that graph is refused or fails until the type is registered again",
    entryPoint: "UnregisterActionType, UnregisterDataNodeType, RunProcedure, InvokeProcedure, GET /procedures/:id, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const stamp = Date.now().toString(36);
      const action = `verify.removable-${stamp}`;
      const node = `verify.removable-data-${stamp}`;
      await defineType(ctx, {
        kind: "action",
        id: action,
        name: "Removable",
        output: { alive: true },
      });
      await defineType(ctx, {
        kind: "data",
        id: node,
        name: "Removable data",
        output: { alive: true },
      });
      const graph = {
        nodes: [triggerNode("t"), actionNode("a", action)],
        triggerEdges: [{ id: "e", from: { node: "t" }, to: { node: "a" } }],
        dataEdges: [],
      };
      const id = await createProcedure(ctx, {
        name: ctx.unique("Removable"),
        graph,
      });
      const before = await runNow(ctx, id);
      await unregisterType(ctx, "action", action);
      await unregisterType(ctx, "data", node);
      await unregisterType(ctx, "action", `verify.never-registered-${stamp}`);
      const listed = await listedTypes(ctx);
      const actions = list((await auto(ctx, "action types", "GET", "/action-types")).body);
      const data = list((await auto(ctx, "data node types", "GET", "/data-node-types")).body);
      await ctx.verify("the declarations are gone", [
        same("List* no longer returns the action", listed.actions.includes(action), false),
        same("List* no longer returns the data node", listed.data.includes(node), false),
        same(
          "the library no longer lists the action",
          actions.some((row) => row.id === action),
          false,
        ),
        same(
          "the library no longer lists the data node",
          data.some((row) => row.id === node),
          false,
        ),
        check("the other types stay", listed.actions.includes("verify.echo") && listed.data.includes("verify.upper"), listed.actions),
      ]);
      const saved = await auto(ctx, "the saved procedure", "GET", `/procedures/${id}`);
      const oldRun = await runOf(ctx, before.runId);
      const oldList = await auto(ctx, "the procedure's runs", "GET", `/procedures/${id}/runs`);
      await ctx.verify("the graph and the history stay", [
        same(
          "the saved nodes",
          list(saved.body, "graph", "nodes").map((n) => [n.id, n.typeId]),
          [
            ["t", "manual"],
            ["a", action],
          ],
        ),
        same("the earlier run is still there", [oldRun.status, valueOf(stepOf(oldRun, "a").output)], ["ok", { alive: true }]),
        same(
          "the history lists it",
          list(oldList.body).map((row) => row._id),
          [before.runId],
        ),
      ]);
      const refused = await runProcedure(ctx, id);
      const issues = list(refused.body, "issues");
      await ctx.verify("RunProcedure refuses the graph naming the issue", [
        same("status", refused.status, 400),
        same("the body's error", pick(refused.body, "error"), "invalid graph"),
        same(
          "the issues",
          issues.map((issue) => [issue.severity, issue.code, issue.message, issue.nodeId]),
          [["error", "unknownType", `action node "a" references unknown type "${action}"`, "a"]],
        ),
      ]);
      const invoked = await invokeProcedure(ctx, id);
      const failedRun = await runOf(ctx, text(invoked.result, "runId"));
      await ctx.verify("InvokeProcedure still stores a failed run", [
        check("it resolves to a run id", invoked.ok && text(invoked.result, "runId").length > 0, invoked.raw),
        same("the run failed", failedRun.status, "failed"),
        same("the run's error", failedRun.errorMessage, `action node "a" references unknown type "${action}"`),
        check("the failed step is named", pick(failedRun, "failedStep") !== null, pick(failedRun, "failedStep")),
      ]);
      await defineType(ctx, {
        kind: "action",
        id: action,
        name: "Removable",
        output: { alive: "again" },
      });
      const again = await runProcedure(ctx, id);
      const rerun = await runOf(ctx, text(again.result, "runId"));
      await ctx.verify("registering the type again brings the graph back", [
        same("status", again.result.status, "ok"),
        same("the output", valueOf(stepOf(rerun, "a").output), {
          alive: "again",
        }),
      ]);
    },
  },
];
