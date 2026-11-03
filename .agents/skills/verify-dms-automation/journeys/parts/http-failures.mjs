import { auto, check, list, pick, raw, same, text } from "../../auto.mjs";
import { action, chain, createProcedure, dedge, runNow, trigger } from "../../procs.mjs";
import { closedPort, httpOnce, sinkBase } from "./http-kit.mjs";
import { endedAs, runGraph, userLogs } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const STATUS_CASES = [
  { status: 400, text: "Bad Request", hint: " The server rejected the request: check the body and the URL parameters." },
  { status: 401, text: "Unauthorized", hint: " Check the credentials sent in the headers." },
  { status: 403, text: "Forbidden", hint: " Check the credentials sent in the headers." },
  { status: 404, text: "Not Found", hint: " Check the URL." },
  { status: 405, text: "Method Not Allowed", hint: " Check the method." },
  { status: 409, text: "Conflict", hint: "" },
  { status: 418, text: "I'm a Teapot", hint: "" },
  { status: 422, text: "Unprocessable Entity", hint: " The server rejected the request: check the body and the URL parameters." },
  { status: 429, text: "Too Many Requests", hint: " Too many requests: wait, or wrap the step in Retry." },
  { status: 499, text: "unknown", hint: "" },
  { status: 500, text: "Internal Server Error", hint: " The server failed: try again later, or wrap the step in Retry." },
  { status: 503, text: "Service Unavailable", hint: " The server failed: try again later, or wrap the step in Retry." },
  { status: 300, text: "Multiple Choices", hint: "" },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function statusChecks(ctx) {
  const base = await sinkBase(ctx);
  const checks = [];
  for (const one of STATUS_CASES) {
    const encoded = encodeURIComponent("caf\u00e9 \u65e5\u672c");
    const url = `${base}/status/${one.status}?body=${encoded}`;
    const result = await httpOnce(ctx, { url });
    const label = String(one.status);
    checks.push(endedAs(label, result.ran, "failed"));
    checks.push(same(`${label}: the message names the request, the status, the hint and the response`, result.error, `GET ${base}/status/${one.status}?body=${encoded} \u2192 ${`${one.status} ${one.text}`.trim()}.${one.hint} Response: caf\u00e9 \u65e5\u672c`));
    checks.push(same(`${label}: the response body is logged as an error`, userLogs(result.ran).filter((entry) => entry.level === "error").map((entry) => [entry.message, entry.value]), [["response body", "caf\u00e9 \u65e5\u672c"]]));
  }
  for (const status of [200, 201, 204, 299]) {
    const result = await httpOnce(ctx, { url: `${base}/status/${status}` });
    checks.push(same(`${status} is a success`, [result.ran.status, result.out.status], ["ok", status]));
  }
  const empty = await httpOnce(ctx, { url: `${base}/status/404` });
  checks.push(same("an error status with no body: no response part and no logged body", [empty.error, userLogs(empty.ran).filter((entry) => entry.level === "error").length], [`GET ${base}/status/404 \u2192 404 Not Found. Check the URL.`, 0]));
  const off = await httpOnce(ctx, { url: `${base}/status/404?body=nope`, failOnStatus: false });
  checks.push(same("failOnStatus off hands the status, body and json to the graph", [off.ran.status, off.out.status, off.out.body, off.out.json], ["ok", 404, "nope", null]));
  const offServer = await httpOnce(ctx, { url: `${base}/status/503`, failOnStatus: false });
  checks.push(same("failOnStatus off also accepts a 5xx", [offServer.ran.status, offServer.out.status], ["ok", 503]));
  const on = await httpOnce(ctx, { url: `${base}/status/404`, failOnStatus: true });
  checks.push(same("failOnStatus on fails on an error status", on.ran.status, "failed"));
  const spaced = await httpOnce(ctx, { url: `${base}/status/500?body=${encodeURIComponent("  spaced out \n")}` });
  checks.push(same("the quoted response is trimmed", spaced.error, `GET ${base}/status/500?body=%20%20spaced%20out%20%0A \u2192 500 Internal Server Error. The server failed: try again later, or wrap the step in Retry. Response: spaced out`));
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function excerptChecks(ctx) {
  const base = await sinkBase(ctx);
  const checks = [];
  const quoted = async (/** @type {number} */ size) => {
    const body = `\u00e9${"x".repeat(size - 1)}`;
    const result = await httpOnce(ctx, { url: `${base}/status/500?body=${encodeURIComponent(body)}` });
    return { body, error: result.error ?? "", ran: result.ran };
  };
  const prefix = (/** @type {string} */ error) => error.slice(error.indexOf(" Response: ") + " Response: ".length);
  const at500 = await quoted(500);
  const at501 = await quoted(501);
  checks.push(same("a 500-character response is quoted whole", prefix(at500.error), at500.body));
  checks.push(same("a 501-character response is cut at 500 with an ellipsis", prefix(at501.error), `${at501.body.slice(0, 500)}\u2026`));
  const at4000 = await quoted(4000);
  const at4001 = await quoted(4001);
  const logged = (/** @type {{ ran: import("./runtime-kit.mjs").Ran }} */ one) => String(userLogs(one.ran).find((entry) => entry.level === "error")?.value);
  checks.push(same("a 4000-character response is logged whole", logged(at4000), at4000.body));
  checks.push(same("a 4001-character response is logged cut at 4000 with an ellipsis", logged(at4001), `${at4001.body.slice(0, 4000)}\u2026`));
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function networkChecks(ctx) {
  const base = await sinkBase(ctx);
  const checks = [];
  const port = await closedPort();
  const refused = await httpOnce(ctx, { url: `http://127.0.0.1:${port}/x` });
  checks.push(same("a closed port", refused.error, `GET http://127.0.0.1:${port}/x failed: connection refused by 127.0.0.1:${port}: nothing answers at this address and port (ECONNREFUSED).`));
  const unknown = await httpOnce(ctx, { url: "http://nonexistent.invalid/x" });
  checks.push(check("an unknown host", /^GET http:\/\/nonexistent\.invalid\/x failed: host not found: nonexistent\.invalid\. Check the URL \((ENOTFOUND|EAI_AGAIN)\)\.$/.test(String(unknown.error)), String(unknown.error)));
  const badPort = await httpOnce(ctx, { url: "http://127.0.0.1:1/" });
  checks.push(same("a port fetch forbids", badPort.error, "GET http://127.0.0.1:1/ failed: port 1 is not allowed for HTTP requests."));
  const reset = await httpOnce(ctx, { url: `${base}/reset` });
  checks.push(check("a connection closed by the server", new RegExp(`^GET ${base.replaceAll(".", "\\.")}/reset failed: 127\\.0\\.0\\.1:\\d+ closed the connection unexpectedly \\((UND_ERR_SOCKET|ECONNRESET)\\)\\.$`).test(String(reset.error)), String(reset.error)));
  const slow = await httpOnce(ctx, { url: `${base}/slow/4000`, timeoutMs: 1200 });
  checks.push(same("a timeout", slow.error, `GET ${base}/slow/4000 failed: no response after 1.2 s. Raise the timeout (timeoutMs) if the server is slow.`));
  const slower = await httpOnce(ctx, { url: `${base}/slow/4000`, timeoutMs: 2500 });
  checks.push(same("a timeout in seconds with a decimal", slower.error, `GET ${base}/slow/4000 failed: no response after 2.5 s. Raise the timeout (timeoutMs) if the server is slow.`));
  const enough = await httpOnce(ctx, { url: `${base}/slow/700`, timeoutMs: 3000 });
  checks.push(same("an answer within the timeout", [enough.ran.status, enough.out.body], ["ok", "late"]));
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function urlChecks(ctx) {
  const checks = [];
  const cases = [
    { label: "blank URL", url: "   ", message: "The URL is empty." },
    { label: "text that is not a URL", url: "not a url", message: '"not a url" is not a valid URL.' },
    { label: "an accented text", url: "caf\u00e9 \u65e5\u672c", message: '"caf\u00e9 \u65e5\u672c" is not a valid URL.' },
    { label: "ftp", url: "ftp://example.com/file", message: "Only http:// and https:// URLs are supported (got ftp://)." },
    { label: "file", url: "file:///etc/passwd", message: "Only http:// and https:// URLs are supported (got file://)." },
    { label: "a data URL", url: "data:text/plain,hi", message: "Only http:// and https:// URLs are supported (got data://)." },
  ];
  for (const one of cases) {
    const result = await httpOnce(ctx, { url: one.url });
    checks.push(same(`${one.label}: the message`, [result.ran.status, result.error], ["failed", one.message]));
    checks.push(same(`${one.label}: the step is the failed one`, result.ran.failedNodeId, "h"));
  }
  for (const { label, headers } of [{ label: "a list", headers: ["Accept"] }, { label: "a text", headers: "Accept: x" }]) {
    const result = await httpOnce(ctx, { url: "http://127.0.0.1:9/", headers });
    checks.push(same(`headers as ${label}`, [result.ran.status, result.error], ["failed", 'Headers must be an object of names and values, like {"Accept": "application/json"}.']));
  }
  const badName = await httpOnce(ctx, { url: "http://127.0.0.1:9/", headers: { "bad name": "x" } });
  checks.push(check("a header name that is not valid", String(badName.error).startsWith("Invalid header: "), String(badName.error)));
  const missing = chain([trigger("t"), action("h", "http.request", {})]);
  const problems = await auto(ctx, "validate a step with no URL, enabled", "POST", "/procedures/validate", { body: { graph: missing, enabled: true } });
  checks.push(same("a step with no URL blocks enabling and names the field", list(problems.body, "issues").filter((issue) => issue.severity === "error").map((issue) => [issue.code, issue.message, issue.nodeId]), [["missingField", "URL is empty", "h"]]));
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function limitChecks(ctx) {
  const base = await sinkBase(ctx);
  const checks = [];
  const MB = 2 * 1024 * 1024;
  for (const route of ["big", "chunked"]) {
    const exact = await httpOnce(ctx, { url: `${base}/${route}/${MB}` });
    checks.push(same(`${route}: 2 MB exactly is accepted`, [exact.ran.status, exact.out.status], ["ok", 200]));
    const over = await httpOnce(ctx, { url: `${base}/${route}/${MB + 1}` });
    checks.push(same(`${route}: one byte more is refused`, [over.ran.status, over.error], ["failed", `GET ${base}/${route}/${MB + 1} failed: the response is larger than 2 MB.`]));
  }
  const wired = async (/** @type {number} */ value) => {
    const graphOf = chain([trigger("t"), action("h", "http.request", { url: `${base}/echo` })]);
    graphOf.nodes.push({ id: "c", kind: "data", typeId: "const.number", config: { value }, position: { x: 0, y: 0 } });
    graphOf.dataEdges.push(dedge("c", "value", "h", "timeoutMs"));
    const ran = await runGraph(ctx, graphOf);
    return { ran, warnings: userLogs(ran).filter((entry) => entry.level === "warn").map((entry) => entry.message) };
  };
  const capped = await wired(400_000);
  checks.push(same("a timeout above 5 minutes is capped and the log says so", [capped.ran.status, capped.warnings], ["ok", ["timeoutMs capped at 300000 (5 minutes)"]]));
  const atCap = await wired(300_000);
  checks.push(same("a timeout of exactly 5 minutes is not capped", [atCap.ran.status, atCap.warnings], ["ok", []]));
  const justOver = await wired(300_001);
  checks.push(same("a timeout of 5 minutes and 1 ms is capped", justOver.warnings, ["timeoutMs capped at 300000 (5 minutes)"]));
  const zero = await wired(0);
  checks.push(same("a timeout of 0 falls back to the default and logs nothing", [zero.ran.status, zero.warnings], ["ok", []]));
  const refusedAbove = await createProcedure(ctx, { graph: chain([trigger("t"), action("h", "http.request", { url: `${base}/echo`, timeoutMs: 400_000 })]) });
  const answer = await runNow(ctx, refusedAbove, {});
  checks.push(same("a typed timeout above 5 minutes is refused", answer.answer.status, 400));
  checks.push(same("a typed timeout above 5 minutes: the problem", list(answer.answer.body, "issues").filter((issue) => issue.severity === "error").map((issue) => [issue.code, issue.nodeId]), [["aboveMaximum", "h"]]));
  return checks;
}

/**
 * The default timeout is 30 seconds: an answer after 28 s arrives, one after 32 s does not.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function defaultTimeoutChecks(ctx) {
  const base = await sinkBase(ctx);
  const attempt = async (/** @type {number} */ ms) => {
    const id = await createProcedure(ctx, { graph: chain([trigger("t"), action("h", "http.request", { url: `${base}/slow/${ms}` })]) });
    const answer = await raw(ctx, `run now with a ${ms} ms answer`, { path: `/api/automation/procedures/${id}/run-now`, method: "POST", as: "admin", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: {} }) });
    const runId = text(answer.json, "runId") || "undefined";
    const run = (await auto(ctx, "read the run", "GET", `/runs/${runId}`)).body;
    return { status: text(answer.json, "status") || "undefined", error: pick(run, "errorMessage") ?? null };
  };
  const [inTime, tooLate] = await Promise.all([attempt(28_000), attempt(32_000)]);
  return [
    same("an answer after 28 s arrives", inTime.status, "ok"),
    same("no answer within 30 s: the step fails after the default", [tooLate.status, tooLate.error], ["failed", `GET ${base}/slow/32000 failed: no response after 30 s. Raise the timeout (timeoutMs) if the server is slow.`]),
  ];
}
