import { auto, list, pick, same, text } from "../../auto.mjs";
import { eventually, openBuilder, pathOf, procedureOf, selectNode } from "./builder-kit.mjs";
import { callWebhook, payloadRow, runDetail, runsUntil } from "./triggers-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const PATH = "/webhooks/commande-recue";

export const webhookBuilderJourneys = [
  {
    id: "a-webhook-set-up-in-the-builder-answers-once-it-is-saved-enabled",
    tag: "@smoke",
    title: "a procedure created with A webhook is called gets its Path in the builder's inspector, which shows the URL to call; the path answers nothing until the procedure is saved with the Enabled switch on, then a call starts a run with the request as payload, listed under Recent runs",
    entryPoint: "POST /procedures/new, /modules/automation/builder, inspector Path, Enabled, Save, POST /webhooks/...",
    async run(/** @type {Ctx} */ ctx) {
      const created = await auto(ctx, "new procedure started by a webhook", "POST", "/procedures/new", { body: { name: "Commande reçue", trigger: "webhook" } });
      const id = text(created.body, "_id");
      const hook = list(await procedureOf(ctx, id), "graph", "nodes").find((node) => node.typeId === "webhook");
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await selectNode(tab, text(hook, "id"));
      await tab.click({ role: "button", name: "Log", exact: true });
      await tab.fill({ role: "textbox", name: "Message" }, "commande reçue");
      await selectNode(tab, text(hook, "id"));
      await tab.fill({ role: "textbox", name: "Path" }, PATH);
      await ctx.verify("the inspector shows the URL to call", [tab.shows(new RegExp(`POST\\s+\\S*${PATH}`)), tab.shows(/Call this URL to start the procedure\./)]);
      const unsaved = await callWebhook(ctx, "call before saving", { path: PATH, headers: { "content-type": "application/json" }, body: "{}" });
      await ctx.verify("an unsaved path answers nothing", [same("the call is not served", unsaved.status, 404)]);
      await tab.click({ role: "switch", name: "Disabled" });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const saved = await eventually(() => procedureOf(ctx, id), (p) => p.enabled === true);
      await ctx.verify("Save stores it enabled", [
        same("enabled", saved.enabled, true),
        same("the webhook's path and method", pick(list(saved, "graph", "nodes").find((node) => node.typeId === "webhook"), "config"), { path: PATH, method: "POST" }),
        same("the steps", pathOf(saved), ["trigger/webhook", "action/log.message"]),
      ]);
      const call = await callWebhook(ctx, "call the webhook", { path: `${PATH}?source=builder`, headers: { "content-type": "application/json" }, body: JSON.stringify({ numero: 42, client: "Zoë" }) });
      const [row] = await runsUntil(ctx, id, 1);
      const run = await runDetail(ctx, text(row, "_id"));
      const payload = payloadRow(run);
      await ctx.verify("the call starts a run", [
        same("the call is answered", [call.status, call.json], [200, { ok: true }]),
        same("one run, succeeded", [pick(run, "kind"), pick(run, "status")], ["run", "ok"]),
        same("the request is the payload", [payload.method, payload.query, payload.body], ["POST", { source: "builder" }, { numero: 42, client: "Zoë" }]),
      ]);
      await openBuilder(ctx, `?selected=${id}`, { tab });
      await tab.click({ role: "tab", name: "Recent runs" });
      await ctx.verify("Recent runs lists it", [tab.visible({ role: "button", name: /^Succeeded \d+ m?s / }), tab.visible({ role: "link", name: "All runs of this procedure" })]);
    },
  },
];
