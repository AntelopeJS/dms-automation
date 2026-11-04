import { auto, check, isRow, list, pick, same, text } from "../../auto.mjs";
import { action, createProcedure, graph, runsOfProcedure, statusIs } from "../../procs.mjs";
import { callWebhook, enabledProcedure, payloadRow, runDetail, runsUntil, saveGraph, webhookGraph } from "./triggers-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */

export const callJourneys = [
  {
    id: "a-called-webhook-starts-a-run-with-its-method-headers-query-body-and-params",
    title: "a webhook call answers {\"ok\":true}, starts a run whose payload holds the method, the headers, the query (a repeated key as a list), the body (JSON, form, or text) and the :param values, and the payload is the trigger's output, the run's stored payload and the procedure's last payload",
    entryPoint: "POST /webhooks/..., GET /runs/:id, GET /procedures/:id/last-payload",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await enabledProcedure(ctx, { name: ctx.unique("Payload"), graph: webhookGraph("/webhooks/pay/:kind/:n", "POST") });
      const json = await callWebhook(ctx, "call with a JSON body", { path: "/webhooks/pay/order/7?x=1&x=2&y=%C3%A9&z=&flag&plus=a+b&emoji=%F0%9F%98%80", headers: { "content-type": "application/json", "x-note": "kept", "X-Mixed-Case": "Value" }, body: JSON.stringify({ name: "Zoë", city: "東京", tags: ["a", "b"], n: 1.5, nested: { ok: true, none: null } }) });
      const [run] = await runsUntil(ctx, id, 1);
      const detail = await runDetail(ctx, text(run, "_id"));
      const payload = payloadRow(detail);
      const headers = isRow(payload.headers) ? payload.headers : {};
      await ctx.verify("the JSON call", [
        same("the call is answered 200", json.status, 200),
        same("the answer body", json.json, { ok: true }),
        same("the content type of the answer", (json.headers["content-type"] ?? "").split(";")[0], "application/json"),
        same("the run kind", detail.kind, "run"),
        same("the run's trigger type", text(detail, "trigger", "typeId"), "webhook"),
        same("the payload keys, in order", Object.keys(payload), ["method", "headers", "query", "body", "params"]),
        same("method", payload.method, "POST"),
        same("query", payload.query, { x: ["1", "2"], y: "é", z: "", flag: "", plus: "a b", emoji: "😀" }),
        same("body", payload.body, { name: "Zoë", city: "東京", tags: ["a", "b"], n: 1.5, nested: { ok: true, none: null } }),
        same("params", payload.params, { kind: "order", n: "7" }),
        same("header names are lower case", [headers["x-note"], headers["x-mixed-case"], headers["content-type"]], ["kept", "Value", "application/json"]),
        same("the trigger step's output is the payload", pick(detail, "trace", "steps") && list(detail, "trace", "steps")[0]?.output, { type: "object", value: payload }),
        same("the run succeeded", detail.status, "ok"),
      ]);
      const last = await auto(ctx, "last payload", "GET", `/procedures/${id}/last-payload`);
      await ctx.verify("the last payload is the payload of this call", [
        same("the run it comes from", pick(last.body, "last", "runId"), text(run, "_id")),
        same("its trigger", pick(last.body, "last", "triggerNodeId"), "t"),
        same("its payload", pick(last.body, "last", "payload"), payload),
        same("nothing was too large", pick(last.body, "tooLarge"), false),
      ]);

      /** @type {[string, string, string, unknown][]} */
      const bodies = [
        ["a JSON array", "application/json", "[1,2,3]", [1, 2, 3]],
        ["a JSON number", "application/json", "42", 42],
        ["a JSON string", "application/json", '"héllo"', "héllo"],
        ["JSON null", "application/json", "null", null],
        ["JSON that is not valid", "application/json", "{not json", "{not json"],
        ["plain text", "text/plain", "héllo 日本 😀", "héllo 日本 😀"],
        ["JSON under another content type", "text/plain", '{"a":1}', { a: 1 }],
        ["a form", "application/x-www-form-urlencoded", "a=1&b=%C3%A9&c=x+y&a=2", { a: "2", b: "é", c: "x y" }],
        ["no content type", "", '{"b":2}', { b: 2 }],
      ];
      /** @type {Check[]} */
      const seen = [];
      let count = 1;
      for (const [label, type, body, expected] of bodies) {
        await callWebhook(ctx, `call with ${label}`, { path: "/webhooks/pay/b/1", headers: type ? { "content-type": type } : {}, body });
        const runs = await runsUntil(ctx, id, count + 1);
        count += 1;
        const stored = payloadRow(await runDetail(ctx, text(runs[0], "_id")));
        seen.push(same(label, stored.body, expected));
      }
      await ctx.verify("how a body is read", seen);

      await callWebhook(ctx, "call with no body", { path: "/webhooks/pay/b/2" });
      const empty = await runsUntil(ctx, id, count + 1);
      count += 1;
      const emptyPayload = payloadRow(await runDetail(ctx, text(empty[0], "_id")));
      await ctx.verify("a call without a body", [same("the payload has no body", Object.keys(emptyPayload), ["method", "headers", "query", "params"]), same("params", emptyPayload.params, { kind: "b", n: "2" }), same("query", emptyPayload.query, {})]);

      const big = await callWebhook(ctx, "call with a body over 1 MiB", { path: "/webhooks/pay/b/3", headers: { "content-type": "text/plain" }, body: "x".repeat(1024 * 1024 + 1) });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const runsAfterBig = await runsOfProcedure(ctx, id);
      await ctx.verify("a body over the size limit is refused and starts no run", [same("the call is refused with 413", big.status, 413), same("no run was added", runsAfterBig.length, count)]);

      const other = await callWebhook(ctx, "call with another method", { method: "GET", path: "/webhooks/pay/b/4" });
      const unknown = await callWebhook(ctx, "call an unknown path", { path: "/webhooks/pay/b" });
      const front = await callWebhook(ctx, "call the dashboard's server", { origin: "web", path: "/webhooks/pay/b/5", headers: { "content-type": "application/json" }, body: "{}" });
      const runsFinal = await runsOfProcedure(ctx, id);
      await ctx.verify("only the API server answers the configured method and path", [
        same("another method is not served", other.status, 404),
        same("an unknown path is not served", unknown.status, 404),
        check("the dashboard's server does not serve the webhook", front.json && pick(front.json, "ok") === true ? false : true, `${front.status} ${front.text.slice(0, 120)}`),
        same("none of them started a run", runsFinal.length, count),
      ]);
    },
  },
  {
    id: "each-webhook-method-answers-and-the-method-is-in-the-payload",
    title: "a webhook answers the method set on its trigger (POST by default) and the run's payload carries it; a text body wired to a step reaches it exactly",
    entryPoint: "POST|GET|PUT|DELETE|PATCH /webhooks/..., GET /runs/:id/logs",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {Map<string, string>} */
      const ids = new Map();
      for (const method of [undefined, "GET", "PUT", "DELETE", "PATCH", "POST"]) {
        const path = `/webhooks/m/${(method ?? "default").toLowerCase()}`;
        const { id } = await enabledProcedure(ctx, { name: ctx.unique(`Method ${method ?? "default"}`), graph: webhookGraph(path, method, "method") });
        ids.set(path, id);
      }
      /** @type {Check[]} */
      const answers = [];
      const calls = [
        ["/webhooks/m/default", "POST", "POST"],
        ["/webhooks/m/get", "GET", "GET"],
        ["/webhooks/m/put", "PUT", "PUT"],
        ["/webhooks/m/delete", "DELETE", "DELETE"],
        ["/webhooks/m/patch", "PATCH", "PATCH"],
        ["/webhooks/m/post", "POST", "POST"],
      ];
      for (const [path, method, expected] of calls) {
        const answer = await callWebhook(ctx, `${method} ${path}`, { method, path, headers: { "content-type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
        const [run] = await runsUntil(ctx, ids.get(path) ?? "", 1);
        const entries = (await auto(ctx, "run logs", "GET", `/runs/${text(run, "_id")}/logs`)).body;
        const logged = list(entries, "entries").map((entry) => text(entry, "message"));
        answers.push(same(`${method} ${path} answers`, [answer.status, answer.json], [200, { ok: true }]), check(`${method} ${path} wires its method into the step`, logged.includes(expected), logged));
      }
      await ctx.verify("every configured method answers", answers);
      /** @type {Check[]} */
      const wrong = [];
      for (const [path, method] of [["/webhooks/m/get", "POST"], ["/webhooks/m/put", "POST"], ["/webhooks/m/default", "GET"], ["/webhooks/m/default", "PUT"], ["/webhooks/m/patch", "DELETE"]]) {
        const answer = await callWebhook(ctx, `${method} ${path} (wrong method)`, { method, path, headers: { "content-type": "application/json" }, body: method === "POST" || method === "PUT" ? "{}" : undefined });
        wrong.push(same(`${method} ${path}`, answer.status, 404));
      }
      for (const path of ["/webhooks/m/default", "/webhooks/m/get"]) {
        const answer = await callWebhook(ctx, `OPTIONS ${path}`, { method: "OPTIONS", path });
        wrong.push(check(`OPTIONS ${path} answers without {"ok":true}`, !(answer.json && pick(answer.json, "ok") === true), `${answer.status} ${answer.text.slice(0, 80)}`));
      }
      /** @type {[string, number][]} */
      const counts = [];
      for (const [path, id] of ids) counts.push([path, (await runsOfProcedure(ctx, id)).length]);
      await ctx.verify("another method starts nothing", [...wrong, same("each procedure ran exactly once", counts.map(([, n]) => n), [1, 1, 1, 1, 1, 1])]);

      const textId = (await enabledProcedure(ctx, { name: ctx.unique("Text body"), graph: webhookGraph("/webhooks/m/text", "POST", "body") })).id;
      const message = "Grüße, 日本語, 😀 \" quotes \\ and a\nnewline";
      await callWebhook(ctx, "send a text body", { path: "/webhooks/m/text", headers: { "content-type": "text/plain" }, body: message });
      const [run] = await runsUntil(ctx, textId, 1);
      const logs = list((await auto(ctx, "run logs", "GET", `/runs/${text(run, "_id")}/logs`)).body, "entries").map((entry) => text(entry, "message"));
      await ctx.verify("a text body wired to the Log step arrives exactly", [check("the log holds the text", logs.includes(message), logs)]);
    },
  },
  {
    id: "a-webhook-answers-only-while-its-procedure-is-enabled-and-follows-its-edits",
    title: "a webhook answers 200 while its procedure is enabled and nothing once it is paused, deleted or edited away from that path or method; an enabled webhook still answers after the backend restarts and a paused one does not",
    entryPoint: "PUT /procedures/:id/enabled, PUT /procedures/:id, DELETE /procedures/:id, POST /webhooks/...",
    async run(/** @type {Ctx} */ ctx) {
      const call = async (/** @type {string} */ label, /** @type {string} */ path, /** @type {string} */ method = "POST") => (await callWebhook(ctx, label, { method, path, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" })).status;
      const draftId = await createProcedure(ctx, { name: ctx.unique("Lifecycle"), graph: webhookGraph("/webhooks/life/a") });
      const beforeEnable = await call("call the draft's path", "/webhooks/life/a");
      await auto(ctx, "enable", "PUT", `/procedures/${draftId}/enabled`, { body: { enabled: true } });
      const enabled = await call("call after enabling", "/webhooks/life/a");
      await runsUntil(ctx, draftId, 1);
      await auto(ctx, "pause", "PUT", `/procedures/${draftId}/enabled`, { body: { enabled: false } });
      const paused = await call("call while paused", "/webhooks/life/a");
      await auto(ctx, "resume", "PUT", `/procedures/${draftId}/enabled`, { body: { enabled: true } });
      const resumed = await call("call after resuming", "/webhooks/life/a");
      const runs = await runsUntil(ctx, draftId, 2);
      await ctx.verify("enabling, pausing and resuming", [
        same("a draft answers nothing", beforeEnable, 404),
        same("an enabled webhook answers", enabled, 200),
        same("a paused webhook answers nothing", paused, 404),
        same("a resumed webhook answers again", resumed, 200),
        same("exactly the two answered calls ran", runs.length, 2),
      ]);

      const edited = await saveGraph(ctx, draftId, webhookGraph("/webhooks/life/b", "PUT"), { enabled: true });
      const oldPath = await call("call the old path", "/webhooks/life/a");
      const oldMethod = await call("call the new path with the old method", "/webhooks/life/b", "POST");
      const newRoute = await call("call the new path and method", "/webhooks/life/b", "PUT");
      const afterEdit = await runsUntil(ctx, draftId, 3);
      await ctx.verify("editing the path and method moves the webhook", [
        statusIs(edited, 200, "saving the edit answers 200"),
        same("the old path answers nothing", oldPath, 404),
        same("the old method answers nothing on the new path", oldMethod, 404),
        same("the new path and method answer", newRoute, 200),
        same("one more run", afterEdit.length, 3),
        same("the run came from the edited webhook", text(await runDetail(ctx, text(afterEdit[0], "_id")), "triggerText"), "PUT /webhooks/life/b"),
      ]);

      const pausedId = (await enabledProcedure(ctx, { name: ctx.unique("Stays paused"), graph: webhookGraph("/webhooks/life/paused") })).id;
      await auto(ctx, "pause the second one", "PUT", `/procedures/${pausedId}/enabled`, { body: { enabled: false } });
      await ctx.restartBackend();
      const afterRestart = await call("call the enabled webhook after a restart", "/webhooks/life/b", "PUT");
      const stillPaused = await call("call the paused webhook after a restart", "/webhooks/life/paused");
      const restartRuns = await runsUntil(ctx, draftId, 4);
      await ctx.verify("a restart arms the enabled webhooks only", [
        same("the enabled webhook answers", afterRestart, 200),
        same("the paused webhook answers nothing", stillPaused, 404),
        same("the run was stored", restartRuns.length, 4),
        same("the run history survived", (await runsOfProcedure(ctx, draftId)).length, 4),
      ]);

      const removed = await auto(ctx, "delete the procedure", "DELETE", `/procedures/${draftId}`);
      const gone = await call("call a deleted procedure's webhook", "/webhooks/life/b", "PUT");
      await ctx.verify("deleting the procedure takes the webhook down", [statusIs(removed, 200, "delete answers 200"), same("the webhook answers nothing", gone, 404)]);

      const noTrigger = await enabledProcedure(ctx, { name: ctx.unique("Trigger removed"), graph: webhookGraph("/webhooks/life/removed") });
      const dropped = await saveGraph(ctx, noTrigger.id, graph([action("log", "log.message", { message: "x" })]), { enabled: false });
      const afterDrop = await call("call after its webhook was removed", "/webhooks/life/removed");
      await ctx.verify("removing the webhook node and pausing takes it down", [statusIs(dropped, 200, "saving answers 200"), same("the path answers nothing", afterDrop, 404)]);
    },
  },
];
