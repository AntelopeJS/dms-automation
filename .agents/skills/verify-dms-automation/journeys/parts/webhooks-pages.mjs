import { auto, fixture, list, pick, same, text } from "../../auto.mjs";
import { runsOfProcedure, statusIs } from "../../procs.mjs";
import { callWebhook, enabledProcedure, saveGraph, storeEnabled, summaryOf, summaryUntil, webhookGraph } from "./triggers-common.mjs";
import { webhookBase, withApiBase } from "./webhooks-base.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */

export const pageJourneys = [
  {
    id: "a-webhook-the-server-cannot-arm-makes-its-procedure-failing-with-the-reason",
    title: "an enabled procedure whose webhook cannot be armed (an invalid path, a reserved path, a route the server already answers on) is Failing and its reason reads as the refusal does, while the server's own route keeps answering",
    entryPoint: "GET /procedures/summary, GET /stats/attention, GET /stats/health, /modules/automation/procedures",
    async run(/** @type {Ctx} */ ctx) {
      const invalid = await storeEnabled(ctx, "Stored invalid path", webhookGraph("/a b"));
      const reserved = await storeEnabled(ctx, "Stored reserved path", webhookGraph("/api/stored"));
      const served = await storeEnabled(ctx, "Stored served route", webhookGraph("/verify-auto/emit"));
      const fine = await storeEnabled(ctx, "Stored fine", webhookGraph("/webhooks/stored/fine"));
      await ctx.restartBackend();
      /** @type {Record<string, import("../../auto.mjs").Row>} */
      const rows = {};
      for (const [name, id] of [["invalid", invalid], ["reserved", reserved], ["served", served], ["fine", fine]]) rows[name] = await summaryUntil(ctx, id, (row) => row.status !== undefined && (name === "fine" || row.status === "failing"));
      await ctx.verify("the reasons", [
        same("invalid path is failing", rows.invalid.status, "failing"),
        same("invalid path reason", rows.invalid.lastError, 'webhook path must start with "/" and use only letters, digits and - . _ ~ : / (got "/a b")'),
        same("reserved path is failing", rows.reserved.status, "failing"),
        same("reserved path reason", rows.reserved.lastError, "webhook path /api/stored is reserved for the API"),
        same("served route is failing", rows.served.status, "failing"),
        same("served route reason", rows.served.lastError, "POST /verify-auto/emit already answers for another route of the server"),
        same("the other webhook is not failing", rows.fine.status, "healthy"),
        same("the reason is worded for the pages", rows.reserved.statusDetail, { key: "dms_automation.procedures.detail.triggerError", params: { error: { key: "dms_automation.editor.problems.codes.webhookPathReserved", params: { path: "/api/stored" } } } }),
        same("there is no run for any of them", [(await runsOfProcedure(ctx, invalid)).length, (await runsOfProcedure(ctx, reserved)).length, (await runsOfProcedure(ctx, served)).length], [0, 0, 0]),
      ]);
      const attention = list((await auto(ctx, "needs attention", "GET", "/stats/attention")).body, "items");
      const health = (await auto(ctx, "health", "GET", "/stats/health")).body;
      await ctx.verify("needs attention and the health banner", [
        same("the three failing procedures need attention", attention.map((item) => text(item, "name")).sort(), ["Stored invalid path", "Stored reserved path", "Stored served route"]),
        same("each carries its arm error code", attention.map((item) => text(item, "armError", "code")).sort(), ["webhookPathInvalid", "webhookPathReserved", "webhookRouteTaken"]),
        same("the banner counts them", pick(health, "title", "params", "count", "value"), 3),
        same("the banner offers the list, no failed run to open", list(health, "actions").map((entry) => text(entry, "label")), ["$dms_automation.health.showFailingProcedures"]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/procedures");
      await ctx.verify("the Procedures page shows each reason under Failing", [
        await tab.shows(/Stored invalid path\s+Failing\s+Trigger not armed: The webhook path must start with \/ and use only letters, digits and - \. _ ~ : \//),
        await tab.shows(/Stored reserved path\s+Failing\s+Trigger not armed: The path \/api\/stored is reserved for the API: choose one under \/webhooks\//),
        await tab.shows(/Stored served route\s+Failing\s+Trigger not armed: POST \/verify-auto\/emit is already used by another route of the server: choose a path under \/webhooks\//),
        await tab.shows(/Stored fine\s+Healthy/),
      ]);
      await tab.goto("/modules/automation/overview");
      await ctx.verify("the Overview gives the reason in its banner and in Needs attention", [
        await tab.shows(/3 procedures failing/),
        await tab.shows(/and 2 more · failing since — · Trigger not armed: /),
        await tab.shows(/Needs attention/i),
        await tab.shows(/Stored invalid path\s+Failing\s+Trigger not armed: The webhook path must start with/),
        await tab.shows(/Stored reserved path\s+Failing\s+Trigger not armed: The path \/api\/stored is reserved for the API: choose one under \/webhooks\//),
        await tab.shows(/Open last failure/, { not: true, timeoutMs: 2000 }),
      ]);
      const emitted = await fixture(ctx, "the served route still answers", "POST", "/emit", { topic: "nobody", payload: 1 });
      await ctx.verify("the webhook did not shadow the server's route", [same("the fixture route answers", pick(emitted.body, "emitted"), 0)]);

      const fixed = await saveGraph(ctx, reserved, webhookGraph("/webhooks/stored/fixed"), { enabled: true });
      const recovered = await summaryUntil(ctx, reserved, (row) => row.status !== "failing");
      const answer = await callWebhook(ctx, "call the corrected webhook", { path: "/webhooks/stored/fixed", headers: { "content-type": "application/json" }, body: "{}" });
      await ctx.verify("correcting the path arms it", [statusIs(fixed, 200, "saving answers 200"), same("no longer failing", recovered.status, "healthy"), same("no trigger error left", recovered.lastError, null), same("the webhook answers", answer.status, 200)]);
      const pause = await auto(ctx, "pause the invalid one", "PUT", `/procedures/${invalid}/enabled`, { body: { enabled: false } });
      const paused = await summaryOf(ctx, invalid);
      await ctx.verify("pausing a procedure whose trigger could not arm clears the reason", [statusIs(pause, 200, "pausing answers 200"), same("its state", paused.status, "paused"), same("no trigger error", paused.lastError, null)]);
    },
  },
  {
    id: "the-webhook-url-is-built-on-the-api-base-url",
    title: "the Library and the Builder show each webhook's full URL on the DMS apiBaseUrl: a public URL as set (without trailing slashes), a loopback one such as the default as it is with a hint to set apiBaseUrl, and an empty one falls back to the origin the dashboard reached the API on",
    entryPoint: "GET /library/webhook-base, /modules/automation/library, /modules/automation/builder",
    async run(/** @type {Ctx} */ ctx) {
      const id = (await enabledProcedure(ctx, { name: ctx.unique("Url"), graph: webhookGraph("/webhooks/url/x", "POST") })).id;
      const getId = (await enabledProcedure(ctx, { name: ctx.unique("Url get"), graph: webhookGraph("/webhooks/url/get", "GET") })).id;
      const delId = (await enabledProcedure(ctx, { name: ctx.unique("Url delete"), graph: webhookGraph("/webhooks/url/del", "DELETE") })).id;
      const apiOrigin = new URL(String(ctx.state.apiUrl)).origin;
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      /** @type {[string, { url: string, configured: boolean }][]} */
      const settings = [
        ["https://hooks.example.com/", { url: "https://hooks.example.com", configured: true }],
        ["https://hooks.example.com/base///", { url: "https://hooks.example.com/base", configured: true }],
        ["empty", { url: apiOrigin, configured: false }],
        ["default", { url: "http://127.0.0.1:5010", configured: false }],
      ];
      /** @type {Check[]} */
      const seen = [];
      /** @type {Check[]} */
      const pages = [];
      const escape = (/** @type {string} */ value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const inspect = async (/** @type {string} */ procedure, /** @type {string} */ node, /** @type {string} */ curl) => {
        await tab.goto(`/modules/automation/builder?selected=${procedure}`);
        let shown = await tab.shows(new RegExp(escape(curl)), { timeoutMs: 1500 });
        for (let attempt = 0; attempt < 6 && !shown.pass; attempt += 1) {
          await tab.click({ role: "group", name: node });
          shown = await tab.shows(new RegExp(escape(curl)), { timeoutMs: 4000 });
        }
        return shown;
      };
      await withApiBase(ctx, settings.map(([setting]) => setting), async (setting) => {
        const expected = settings.find(([candidate]) => candidate === setting)?.[1] ?? { url: "", configured: false };
        const base = await webhookBase(ctx);
        seen.push(same(`webhook base for ${setting}`, { url: base.url, configured: base.configured }, expected));
        pages.push(await inspect(id, "Webhook, POST /webhooks/url/x", `curl -X POST '${expected.url}/webhooks/url/x'`));
        pages.push(await tab.shows(new RegExp(`POST\\s+${escape(expected.url)}/webhooks/url/x`)));
        pages.push(await tab.shows(/Call this URL to start the procedure\./));
        pages.push(await tab.shows(/set apiBaseUrl in the DMS configuration/, { not: expected.configured, timeoutMs: expected.configured ? 3000 : 15_000 }));
        if (setting === settings[0]?.[0]) {
          pages.push(await inspect(getId, "Webhook, GET /webhooks/url/get", `curl '${expected.url}/webhooks/url/get'`));
          pages.push(await inspect(delId, "Webhook, DELETE /webhooks/url/del", `curl -X DELETE '${expected.url}/webhooks/url/del'`));
        }
      });
      await ctx.verify("the base the API reports", seen);
      await ctx.verify("what the builder's inspector shows", pages);
      await withApiBase(ctx, ["https://hooks.example.com/"], async () => {
        await tab.goto("/modules/automation/library?tab=triggers");
        await tab.click({ role: "button", name: "Webhook Registers an HTTP endpoint" });
        await ctx.verify("the Library lists each use with its full URL", [
          await tab.shows(/POST\s+https:\/\/hooks\.example\.com\/webhooks\/url\/x/, { timeoutMs: 20_000 }),
          await tab.shows(/GET\s+https:\/\/hooks\.example\.com\/webhooks\/url\/get/),
          await tab.shows(/DELETE\s+https:\/\/hooks\.example\.com\/webhooks\/url\/del/),
        ]);
      });
    },
  },
  {
    id: "the-webhook-recipe-places-a-path-from-the-procedure-name",
    title: "New procedure with a webhook creates a disabled draft whose webhook is POST /webhooks/<name>, the procedure name in lower case with dashes (accents dropped), moved to a free path when that is taken, and the Procedures page words it as METHOD /path under the type",
    entryPoint: "POST /procedures/new, GET /procedures/:id, /modules/automation/procedures",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {[string, string][]} */
      const names = [
        ["Forward a webhook", "/webhooks/forward-a-webhook"],
        ["Mon Procédure Café", "/webhooks/mon-procedure-cafe"],
        ["Ünïcode ÅÉÎ", "/webhooks/unicode-aei"],
        ["  --Hello__World!!  ", "/webhooks/hello-world"],
        ["Order #42 / Q3", "/webhooks/order-42-q3"],
        ["x - y – z", "/webhooks/x-y-z"],
        ["日本語", "/webhooks/procedure"],
        ["😀", "/webhooks/procedure-2"],
        ["Stripe", "/webhooks/stripe"],
        ["a".repeat(60), `/webhooks/${"a".repeat(40)}`],
      ];
      const seen = [];
      const ids = [];
      for (const [name, expected] of names) {
        const created = await auto(ctx, `new webhook procedure ${name.slice(0, 20)}`, "POST", "/procedures/new", { body: { name, trigger: "webhook", description: "from the recipe" } });
        const id = text(created.body, "_id");
        ids.push(id);
        const read = await auto(ctx, "read it", "GET", `/procedures/${id}`);
        const node = list(read.body, "graph", "nodes")[0] ?? {};
        seen.push(same(`${JSON.stringify(name.slice(0, 24))} -> path`, [node.kind, node.typeId, pick(node, "config", "method"), pick(node, "config", "path"), pick(read.body, "enabled"), text(read.body, "description")], ["trigger", "webhook", "POST", expected, false, "from the recipe"]));
      }
      await ctx.verify("the path comes from the name", seen);
      const again = await auto(ctx, "a second procedure with the same name", "POST", "/procedures/new", { body: { name: "Forward a webhook", trigger: "webhook" } });
      const againRead = await auto(ctx, "read the second", "GET", `/procedures/${text(again.body, "_id")}`);
      await ctx.verify("a taken name warns and a taken path moves to a free one", [
        same("the warning", pick(again.body, "warning"), "$dms_automation.api.nameTaken"),
        same("the path", text(list(againRead.body, "graph", "nodes")[0], "config", "path"), "/webhooks/forward-a-webhook-2"),
      ]);
      const keep = new Set([ids[0], ids[8]]);
      for (const other of [...ids, text(again.body, "_id")]) if (!keep.has(other)) await auto(ctx, "delete a recipe procedure to keep the list on one page", "DELETE", `/procedures/${other}`);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/procedures");
      await ctx.verify("the Procedures page words the webhook", [
        await tab.shows(/Forward a webhook\s+from the recipe\s+Draft\s+POST \/webhooks\/forward-a-webhook\s+Webhook/),
        await tab.shows(/Stripe\s+from the recipe\s+Draft\s+POST \/webhooks\/stripe\s+Webhook/),
      ]);
    },
  },
  {
    id: "a-loopback-api-base-url-is-shown-as-it-is-with-a-hint",
    title: "a loopback apiBaseUrl (localhost, ::1, 127.x) is shown as it is, trailing slashes dropped, and counts as unconfigured; any other host counts as configured",
    entryPoint: "GET /library/webhook-base",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {[string, { url: string, configured: boolean }][]} */
      const settings = [
        ["http://localhost:5010/", { url: "http://localhost:5010", configured: false }],
        ["http://[::1]:5010", { url: "http://[::1]:5010", configured: false }],
        ["http://127.1.2.3:8080", { url: "http://127.1.2.3:8080", configured: false }],
        ["http://10.0.0.5:3000/hooks/", { url: "http://10.0.0.5:3000/hooks", configured: true }],
        ["https://api.example.org", { url: "https://api.example.org", configured: true }],
      ];
      /** @type {Check[]} */
      const seen = [];
      await withApiBase(ctx, settings.map(([setting]) => setting), async (setting) => {
        const expected = settings.find(([candidate]) => candidate === setting)?.[1] ?? { url: "", configured: false };
        const base = await webhookBase(ctx);
        seen.push(same(`webhook base for ${JSON.stringify(setting)}`, { url: base.url, configured: base.configured }, expected));
      });
      await ctx.verify("what the API reports", seen);
    },
  },
];
