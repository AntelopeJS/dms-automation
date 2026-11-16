import { pick, same, text } from "../../auto.mjs";
import { createProcedure, logsOf, runNow, runOf } from "../../procs.mjs";
import { actionNode, chainGraph, defineType, invokeProcedure, runProcedure, stepOf, triggerNode, unregisterType, valueOf } from "./interface-calls.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * Data nodes apply their `default` under configured and wired values.
 *
 * @param {Ctx} ctx The journey
 */
async function checkDataNodeDefaults(ctx) {
  const dataGraph = {
    nodes: [
      triggerNode("t"),
      actionNode("e1", "verify.echo"),
      actionNode("e2", "verify.echo"),
      actionNode("e3", "verify.echo"),
      actionNode("e4", "verify.echo"),
      {
        id: "u1",
        kind: "data",
        typeId: "verify.upper",
        config: {},
        position: { x: 0, y: 100 },
      },
      {
        id: "u2",
        kind: "data",
        typeId: "verify.upper",
        config: { text: "été 日本" },
        position: { x: 0, y: 100 },
      },
      {
        id: "u3",
        kind: "data",
        typeId: "verify.upper",
        config: { text: "configured" },
        position: { x: 0, y: 100 },
      },
      {
        id: "c3",
        kind: "data",
        typeId: "const.string",
        config: { value: "wired ß" },
        position: { x: 0, y: 100 },
      },
      {
        id: "s4",
        kind: "data",
        typeId: "verify.suffix",
        config: { suffix: "!" },
        position: { x: 0, y: 100 },
      },
      {
        id: "c4",
        kind: "data",
        typeId: "const.string",
        config: { value: "base" },
        position: { x: 0, y: 100 },
      },
    ],
    triggerEdges: [
      { id: "t1", from: { node: "t" }, to: { node: "e1" } },
      { id: "t2", from: { node: "e1" }, to: { node: "e2" } },
      { id: "t3", from: { node: "e2" }, to: { node: "e3" } },
      { id: "t4", from: { node: "e3" }, to: { node: "e4" } },
    ],
    dataEdges: [
      {
        id: "d1",
        from: { node: "u1", port: "text" },
        to: { node: "e1", field: "value" },
      },
      {
        id: "d2",
        from: { node: "u2", port: "text" },
        to: { node: "e2", field: "value" },
      },
      {
        id: "d3a",
        from: { node: "c3", port: "value" },
        to: { node: "u3", field: "text" },
      },
      {
        id: "d3",
        from: { node: "u3", port: "text" },
        to: { node: "e3", field: "value" },
      },
      {
        id: "d4a",
        from: { node: "c4", port: "value" },
        to: { node: "s4", field: "text" },
      },
      {
        id: "d4",
        from: { node: "s4", port: "text" },
        to: { node: "e4", field: "value" },
      },
    ],
  };
  const dataId = await createProcedure(ctx, { graph: dataGraph });
  const dataRun = await runOf(ctx, (await runNow(ctx, dataId)).runId);
  /** @param {string} node */
  const echoed = (node) => valueOf(pick(stepOf(dataRun, node).output, "value"));
  await ctx.verify("a data node's defaults and configured values", [
    same("the default applies with nothing configured or wired", echoed("e1"), "FALLBACK"),
    same("the configured value replaces the default", echoed("e2"), "ÉTÉ 日本"),
    same("a wired value replaces the configured one", echoed("e3"), "WIRED SS"),
    same("the config field is merged into the evaluation input and the wired port stays an input", echoed("e4"), "base!"),
  ]);
}

export const moreTypeJourneys = [
  {
    id: "a-type-unregistered-during-a-run-fails-its-step",
    title: "a step fails, and the run with it, when its type is unregistered after the run started",
    entryPoint: "UnregisterActionType during RunProcedure, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const stamp = Date.now().toString(36);
      const late = `verify.vanishing-${stamp}`;
      await defineType(ctx, {
        kind: "action",
        id: late,
        name: "Vanishing",
        output: {},
      });
      const id = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("t"), actionNode("wait", "verify.sleep", { ms: 1500, key: "vanish" }), actionNode("late", late)],
          triggerEdges: [
            { id: "e1", from: { node: "t" }, to: { node: "wait" } },
            { id: "e2", from: { node: "wait" }, to: { node: "late" } },
          ],
          dataEdges: [],
        },
      });
      const running = runProcedure(ctx, id);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await unregisterType(ctx, "action", late);
      const outcome = await running;
      const run = await runOf(ctx, text(outcome.result, "runId"));
      await ctx.verify("the run", [
        same("how it ended", outcome.result.status, "failed"),
        same("the outcome's errorMessage", outcome.result.errorMessage, `action node "late" references unknown type "${late}"`),
        same("the step before it succeeded", stepOf(run, "wait").status, "ok"),
        same("the failed step", [stepOf(run, "late").status, pick(run, "failedStep") !== null], ["failed", true]),
      ]);
    },
  },
  {
    id: "schema-defaults-apply-under-configured-values",
    title: "the runtime applies each property's `default` under the node's configured values, for actions and data nodes, falsy defaults included",
    entryPoint: "RegisterActionType inputSchema default, RegisterDataNodeType default, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const stamp = Date.now().toString(36);
      const type = `verify.defaults-${stamp}`;
      await defineType(ctx, {
        kind: "action",
        id: type,
        name: "Defaults",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", default: "dflt é" },
            n: { type: "number", default: 0 },
            flag: { type: "boolean", default: false },
            empty: { type: "string", default: "" },
            none: { default: null },
            obj: { default: { k: "日本" } },
            list: { default: [1, 2] },
            kept: { type: "string", default: "overridden" },
          },
        },
      });
      const id = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("t"), actionNode("a", type, { kept: "configured", n: 9 })],
          triggerEdges: [{ id: "e", from: { node: "t" }, to: { node: "a" } }],
          dataEdges: [],
        },
      });
      const run = await runOf(ctx, (await runNow(ctx, id)).runId);
      const step = stepOf(run, "a");
      await ctx.verify("an action's defaults", [
        same("the step's output is its input, defaults under the configured values", valueOf(step.output), {
          text: "dflt é",
          n: 9,
          flag: false,
          empty: "",
          none: null,
          obj: { k: "日本" },
          list: [1, 2],
          kept: "configured",
        }),
        same("the trace's inputs show the default string", valueOf(pick(step, "inputs", "text")), "dflt é"),
        same("the trace's inputs show the false default", valueOf(pick(step, "inputs", "flag")), false),
      ]);
      await checkDataNodeDefaults(ctx);
    },
  },
  {
    id: "json-values-reach-the-run-unchanged",
    title: "a trigger payload, an action output, a data node output and a ctx.log value are JSON: accents, CJK, emoji, nested arrays, null and false arrive unchanged",
    entryPoint: "InvokeProcedure(id, payload), RunProcedure(id, { payload }), ctx.log(level, message, value), GET /runs/:id, GET /runs/:id/logs",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, {
        graph: chainGraph([
          triggerNode("t"),
          actionNode("echo", "verify.echo"),
          actionNode("lg", "verify.log-levels", { message: "été 日本 😀" }),
          actionNode("sec", "log.message", {
            message: "secret note",
            value: { plain: "s3cr3t-é" },
          }),
        ]),
      });
      const payloads = [
        {
          name: "unicode object",
          payload: {
            "clé é": "日本語 😀",
            nested: {
              list: [1, [2, { x: null }], "ü"],
              t: true,
              f: false,
              zero: 0,
              empty: "",
            },
          },
        },
        { name: "an array", payload: [1, "two", [3], { four: 4 }] },
        { name: "a string", payload: "plain é string" },
        { name: "a number", payload: 12.5 },
        { name: "false", payload: false },
        { name: "null", payload: null },
      ];
      for (const { name, payload } of payloads) {
        const invoked = await invokeProcedure(ctx, id, payload);
        const run = await runOf(ctx, text(invoked.result, "runId"));
        const ran = await runProcedure(ctx, id, { payload });
        const second = await runOf(ctx, text(ran.result, "runId"));
        await ctx.verify(`payload ${name}`, [
          same("InvokeProcedure: the trigger step's output", valueOf(stepOf(run, "t").output), payload),
          same("InvokeProcedure: the stored payload", run.triggerPayload, JSON.stringify(payload)),
          same("RunProcedure: the trigger step's output", valueOf(stepOf(second, "t").output), payload),
          same("RunProcedure: the stored payload", second.triggerPayload, JSON.stringify(payload)),
          same("both runs ended ok", [run.status, second.status], ["ok", "ok"]),
        ]);
      }
      const ran = await runProcedure(ctx, id, {
        payload: { value: { é: [1, null, "日本"] } },
      });
      const run = await runOf(ctx, text(ran.result, "runId"));
      const entries = await logsOf(ctx, text(ran.result, "runId"));
      const mine = entries.filter((entry) => entry.nodeId === "lg");
      await ctx.verify("ctx.log entries", [
        same("an action's output is a JSON object", valueOf(stepOf(run, "echo").output), { value: null, n: null }),
        same(
          "each ctx.log level, in order, tagged with the node",
          mine.filter((entry) => entry.source !== "exec").map((entry) => [entry.level, entry.message, entry.nodeKind]),
          [
            ["info", "info été 日本 😀", "action"],
            ["warn", "warn été 日本 😀", "action"],
            ["error", "error été 日本 😀", "action"],
          ],
        ),
        same("a value logged is stored as logged, a secret included", entries.find((entry) => entry.nodeId === "sec" && entry.message === "secret note")?.value, { plain: "s3cr3t-é" }),
        same(
          "the structured values",
          mine.filter((entry) => entry.source !== "exec").map((entry) => entry.value),
          [{ level: "info", list: [1, 2, 3] }, "text value", undefined],
        ),
      ]);
    },
  },
];
