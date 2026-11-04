import { auto, check, isText, list, pick, same } from "../../auto.mjs";
import { action, chain, dedge, trigger } from "../../procs.mjs";
import { httpOnce, sinkBase } from "./http-kit.mjs";
import { endedAs, inputValue, rowOf, runGraph, sinkState, stepsOfNode } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * @param {Row} out The step output
 * @returns {Row} The echoed request the sink answered, parsed
 */
function echoed(out) {
  return rowOf(out.json);
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function requestChecks(ctx) {
  const base = await sinkBase(ctx);
  const checks = [];
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
    const one = await httpOnce(ctx, { url: `${base}/echo?x=%C3%A9&y=1`, method });
    const json = echoed(one.out);
    checks.push(endedAs(method, one.ran, "ok"));
    checks.push(same(`${method}: the server saw the method, the path and the query`, [json.method, json.path, json.query], [method, "/echo", { x: "é", y: "1" }]));
    checks.push(same(`${method}: status and JSON parsed from the answer`, [one.out.status, isText(one.out.body) ? "string" : "not a string", pick(one.out, "headers", "x-sink")], [200, "string", "1"]));
  }
  const bare = await httpOnce(ctx, { url: `${base}/echo` });
  checks.push(same("no method means GET", echoed(bare.out).method, "GET"));
  const padded = await httpOnce(ctx, { url: `  ${base}/echo/é日本?q=🚀  ` });
  checks.push(same("a URL is trimmed and accents, CJK and emoji are encoded", [echoed(padded.out).path, echoed(padded.out).query], ["/echo/%C3%A9%E6%97%A5%E6%9C%AC", { q: "🚀" }]));
  const headers = await httpOnce(ctx, { url: `${base}/echo`, method: "POST", headers: { "X-Trace": "abc", "X-Count": 5, "X-Flag": true }, body: { k: ["é", "日本", "🚀"] } });
  const sent = rowOf(echoed(headers.out).headers);
  checks.push(same("headers are sent, numbers and booleans as text", [sent["x-trace"], sent["x-count"], sent["x-flag"]], ["abc", "5", "true"]));
  checks.push(same("an object body is sent as JSON", echoed(headers.out).body, '{"k":["é","日本","🚀"]}'));
  checks.push(same("an object body sets the JSON content type", sent["content-type"], "application/json"));
  const typed = await httpOnce(ctx, { url: `${base}/echo`, method: "PUT", headers: { "content-TYPE": "application/vnd.verify+json" }, body: { a: 1 } });
  checks.push(same("a content type the graph set is kept", [pick(echoed(typed.out), "headers", "content-type"), echoed(typed.out).body], ["application/vnd.verify+json", '{"a":1}']));
  const plain = await httpOnce(ctx, { url: `${base}/echo`, method: "POST", body: "plain é日本 🚀 {not json}" });
  checks.push(same("a text body is sent as it is", echoed(plain.out).body, "plain é日本 🚀 {not json}"));
  const deleted = await httpOnce(ctx, { url: `${base}/echo`, method: "DELETE", body: { gone: true } });
  checks.push(same("DELETE sends its body", echoed(deleted.out).body, '{"gone":true}'));
  const getBody = await httpOnce(ctx, { url: `${base}/echo`, method: "GET", body: { ignored: 1 } });
  checks.push(endedAs("GET with a body", getBody.ran, "ok"));
  checks.push(same("GET with a body: the body is not sent", echoed(getBody.out).body, ""));
  checks.push(same("GET with a body: the log says so", getBody.warnings, ["GET request: body ignored"]));
  const noWarn = await httpOnce(ctx, { url: `${base}/echo`, method: "POST", body: "x" });
  checks.push(same("POST with a body: no warning", noWarn.warnings, []));
  const received = (await sinkState(ctx)).received;
  checks.push(check("the sink saw every request", received.length >= 12, String(received.length)));
  return checks;
}

/** The content types and whether the answer's JSON is parsed. */
export const JSON_CASES = [
  { label: "application/json", type: "application/json", body: '{"a":[1,"é"]}', json: { a: [1, "é"] } },
  { label: "a +json media type", type: "application/vnd.api+json", body: '{"a":1}', json: { a: 1 } },
  { label: "text/json", type: "text/json", body: "[1,2]", json: [1, 2] },
  { label: "JSON in upper case", type: "APPLICATION/JSON; charset=utf-8", body: '"text"', json: "text" },
  { label: "text/plain holding JSON", type: "text/plain", body: '{"a":1}', json: null },
  { label: "application/json holding text", type: "application/json", body: "not json at all", json: null },
  { label: "application/json with nothing", type: "application/json", body: "", json: null },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function answerChecks(ctx) {
  const base = await sinkBase(ctx);
  const checks = [];
  for (const one of JSON_CASES) {
    const result = await httpOnce(ctx, { url: `${base}/ctype?type=${encodeURIComponent(one.type)}&body=${encodeURIComponent(one.body)}` });
    checks.push(same(`${one.label}: body as text and json ${one.json === null ? "empty" : "parsed"}`, [result.out.status, result.out.body, result.out.json], [200, one.body, one.json]));
  }
  const bad = await httpOnce(ctx, { url: `${base}/badjson` });
  checks.push(same("JSON content type with a broken body gives an empty json and keeps the body", [bad.out.body, bad.out.json], ["{not json", null]));
  const unicode = await httpOnce(ctx, { url: `${base}/text?body=${encodeURIComponent("café 日本語 🚀")}` });
  checks.push(same("a text answer keeps accents, CJK and emoji", [unicode.out.body, unicode.out.json], ["café 日本語 🚀", null]));
  const empty = await httpOnce(ctx, { url: `${base}/status/204` });
  checks.push(same("204 is a success with an empty body", [empty.out.status, empty.out.body], [204, ""]));
  const redirected = await httpOnce(ctx, { url: `${base}/redirect/3` });
  checks.push(same("redirects are followed", [redirected.out.status, echoed(redirected.out).path], [200, "/echo"]));
  const cookie = await httpOnce(ctx, { url: `${base}/ctype?type=text/plain&body=x` });
  const returned = rowOf(cookie.out.headers);
  checks.push(same("the headers of the answer are kept by lower-case name, credentials masked in the trace", [returned["content-type"], returned["set-cookie"], returned["x-api-key"]], ["text/plain", "[redacted]", "[redacted]"]));
  const wired = await runGraph(
    ctx,
    chain([trigger("t"), action("h", "http.request", { url: `${base}/ctype?type=text/plain&body=x` }), action("l", "log.message", {})], [dedge("h", "headers", "l", "value")]),
  );
  const handed = rowOf(inputValue(stepsOfNode(wired, "l")[0], "value"));
  checks.push(same("the next step is handed the answer's real headers, only the stored copy is masked", [handed["set-cookie"], handed["x-api-key"]], ["session=abc123; Path=/", "server-secret"]));
  const sentHeaders = await httpOnce(ctx, { url: `${base}/echo`, headers: { Authorization: "Bearer s3cret", "X-Api-Key": "k-123", "X-Visible": "shown" } });
  const logged = rowOf(pick(sentHeaders.step, "inputs", "headers", "value"));
  checks.push(same("the trace masks the credentials a request sent", [logged.Authorization, logged["X-Api-Key"], logged["X-Visible"]], ["[redacted]", "[redacted]", "shown"]));
  checks.push(same("the server got the real credentials", [pick(echoed(sentHeaders.out), "headers", "authorization"), pick(echoed(sentHeaders.out), "headers", "x-api-key")], ["Bearer s3cret", "k-123"]));
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function fieldChecks(ctx) {
  const listing = await auto(ctx, "list the action types", "GET", "/action-types");
  const http = list(listing.body).find((row) => row.id === "http.request");
  const props = rowOf(pick(http, "inputSchema", "properties"));
  const field = (/** @type {string} */ name, /** @type {string[]} */ keys) => keys.map((key) => pick(props, name, key));
  return [
    same("the module's actions are HTTP request and Log", list(listing.body).filter((row) => row.module === undefined).map((row) => row.id), ["http.request", "log.message"]),
    same("the timeout defaults to 30000 ms, from 1 to 300000", field("timeoutMs", ["default", "minimum", "maximum"]), [30000, 1, 300000]),
    same("the method defaults to GET among five", field("method", ["default", "enum"]), ["GET", ["GET", "POST", "PUT", "DELETE", "PATCH"]]),
    same("failOnStatus defaults to on", field("failOnStatus", ["default", "type"]), [true, "boolean"]),
    same("the URL is the one required field", pick(http, "inputSchema", "required"), ["url"]),
    same("the outputs are status, headers, body and json", Object.keys(rowOf(pick(http, "outputSchema", "properties"))), ["status", "headers", "body", "json"]),
    same("the headers are marked as credentials to mask", [pick(props, "headers", "x-redact"), pick(http, "outputSchema", "properties", "headers", "x-redact")], ["headers", "headers"]),
  ];
}
