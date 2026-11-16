import { auto, fixture, list, parseJson, pick, same, text } from "../../auto.mjs";
import { clearLedger, ledger, runOf, runsOfProcedure, until } from "../../procs.mjs";
import { actionNode, chainGraph, declareProcedure, defineType, logGraph, stepOf, triggerNode, valueOf } from "./interface-calls.mjs";
import { declaration, stored } from "./interface-declare-shared.mjs";
import { byText } from "./package-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * A declared procedure whose trigger, action and data node types are not registered yet: declaring never blocks, and the trigger arms when its type registers.
 *
 * @param {Ctx} ctx The journey
 */
async function declareBeforeTypesExist(ctx) {
  const stamp = Date.now().toString(36);
  const lateTrigger = `verify.late-trigger-${stamp}`;
  const lateTopic = `late-${stamp}`;
  const lateGraph = {
    nodes: [
      triggerNode("lt", lateTrigger, { topic: lateTopic }),
      actionNode("la", `verify.late-action-${stamp}`, {}),
      {
        id: "ld",
        kind: "data",
        typeId: `verify.late-data-${stamp}`,
        config: {},
        position: { x: 0, y: 100 },
      },
    ],
    triggerEdges: [{ id: "e", from: { node: "lt" }, to: { node: "la" } }],
    dataEdges: [],
  };
  await clearLedger(ctx);
  const late = await declareProcedure(ctx, declaration("arm.late", { enabled: true, graph: lateGraph }));
  const early = await ledger(ctx);
  const listBefore = await auto(ctx, "the procedures", "GET", "/procedures");
  const errorsBefore = parseJson(
    text(
      list(listBefore.body, "results").find((row) => row._id === "arm.late"),
      "armErrors",
    ) || "{}",
  );
  await ctx.verify("unknown types never block", [
    same("created and enabled", [late.result.status, late.result.enabled], ["created", true]),
    same(
      "each unknown type is a warning",
      list(late.result, "issues")
        .map((issue) => [issue.severity, issue.code, issue.nodeId])
        .sort(byText),
      [
        ["warning", "unknownType", "la"],
        ["warning", "unknownType", "ld"],
        ["warning", "unknownType", "lt"],
      ].sort(byText),
    ),
    same(
      "the warnings name the type",
      list(late.result, "issues")
        .map((issue) => issue.message)
        .sort(byText),
      [`action node "la" references unknown type "verify.late-action-${stamp}"`, `data node "ld" references unknown type "verify.late-data-${stamp}"`, `trigger node "lt" references unknown type "${lateTrigger}"`].sort(byText),
    ),
    same("nothing was activated yet", early.entries.filter((entry) => entry.kind === "activate").length, 0),
    same("the trigger shows the arming error", pick(errorsBefore, "lt", "message"), `trigger type "${lateTrigger}" is not available`),
  ]);
  await defineType(ctx, {
    kind: "trigger",
    id: lateTrigger,
    name: "Late trigger",
    cluster: "replicated",
  });
  await defineType(ctx, {
    kind: "action",
    id: `verify.late-action-${stamp}`,
    name: "Late action",
    output: { arrived: "late" },
  });
  const armedLate = await until(
    async () => (await ledger(ctx)).entries.filter((entry) => entry.kind === "activate"),
    (entries) => entries.length >= 1,
  );
  const listAfter = await until(
    () => auto(ctx, "the procedures", "GET", "/procedures"),
    (answer) =>
      !text(
        list(answer.body, "results").find((row) => row._id === "arm.late"),
        "armErrors",
      ),
  );
  await ctx.verify("the trigger arms when its type registers", [
    same(
      "activated with its settings",
      armedLate.map((entry) => [entry.type, entry.topic]),
      [[lateTrigger, lateTopic]],
    ),
    same(
      "the arming error is gone",
      text(
        list(listAfter.body, "results").find((row) => row._id === "arm.late"),
        "armErrors",
      ),
      "",
    ),
  ]);
}

export const keepJourneys = [
  {
    id: "declare-procedure-creates-once-and-keeps-what-users-did",
    title: 'DeclareProcedure stores a procedure once under its id (version 1, the declared graph, name and description) and answers "kept" afterwards, whatever the declaration says; a user\'s edit, pause and deletion decide',
    entryPoint: "DeclareProcedure(declaration), GET /procedures/:id, PUT /procedures/:id, PUT /procedures/:id/enabled, DELETE /procedures/:id",
    async run(/** @type {Ctx} */ ctx) {
      const id = "bakery.follow-up";
      const graph = chainGraph([
        triggerNode("t"),
        actionNode("log", "log.message", {
          message: "Relance à 9h 日本 😀",
          level: "warn",
        }),
      ]);
      graph.nodes[1].position = { x: 361.5, y: 160 };
      const first = await declareProcedure(ctx, {
        id,
        name: "  Relance des devis  ",
        description: "Chaque matin — é",
        graph,
        enabled: false,
      });
      const created = await stored(ctx, id);
      await ctx.verify("created", [
        same("the result", [first.result.id, first.result.status, first.result.enabled, first.result.issues], [id, "created", false, []]),
        same("name trimmed, description kept", [pick(created, "name"), pick(created, "description")], ["Relance des devis", "Chaque matin — é"]),
        same("the graph as declared, positions included", pick(created, "graph"), graph),
        same("version 1, revision 1, disabled", [pick(created, "version"), pick(created, "revision"), pick(created, "enabled")], [1, 1, false]),
        same("the procedure's _id is the declared id", pick(created, "_id"), id),
      ]);
      const second = await declareProcedure(ctx, {
        id,
        name: "Another name",
        description: "Another",
        graph: logGraph("other"),
        enabled: true,
      });
      const unchanged = await stored(ctx, id);
      await ctx.verify("kept", [
        same("the result says kept and reports the stored state", [second.result.status, second.result.enabled], ["kept", false]),
        same("nothing changed", [pick(unchanged, "name"), pick(unchanged, "description"), pick(unchanged, "graph"), pick(unchanged, "version"), pick(unchanged, "revision"), pick(unchanged, "enabled")], [pick(created, "name"), pick(created, "description"), pick(created, "graph"), 1, 1, false]),
      ]);
      const edited = await auto(ctx, "a user renames and enables it", "PUT", `/procedures/${id}`, {
        body: {
          name: "Renamed by a user é",
          description: "user text",
          enabled: true,
          graph,
          expectedRevision: 1,
        },
      });
      await declareProcedure(ctx, declaration(id, { name: "Declared again", enabled: false }));
      const afterEdit = await stored(ctx, id);
      await ctx.verify("a user's edit stays", [same("the edit saved", edited.status, 200), same("name, description, enabled stay the user's", [pick(afterEdit, "name"), pick(afterEdit, "description"), pick(afterEdit, "enabled")], ["Renamed by a user é", "user text", true])]);
      await auto(ctx, "a user pauses it", "PUT", `/procedures/${id}/enabled`, {
        body: { enabled: false },
      });
      const keptPaused = await declareProcedure(ctx, declaration(id, { enabled: true }));
      await ctx.verify("a pause stays", [same("kept, still paused, the result reports the stored state", [keptPaused.result.status, keptPaused.result.enabled, pick(await stored(ctx, id), "enabled")], ["kept", false, false])]);
      const deleted = await auto(ctx, "a user deletes it", "DELETE", `/procedures/${id}`);
      const gone = await stored(ctx, id);
      const again = await declareProcedure(ctx, declaration(id, { name: "Back again" }));
      const back = await stored(ctx, id);
      await ctx.verify("a deletion is undone by the next call", [same("deleted", [deleted.status, gone], [200, null]), same("created again with the declaration", [again.result.status, pick(back, "name"), pick(back, "version")], ["created", "Back again", 1])]);
      const keptWithProblems = await declareProcedure(
        ctx,
        declaration(id, {
          graph: {
            nodes: [triggerNode("t"), actionNode("a", "no.such.action", {})],
            triggerEdges: [{ id: "e", from: { node: "t" }, to: { node: "a" } }],
            dataEdges: [],
          },
        }),
      );
      await ctx.verify("issues describe the submitted graph, even for a kept procedure", [same("kept with the issue", [keptWithProblems.result.status, list(keptWithProblems.result, "issues").map((issue) => [issue.severity, issue.code])], ["kept", [["warning", "unknownType"]]])]);
    },
  },
  {
    id: "declare-procedure-warns-about-a-duplicate-name-without-blocking",
    title: "another procedure with the same name adds a warning to issues and does not block the declaration",
    entryPoint: "DeclareProcedure({ name }), issues",
    async run(/** @type {Ctx} */ ctx) {
      const first = await declareProcedure(ctx, declaration("dup.one", { name: "Weekly report é" }));
      const same1 = await declareProcedure(ctx, declaration("dup.one", { name: "Weekly report é" }));
      const dup = await declareProcedure(ctx, declaration("dup.two", { name: "  WEEKLY REPORT É  " }));
      const enabledDup = await declareProcedure(
        ctx,
        declaration("dup.three", {
          name: "weekly report é",
          enabled: true,
          graph: logGraph("x"),
        }),
      );
      const other = await declareProcedure(ctx, declaration("dup.four", { name: "Weekly report" }));
      /** @param {Row} result */
      const warnings = (result) => list(result, "issues").map((issue) => [issue.severity, issue.code, issue.message, pick(issue, "params", "name")]);
      await ctx.verify("duplicate names", [
        same("the first has no issue", warnings(first.result), []),
        same("declaring the same procedure again has none (it does not clash with itself)", [same1.result.status, warnings(same1.result)], ["kept", []]),
        same("a case and blanks variant warns", warnings(dup.result), [["warning", "nameTaken", 'another procedure is already named "WEEKLY REPORT É"', "WEEKLY REPORT É"]]),
        same("the duplicate is created", dup.result.status, "created"),
        same("an enabled duplicate is created too", [enabledDup.result.status, enabledDup.result.enabled, warnings(enabledDup.result).map((w) => w[1])], ["created", true, ["nameTaken"]]),
        same("a different name does not warn", warnings(other.result), []),
      ]);
    },
  },
  {
    id: "an-enabled-declaration-arms-its-triggers-and-an-unknown-type-never-blocks",
    title: "an enabled declaration arms its eligible triggers at once; a trigger, action or data node type that is not registered yet never blocks it, and its trigger arms as soon as the type registers",
    entryPoint: "DeclareProcedure({ enabled: true }), RegisterTriggerType after the declaration, POST /verify-auto/emit",
    async run(/** @type {Ctx} */ ctx) {
      await clearLedger(ctx);
      const topic = ctx.unique("armed").replace(/\W+/g, "-");
      const armed = await declareProcedure(
        ctx,
        declaration("arm.now", {
          enabled: true,
          graph: chainGraph([triggerNode("ev", "verify.event", { topic }), actionNode("log", "log.message", { message: "fired" })]),
        }),
      );
      const afterDeclare = await ledger(ctx);
      await ctx.verify("armed before the call returned", [
        same("the result", [armed.result.status, armed.result.enabled, armed.result.issues], ["created", true, []]),
        same(
          "the trigger was activated with its settings",
          afterDeclare.entries.filter((entry) => entry.kind === "activate").map((entry) => [entry.type, entry.topic]),
          [["verify.event", topic]],
        ),
      ]);
      const draft = await declareProcedure(
        ctx,
        declaration("arm.draft", {
          enabled: false,
          graph: chainGraph([triggerNode("ev", "verify.event", { topic: `${topic}-draft` }), actionNode("log", "log.message", { message: "x" })]),
        }),
      );
      const afterDraft = await ledger(ctx);
      await ctx.verify("a disabled declaration arms nothing", [same("created as a draft", [draft.result.status, draft.result.enabled], ["created", false]), same("no new activation", afterDraft.entries.filter((entry) => entry.kind === "activate").length, 1)]);
      const emitted = await fixture(ctx, "emit", "POST", "/emit", {
        topic,
        payload: { topic, value: "é 日本" },
      });
      const runs = await until(
        () => runsOfProcedure(ctx, "arm.now"),
        (rows) => rows.length >= 1,
      );
      const run = await runOf(ctx, text(runs[0], "_id"));
      await ctx.verify("the armed trigger starts a run", [
        same("one handle fired", pick(emitted.body, "emitted"), 1),
        same("the run's payload", valueOf(stepOf(run, "ev").output), {
          topic,
          value: "é 日本",
        }),
        same("it is an ordinary run", [run.kind, run.status], ["run", "ok"]),
      ]);
      await declareBeforeTypesExist(ctx);
    },
  },
];
