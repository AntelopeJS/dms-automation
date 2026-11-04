import { check, fixture, list, pick, same } from "../../auto.mjs";
import { runsOfProcedure } from "../../procs.mjs";
import { actionNode, chainGraph, declareProcedure, logGraph, triggerNode } from "./interface-calls.mjs";
import { declaration, refusal, stored } from "./interface-declare-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const declareJourneys = [
  {
    id: "declare-procedure-accepts-the-documented-id-charset-and-length",
    title: "DeclareProcedure ids: letters, digits, '.', '_' and '-', starting with a letter or a digit, at most 120 characters; the id becomes the procedure's id",
    entryPoint: "DeclareProcedure({ id }), GET /procedures/:id, InvokeProcedure(id), RunProcedure(id)",
    async run(/** @type {Ctx} */ ctx) {
      const accepted = ["A", "9", "a.b_c-D9", "bakery.quote-follow-up", "x".repeat(120), `${"a".repeat(59)}.${"b".repeat(60)}`];
      /** @type {import("../../auto.mjs").Check[]} */
      const checks = [];
      for (const id of accepted) {
        const outcome = await declareProcedure(ctx, declaration(id));
        const read = await stored(ctx, id);
        checks.push(same(`"${id.slice(0, 30)}" (${id.length}) is created under its own id`, [outcome.ok, outcome.result.status, read?._id], [true, "created", id]));
      }
      await ctx.verify("ids that are accepted", checks);
      const refused = ["", "_a", ".a", "-a", "a b", "a/b", "a:b", "a@b", "é", "日本", "aé", "a b c", "x".repeat(121), "x".repeat(300)];
      /** @type {import("../../auto.mjs").Check[]} */
      const refusals = [];
      for (const id of refused) {
        const outcome = await declareProcedure(ctx, declaration(id));
        const read = id === "" ? null : await stored(ctx, id);
        refusals.push(check(`"${id.slice(0, 30)}" (${id.length}) is refused and nothing is stored`, !outcome.ok && outcome.error.startsWith(refusal(id, "id: ")) && read === null, outcome.raw));
      }
      await ctx.verify("ids that are refused", refusals);
      const charset = await declareProcedure(ctx, declaration("a b"));
      const tooLong = await declareProcedure(ctx, declaration("x".repeat(121)));
      await ctx.verify("the refusal names the id rule", [same("charset", charset.error, refusal("a b", "id: letters, digits, '.', '_' and '-' only")), check("length", tooLong.error.includes("id: String must contain at most 120 character(s)"), tooLong.error)]);
      const dotted = "bakery.quote-follow-up";
      const invoked = await fixture(ctx, "InvokeProcedure", "POST", "/invoke", {
        id: dotted,
      });
      const ran = await fixture(ctx, "RunProcedure", "POST", "/run", {
        id: dotted,
      });
      const maximal = await fixture(ctx, "RunProcedure of the 120 character id", "POST", "/run", { id: "x".repeat(120) });
      await ctx.verify("the id is taken as is", [
        same("InvokeProcedure(id) resolves", pick(invoked.body, "ok"), true),
        same("RunProcedure(id) resolves ok", [pick(ran.body, "ok"), pick(ran.body, "result", "status")], [true, "ok"]),
        same("a 120 character id runs", [pick(maximal.body, "ok"), pick(maximal.body, "result", "status")], [true, "ok"]),
        same("the run is that procedure's", (await runsOfProcedure(ctx, dotted)).length, 2),
      ]);
    },
  },
  {
    id: "declare-procedure-validates-name-description-and-enabled",
    title: "DeclareProcedure names are 1 to 200 characters once trimmed, descriptions at most 2000, `enabled` is required, and the graph is required",
    entryPoint: "DeclareProcedure({ name, description, enabled, graph }), GET /procedures/:id",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {import("../../auto.mjs").Check[]} */
      const checks = [];
      const names = [
        { label: "1 character", name: "x", ok: true },
        { label: "trimmed", name: "  Padded é  ", ok: true, saved: "Padded é" },
        { label: "200 accents", name: "é".repeat(200), ok: true },
        {
          label: "200 after trimming",
          name: ` ${"日".repeat(200)} `,
          ok: true,
          saved: "日".repeat(200),
        },
        { label: "201", name: "n".repeat(201), ok: false },
        { label: "empty", name: "", ok: false },
        { label: "blanks only", name: " \t ", ok: false },
      ];
      let index = 0;
      for (const { label, name, ok, saved } of names) {
        index += 1;
        const id = `names.n${index}`;
        const outcome = await declareProcedure(ctx, declaration(id, { name }));
        const read = await stored(ctx, id);
        checks.push(ok ? same(`name ${label}: created with the trimmed name`, [outcome.result.status, read?.name], ["created", saved ?? name]) : check(`name ${label}: refused, nothing stored`, !outcome.ok && outcome.error.startsWith(refusal(id, "name: ")) && read === null, outcome.raw));
      }
      await ctx.verify("names", checks);
      /** @type {import("../../auto.mjs").Check[]} */
      const descriptions = [];
      const cases = [
        { label: "2000 characters", description: "d".repeat(2000), ok: true },
        {
          label: "2000 accents and CJK",
          description: "é日".repeat(1000),
          ok: true,
        },
        { label: "2001 characters", description: "d".repeat(2001), ok: false },
        { label: "empty", description: "", ok: true },
        { label: "left out", description: undefined, ok: true },
      ];
      index = 0;
      for (const { label, description, ok } of cases) {
        index += 1;
        const id = `descriptions.d${index}`;
        const fields = description === undefined ? {} : { description };
        const outcome = await declareProcedure(ctx, declaration(id, fields));
        const read = await stored(ctx, id);
        descriptions.push(ok ? same(`description ${label}`, [outcome.result.status, read?.description], ["created", description ?? ""]) : check(`description ${label}: refused, nothing stored`, !outcome.ok && outcome.error.startsWith(refusal(id, "description: ")) && read === null, outcome.raw));
      }
      await ctx.verify("descriptions", descriptions);
      const noEnabled = await declareProcedure(ctx, {
        id: "shape.no-enabled",
        name: "x",
        graph: logGraph("x"),
      });
      const stringEnabled = await declareProcedure(ctx, {
        id: "shape.string-enabled",
        name: "x",
        graph: logGraph("x"),
        enabled: "true",
      });
      const noGraph = await declareProcedure(ctx, {
        id: "shape.no-graph",
        name: "x",
        enabled: false,
      });
      const noName = await declareProcedure(ctx, {
        id: "shape.no-name",
        graph: logGraph("x"),
        enabled: false,
      });
      await ctx.verify("required fields", [
        same("enabled left out", noEnabled.error, refusal("shape.no-enabled", "enabled: Required")),
        check("enabled must be a boolean", !stringEnabled.ok && stringEnabled.error.startsWith(refusal("shape.string-enabled", "enabled: ")), stringEnabled.error),
        same("graph left out", noGraph.error, refusal("shape.no-graph", "graph: Required")),
        same("name left out", noName.error, refusal("shape.no-name", "name: Required")),
        same("none of them stored", await Promise.all(["shape.no-enabled", "shape.string-enabled", "shape.no-graph", "shape.no-name"].map((id) => stored(ctx, id))), [null, null, null, null]),
      ]);
      const both = await declareProcedure(ctx, {
        id: "bad id",
        name: "",
        graph: logGraph("x"),
        enabled: false,
      });
      await ctx.verify("every problem is named, separated by '; '", [same("the message", both.error, refusal("bad id", "name: String must contain at least 1 character(s); id: letters, digits, '.', '_' and '-' only"))]);
    },
  },
  {
    id: "declare-procedure-validates-the-graph-as-import-and-enabling-do",
    title: "DeclareProcedure validates the graph as Import JSON does, and an enabled declaration as enabling in the builder does: refused with every error and nothing stored, while a disabled declaration is stored as a draft with its problems",
    entryPoint: "DeclareProcedure({ graph, enabled }), GET /procedures/:id",
    async run(/** @type {Ctx} */ ctx) {
      const noTrigger = {
        nodes: [actionNode("log", "log.message", { message: "x" })],
        triggerEdges: [],
        dataEdges: [],
      };
      const enabledNoTrigger = await declareProcedure(ctx, declaration("graph.no-trigger-on", { graph: noTrigger, enabled: true }));
      const draftNoTrigger = await declareProcedure(
        ctx,
        declaration("graph.no-trigger-off", {
          graph: noTrigger,
          enabled: false,
        }),
      );
      await ctx.verify("no trigger", [
        same("enabled is refused", enabledNoTrigger.error, refusal("graph.no-trigger-on", "a procedure needs a trigger before it can be enabled")),
        same("nothing stored for the refusal", await stored(ctx, "graph.no-trigger-on"), null),
        same("disabled is stored as a draft", [draftNoTrigger.result.status, draftNoTrigger.result.enabled], ["created", false]),
        same("the draft exists", (await stored(ctx, "graph.no-trigger-off"))?.enabled, false),
      ]);
      const missing = chainGraph([triggerNode("t"), actionNode("req", "http.request", {})]);
      const enabledMissing = await declareProcedure(ctx, declaration("graph.missing-on", { graph: missing, enabled: true }));
      const draftMissing = await declareProcedure(ctx, declaration("graph.missing-off", { graph: missing, enabled: false }));
      await ctx.verify("a step missing its settings", [
        check("enabled is refused naming the problem", !enabledMissing.ok && enabledMissing.error.startsWith(refusal("graph.missing-on", "")) && /URL/.test(enabledMissing.error), enabledMissing.error),
        same("nothing stored for the refusal", await stored(ctx, "graph.missing-on"), null),
        same("disabled is created", draftMissing.result.status, "created"),
        same(
          "the draft's issue is a warning naming the node and the field",
          list(draftMissing.result, "issues").map((issue) => [issue.severity, issue.code, issue.nodeId, pick(issue, "params", "field")]),
          [["warning", "missingField", "req", "url"]],
        ),
      ]);
      const group = {
        nodes: [
          triggerNode("t"),
          {
            id: "g",
            kind: "group",
            templateId: "no-such-template",
            config: {},
            position: { x: 0, y: 0 },
            ports: [{ name: "in", kind: "trigger", direction: "in" }],
          },
        ],
        triggerEdges: [{ id: "e", from: { node: "t" }, to: { node: "g" } }],
        dataEdges: [],
      };
      const enabledTemplate = await declareProcedure(ctx, declaration("graph.template-on", { graph: group, enabled: true }));
      const draftTemplate = await declareProcedure(ctx, declaration("graph.template-off", { graph: group, enabled: false }));
      await ctx.verify("an unknown template", [
        same("enabled is refused", enabledTemplate.error, refusal("graph.template-on", 'template "no-such-template" not found')),
        same("disabled is a draft with the problem", [draftTemplate.result.status, list(draftTemplate.result, "issues").map((issue) => [issue.code, issue.message])], ["created", [["unknownTemplate", 'template "no-such-template" not found']]]),
      ]);
      const twoErrors = chainGraph([triggerNode("t"), actionNode("a", "http.request", {}), actionNode("b", "http.request", {})]);
      const refusedTwice = await declareProcedure(ctx, declaration("graph.two-errors", { graph: twoErrors, enabled: true }));
      await ctx.verify("every problem is listed, separated by '; '", [check("two messages", refusedTwice.error.startsWith(refusal("graph.two-errors", "")) && refusedTwice.error.split("; ").length === 2, refusedTwice.error)]);
      const hook = (path) => ({
        nodes: [triggerNode("w", "webhook", { path, method: "POST" }), actionNode("l", "log.message", { message: "hook" })],
        triggerEdges: [{ id: "e", from: { node: "w" }, to: { node: "l" } }],
        dataEdges: [],
      });
      const route = `/verify/${ctx.unique("hook").replace(/\W+/g, "-")}`;
      const owner = await declareProcedure(ctx, declaration("hooks.owner", { graph: hook(route), enabled: true }));
      const rival = await declareProcedure(ctx, declaration("hooks.rival-on", { graph: hook(route), enabled: true }));
      const draftRival = await declareProcedure(ctx, declaration("hooks.rival-off", { graph: hook(route), enabled: false }));
      await ctx.verify("a webhook route another enabled procedure answers on", [
        same("the first declaration is created enabled", [owner.result.status, owner.result.enabled], ["created", true]),
        check("the enabled rival is refused", !rival.ok && rival.error.startsWith(refusal("hooks.rival-on", "")) && rival.error.includes(`POST ${route}`), rival.error),
        same("nothing stored for the rival", await stored(ctx, "hooks.rival-on"), null),
        same("the disabled rival is a draft with a warning", [draftRival.result.status, list(draftRival.result, "issues").map((issue) => [issue.severity, issue.code])], ["created", [["warning", "webhookPathTaken"]]]),
      ]);
    },
  },
];
