import { auto, check, list, pick, same } from "../../auto.mjs";
import { action, clearLedger, createEnabled, data, dedge, graph, ledger, runNow, tedge, trigger } from "../../procs.mjs";
import { storedRun } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @type {[string, string][]} */
const COPIES = [
  ["x-copy-whole", "Bearer abc123xyz9"],
  ["x-copy-token", "abc123xyz9"],
  ["x-copy-cookie-value", "cookieval-77"],
  ["x-copy-short-cookie-value", "dark"],
  ["x-copy-five", "12345"],
  ["x-copy-six", "123456"],
];

export const scrubJourneys = [
  {
    id: "a-credential-a-step-copied-into-its-log-is-not-stored",
    title: "a credential the trigger received is not stored in the inputs, output or messages of the steps that copied it: the whole value, its token after the scheme, and the values of a cookie are replaced by [redacted], while a value shorter than 6 characters is too common to tell from other text",
    entryPoint: "GET /runs/:id/logs, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const nodes = [trigger("t"), action("eff", "verify.effect")];
      const triggerEdges = [tedge("t", "eff")];
      const dataEdges = [dedge("t", "headers", "pickfirst", "obj"), dedge("pickfirst", "result", "eff", "label")];
      nodes.push(data("pickfirst", "object.get", { path: "x-copy-token" }));
      let previous = "eff";
      COPIES.forEach(([name], index) => {
        nodes.push(data(`pick${index}`, "object.get", { path: name }), action(`log${index}`, "log.message"));
        triggerEdges.push(tedge(previous, `log${index}`));
        dataEdges.push(dedge("t", "headers", `pick${index}`, "obj"), dedge(`pick${index}`, "result", `log${index}`, "message"));
        previous = `log${index}`;
      });
      const { id } = await createEnabled(ctx, { name: ctx.unique("Scrub"), graph: graph(nodes, triggerEdges, dataEdges) });
      const headers = { Authorization: "Bearer abc123xyz9", Cookie: "sid=cookieval-77; theme=dark", "x-pin-token": "12345", "x-long-token": "123456", ...Object.fromEntries(COPIES) };
      await clearLedger(ctx);
      const ran = await runNow(ctx, id, { headers });
      const logs = (await auto(ctx, "logs", "GET", `/runs/${ran.runId}/logs`)).body;
      const run = (await auto(ctx, "run", "GET", `/runs/${ran.runId}`)).body;
      const stored = await storedRun(ctx, ran.runId);
      const messages = list(logs, "entries").filter((entry) => entry.source === "log").map((entry) => entry.message);
      const inputs = COPIES.map((_, index) => pick(list(run, "trace", "steps").find((step) => step.nodeId === `log${index}`), "inputs", "message", "value"));
      await ctx.verify("the stored log", [
        same("the messages: the credential in each form replaced, short values kept", messages, ["[redacted]", "[redacted]", "[redacted]", "dark", "12345", "[redacted]"]),
        same("the trace inputs of the same steps", inputs, ["[redacted]", "[redacted]", "[redacted]", "dark", "12345", "[redacted]"]),
        check("the stored document holds none of the credentials", !JSON.stringify(pick(stored, "logs")).includes("abc123xyz9") && !JSON.stringify(pick(stored, "logs")).includes("cookieval-77"), "logs"),
        same("the run itself got the full value", (await ledger(ctx)).entries.filter((e) => e.kind === "execute").map((e) => e.label), ["abc123xyz9"]),
      ]);
    },
  },
];
