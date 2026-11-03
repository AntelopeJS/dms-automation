import { guarded } from "../guard.mjs";
import { auto, check, fixture, isRow, list, num, parseJson, pick, same, text } from "../auto.mjs";
import { action, clearLedger, createEnabled, data, dedge, graph, ledger, runNow, runsOfProcedure, tedge, trigger, until, withConfig } from "../procs.mjs";
import { CREDENTIAL_NAMES, PLAIN_NAMES } from "./parts/redaction-names.mjs";
import { alphabetical, storedRun } from "./parts/runs-common.mjs";
import { retentionJourneys } from "./parts/retention.mjs";
import { scrubJourneys } from "./parts/redaction-scrub.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

const SECRET = (/** @type {string} */ name) => `v-${name}-é日本☕-0123456789`;

/**
 * A procedure whose effect step receives the Authorization header of the payload, as the run does.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The name
 * @returns {Promise<string>} The id
 */
export async function receivingProcedure(ctx, name) {
  const { id } = await createEnabled(ctx, {
    name,
    graph: graph(
      [trigger("t"), data("pick", "object.get", { path: "Authorization" }), action("eff", "verify.effect")],
      [tedge("t", "eff")],
      [dedge("t", "headers", "pick", "obj"), dedge("pick", "result", "eff", "label")],
    ),
  });
  return id;
}

/**
 * @param {string[]} names Header names
 * @param {(name: string) => boolean} sensitive Whether a name is a credential
 * @returns {{ sent: Record<string, string>, stored: Record<string, string> }} What is sent and what the run keeps
 */
function groups(names, sensitive) {
  const sent = Object.fromEntries(names.map((name) => [name, SECRET(name)]));
  const stored = Object.fromEntries(names.map((name) => [name, sensitive(name) ? "[redacted]" : SECRET(name)]));
  return { sent, stored };
}

export const journeys = guarded([
  {
    id: "every-built-in-credential-name-is-stored-redacted-whatever-its-case",
    title: "a run keeps the headers and query parameters of its trigger except the value of a credential: the exact names, the names containing token, secret, signature, hmac, password, passwd, session, apikey, api-key, api_key, accesskey, access-key or access_key, the names starting x-auth or ending -key or _key, compared case-insensitively, are stored, shown and replayed as [redacted] and every other name keeps its value",
    entryPoint: "POST /procedures/:id/run-now, GET /runs/:id, GET /procedures/:id/last-payload",
    async run(/** @type {Ctx} */ ctx) {
      const id = await receivingProcedure(ctx, ctx.unique("Redact all"));
      const credentials = CREDENTIAL_NAMES.map(([name]) => name);
      const headers = groups([...credentials, ...PLAIN_NAMES].map((name) => name), (name) => credentials.includes(name));
      const query = groups([...credentials.slice(0, 12), ...PLAIN_NAMES.slice(0, 6)].map((name) => `q-${name}`).map((name) => name.replace("q-", "")), (name) => credentials.includes(name));
      const payload = { headers: { Authorization: SECRET("Authorization"), ...Object.fromEntries(Object.entries(headers.sent).filter(([n]) => n !== "Authorization")) }, query: query.sent, body: { Authorization: "body is not a header", token: "kept" } };
      await clearLedger(ctx);
      const ran = await runNow(ctx, id, payload);
      const expectedHeaders = { Authorization: "[redacted]", ...Object.fromEntries(Object.entries(headers.stored).filter(([n]) => n !== "Authorization")) };
      const expected = { headers: expectedHeaders, query: query.stored, body: payload.body };
      const run = (await auto(ctx, "the run", "GET", `/runs/${ran.runId}`)).body;
      const stored = await storedRun(ctx, ran.runId);
      const last = (await auto(ctx, "last payload", "GET", `/procedures/${id}/last-payload`)).body;
      const storedPayload = parseJson(text(stored, "triggerPayload"));
      const storedHeaders = pick(storedPayload, "headers");
      const sorted = (/** @type {Record<string, string>} */ o) => Object.keys(o).sort(alphabetical);
      await ctx.verify("what the run keeps", [
        same("the stored payload, every name of the docs' list redacted, every other name and the body kept", storedPayload, expected),
        same("the API shows the same payload", parseJson(text(run, "triggerPayload")), expected),
        same("the trigger step of the trace shows it too", pick(list(run, "trace", "steps")[0], "output", "value"), expected),
        same("the next test payload offered (last payload) is redacted too", pick(last, "last", "payload"), expected),
        same("the names kept their order", isRow(storedHeaders) ? Object.keys(storedHeaders) : [], Object.keys(expectedHeaders)),
        check("no secret value is stored anywhere in the run document", !JSON.stringify(stored).includes(SECRET("Authorization")) && credentials.every((name) => !JSON.stringify(stored).includes(SECRET(name))), sorted(headers.sent).length),
        same("the run itself received the full value", (await ledger(ctx)).entries.filter((e) => e.kind === "execute").map((e) => e.label), [SECRET("Authorization")]),
      ]);
    },
  },
  {
    id: "a-trigger-event-keeps-its-headers-and-query-redacted-like-run-now",
    title: "a payload that comes from a trigger event with headers and a query is stored with the credentials redacted while the run receives them in full",
    entryPoint: "POST /verify-auto/emit, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await createEnabled(ctx, {
        name: ctx.unique("Event redact"),
        graph: graph([trigger("t", "verify.event", { topic: "redact" }), data("pick", "object.get", { path: "authorization" }), action("eff", "verify.effect")], [tedge("t", "eff")], [dedge("t", "headers", "pick", "obj"), dedge("pick", "result", "eff", "label")]),
      });
      await clearLedger(ctx);
      const payload = { headers: { authorization: "Bearer event-secret-1", "x-trace-id": "trace-ñ-1" }, query: { sig: "abcdef", page: "2" }, body: { ok: true } };
      const emitted = await fixture(ctx, "emit", "POST", "/emit", { topic: "redact", payload });
      const runs = await until(() => runsOfProcedure(ctx, id), (rows) => rows.length > 0, 20_000);
      const run = runs[0] ? (await auto(ctx, "run", "GET", `/runs/${text(runs[0], "_id")}`)).body : {};
      await ctx.verify("event run", [
        same("one trigger armed received the event", num(emitted.body, "emitted"), 1),
        same("stored redacted, other values kept", parseJson(text(run, "triggerPayload")), { headers: { authorization: "[redacted]", "x-trace-id": "trace-ñ-1" }, query: { sig: "[redacted]", page: "2" }, body: { ok: true } }),
        same("the run got the full value", (await ledger(ctx)).entries.filter((e) => e.kind === "execute").map((e) => e.label), ["Bearer event-secret-1"]),
        same("kind and trigger", [pick(run, "kind"), pick(run, "triggerType")], ["run", "verify.event"]),
      ]);
    },
  },
  {
    id: "runs-sensitive-names-add-to-the-built-in-credential-names",
    title: "runs.sensitiveNames adds names: a header or query parameter whose name contains one of the strings, compared case-insensitively, is redacted too, the built-in names still apply, and a run stored before the name was added reads redacted with its payload, error and log scrubbed",
    entryPoint: "runs.sensitiveNames, GET /runs/:id, GET /runs/:id/logs, GET /runs/:id/rerun-confirm",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await createEnabled(ctx, {
        name: ctx.unique("Sensitive"),
        graph: graph(
          [trigger("t"), data("pick", "object.get", { path: "x-tenant-ref-id" }), action("eff", "verify.effect"), action("boom", "verify.fail")],
          [tedge("t", "eff"), tedge("eff", "boom")],
          [dedge("t", "headers", "pick", "obj"), dedge("pick", "result", "eff", "label"), dedge("pick", "result", "boom", "message")],
        ),
      });
      const headers = { "x-tenant-ref-id": "tenant-secret-12345", "My-Customer-Code": "customer-6789", tenant: "plain-tenant", cust: "plain-cust", Authorization: "Bearer builtin-1234" };
      const before = await runNow(ctx, id, { headers, query: { Customer_Id: "q-cust-1", page: "3" } });
      const clear = await storedRun(ctx, before.runId);
      await ctx.verify("without the option", [
        same("only the built-in name is redacted", pick(parseJson(text(clear, "triggerPayload")), "headers"), { "x-tenant-ref-id": "tenant-secret-12345", "My-Customer-Code": "customer-6789", tenant: "plain-tenant", cust: "plain-cust", Authorization: "[redacted]" }),
        same("the failing step stored the value in the error", pick(clear, "errorMessage"), "tenant-secret-12345"),
      ]);
      await withConfig(ctx, { VERIFY_AUTO_SENSITIVE_NAMES: "Tenant-Ref, CUSTOMER" }, async () => {
        await clearLedger(ctx);
        const after = await runNow(ctx, id, { headers, query: { Customer_Id: "q-cust-1", page: "3" } });
        const fresh = await storedRun(ctx, after.runId);
        const old = (await auto(ctx, "the older run", "GET", `/runs/${before.runId}`)).body;
        const oldLogs = (await auto(ctx, "the older run's log", "GET", `/runs/${before.runId}/logs`)).body;
        const confirm = (await auto(ctx, "confirm", "GET", `/runs/${before.runId}/rerun-confirm`)).body;
        const expected = { "x-tenant-ref-id": "[redacted]", "My-Customer-Code": "[redacted]", tenant: "plain-tenant", cust: "plain-cust", Authorization: "[redacted]" };
        await ctx.verify("with runs.sensitiveNames = [Tenant-Ref,  CUSTOMER]", [
          same("a new run: names containing a configured string are redacted, case-insensitively; others kept", parseJson(text(fresh, "triggerPayload")), { headers: expected, query: { Customer_Id: "[redacted]", page: "3" } }),
          same("the run received the full value", (await ledger(ctx)).entries.filter((e) => e.kind === "execute").map((e) => e.label), ["tenant-secret-12345"]),
          same("the stored error of the new run does not hold the value", pick(fresh, "errorMessage"), "[redacted]"),
          same("the older run reads redacted: payload", pick(parseJson(text(old, "triggerPayload")), "headers"), expected),
          same("the older run reads redacted: error", pick(old, "errorMessage"), "[redacted]"),
          check("the older run reads redacted: log", !JSON.stringify(oldLogs).includes("tenant-secret-12345") && JSON.stringify(oldLogs).includes("[redacted]"), JSON.stringify(oldLogs).slice(0, 300)),
          check("the older run reads redacted: trace", !JSON.stringify(pick(old, "trace")).includes("tenant-secret-12345"), JSON.stringify(pick(old, "trace")).slice(0, 300)),
          same("its re-run confirmation names the newly redacted headers", pick(confirm, "params", "headers"), "x-tenant-ref-id, My-Customer-Code, Authorization, Customer_Id"),
        ]);
      });
    },
  },
  ...scrubJourneys,
  ...retentionJourneys,
]);
