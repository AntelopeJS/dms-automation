import { auto, check, parseJson, pick, same, text } from "../../auto.mjs";
import { action, clearLedger, data, dedge, graph, ledger, tedge, trigger } from "../../procs.mjs";
import { openPage, textWhen } from "./runs-common.mjs";
import { callWebhook, enabledProcedure, runsUntil } from "./triggers-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const TOKEN = "Bearer hook-secret-4242";
const SIGNATURE = "sig-hook-secret-9876";
const API_KEY = "k-hook-7";

export const webhookRedactionJourneys = [
  {
    id: "a-webhook-call-is-stored-with-its-credentials-redacted",
    title: "a call to a webhook stores its credential headers and query parameters as [redacted], keeps the other values, hands the run the full values, and the trace's Payload tab shows only the redacted ones",
    entryPoint: "POST /webhooks/..., GET /runs/:id, GET /procedures/:id/last-payload, /modules/automation/trace?run=",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await enabledProcedure(ctx, {
        name: ctx.unique("Hook redact"),
        graph: graph(
          [trigger("t", "webhook", { path: "/webhooks/redact-hook", method: "POST" }), data("pick", "object.get", { path: "authorization" }), action("eff", "verify.effect")],
          [tedge("t", "eff")],
          [dedge("t", "headers", "pick", "obj"), dedge("pick", "result", "eff", "label")],
        ),
      });
      await clearLedger(ctx);
      const call = await callWebhook(ctx, "call the webhook with credentials", {
        path: `/webhooks/redact-hook?sig=${SIGNATURE}&page=2`,
        headers: { "content-type": "application/json", authorization: TOKEN, "x-api-key": API_KEY, "x-trace-id": "trace-n-7" },
        body: JSON.stringify({ order: "Zoë-7" }),
      });
      const [row] = await runsUntil(ctx, id, 1);
      const runId = text(row, "_id");
      const run = (await auto(ctx, "the stored run", "GET", `/runs/${runId}`)).body;
      const payload = parseJson(text(run, "triggerPayload"));
      const last = await auto(ctx, "the last payload", "GET", `/procedures/${id}/last-payload`);
      await ctx.verify("the stored call", [
        same("the call is answered 200", call.status, 200),
        same("credential headers are stored redacted", [pick(payload, "headers", "authorization"), pick(payload, "headers", "x-api-key")], ["[redacted]", "[redacted]"]),
        same("other headers are kept", pick(payload, "headers", "x-trace-id"), "trace-n-7"),
        same("a credential query parameter is redacted and the others kept", pick(payload, "query"), { sig: "[redacted]", page: "2" }),
        same("the body is kept", pick(payload, "body"), { order: "Zoë-7" }),
        same("the run received the full value", (await ledger(ctx)).entries.filter((entry) => entry.kind === "execute").map((entry) => entry.label), [TOKEN]),
        same("the last payload a test would use is the redacted one", pick(last.body, "last", "payload", "headers", "authorization"), "[redacted]"),
        check("no stored field holds a credential", ![TOKEN, SIGNATURE, API_KEY].some((secret) => JSON.stringify(run).includes(secret)), JSON.stringify(run).slice(0, 400)),
      ]);
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${runId}`, /Payload/);
      await tab.page.getByRole("tab", { name: /^Payload/ }).click();
      const shown = await textWhen(tab, /\[redacted\]/);
      await ctx.verify("the trace's Payload tab", [
        check("shows the credentials as [redacted]", /authorization[\s\S]*\[redacted\]/.test(shown), shown.slice(-600)),
        check("never shows a credential", ![TOKEN, SIGNATURE, API_KEY].some((secret) => shown.includes(secret)), shown.slice(-600)),
        check("shows the kept values", shown.includes("trace-n-7") && shown.includes("Zoë-7"), shown.slice(-600)),
      ]);
    },
  },
];
