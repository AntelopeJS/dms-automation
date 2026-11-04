import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {import("../../../packages/dms-automation/frontend-vue/node_modules/@antelopejs/dms/bin/control/journey.mjs").JourneyContext} Ctx
 * @typedef {import("../../../packages/dms-automation/frontend-vue/node_modules/@antelopejs/dms/bin/control/tab.mjs").Tab} Tab
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {{ folder: string, status: number | null, headers: Record<string, string>, bytes: Buffer, text: string, json: unknown }} Raw
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** The module's HTTP API, which the dashboard calls. */
export const AUTOMATION = "/api/automation";

/** The verification playground's trusted backend calls (`playground/src/fixture.ts`). */
export const FIXTURE = "/verify-auto";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
export function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is string} Whether it is a string
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is number} Whether it is a number
 */
export function isNumber(value) {
  return typeof value === "number";
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is boolean} Whether it is a boolean
 */
export function isBoolean(value) {
  return typeof value === "boolean";
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is (...args: never[]) => unknown} Whether it is a function
 */
export function isFunction(value) {
  return typeof value === "function";
}

/**
 * Reads a nested field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {unknown} The field, or undefined when a step is missing
 */
export function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (!isRow(current)) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string} The field when it is a string, else the empty string
 */
export function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {number | undefined} The field when it is a number
 */
export function num(value, ...path) {
  const found = pick(value, ...path);
  return isNumber(found) ? found : undefined;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {boolean | undefined} The field when it is a boolean
 */
export function flag(value, ...path) {
  const found = pick(value, ...path);
  return isBoolean(found) ? found : undefined;
}

/**
 * The objects of an array field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {Row[]} The array's objects, empty when the field is not an array
 */
export function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string[]} The `name` of each object of the array field
 */
export function names(value, ...path) {
  return list(value, ...path).map((row) => text(row, "name"));
}

/**
 * A check, in the shape `ctx.record` takes.
 *
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
export function check(name, pass, detail) {
  return { name, pass: pass === true, detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined") };
}

/**
 * A check that two JSON values are equal, with both in the detail.
 *
 * @param {string} name What is compared
 * @param {unknown} actual What was observed
 * @param {unknown} expected What the docs say
 * @returns {Check} The check
 */
export function same(name, actual, expected) {
  return check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * @param {string} body A response body
 * @returns {unknown} Its JSON value, or undefined when it is not JSON
 */
export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the automation API
 * @param {{ body?: unknown, as?: string }} [options] The JSON body, and the account (`admin` by default, `anon` for nobody)
 * @returns {Promise<Answer>} The answer
 */
export function auto(ctx, label, method, path, options = {}) {
  return ctx.api(label, { method, path: `${AUTOMATION}${path}`, body: options.body, as: options.as });
}

/**
 * Calls the verification playground's trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the fixture
 * @param {unknown} [body] The JSON body
 * @returns {Promise<Answer>} The answer
 */
export function fixture(ctx, label, method, path, body) {
  return ctx.api(label, { method, path: `${FIXTURE}${path}`, body, as: "anon" });
}

/**
 * The session token of an account, after one authenticated call signed it in.
 *
 * @param {Ctx} ctx The journey
 * @param {string} account The account
 * @returns {Promise<string | undefined>} The token
 */
export async function tokenOf(ctx, account) {
  if (!ctx.state.tokens?.[account]) await ctx.api(`sign ${account} in`, { method: "GET", path: `${AUTOMATION}/procedures/summary`, as: account });
  return ctx.state.tokens?.[account];
}

/**
 * A request to any URL with its response headers and bytes kept in the evidence, redirects not followed. Any method
 * is sent as given, HEAD and OPTIONS included.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the request does
 * @param {{ url?: string, path?: string, origin?: "api" | "web", method?: string, headers?: Record<string, string>, as?: string, body?: Buffer | string }} request What to send; `as` adds the account's session token
 * @returns {Promise<Raw>} The answer
 */
export async function raw(ctx, label, request) {
  const folder = ctx.step(label);
  const origin = request.origin === "web" ? ctx.state.webUrl : ctx.state.apiUrl;
  const url = request.url ?? `${origin}${request.path ?? "/"}`;
  const method = request.method ?? "GET";
  /** @type {Record<string, string>} */
  const headers = { ...request.headers };
  if (request.as) headers.authorization = `Bearer ${(await tokenOf(ctx, request.as)) ?? ""}`;
  const shown = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, /auth|cookie/i.test(name) ? "<session>" : value]));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "request.json"), `${JSON.stringify({ method, url, headers: shown, bodyBytes: request.body === undefined ? 0 : Buffer.byteLength(request.body) }, null, 2)}\n`);
  const response = await fetch(url, { method, headers, redirect: "manual", body: request.body });
  const bytes = Buffer.from(await response.arrayBuffer());
  /** @type {Record<string, string>} */
  const received = {};
  for (const [name, value] of response.headers) received[name] = value;
  const body = bytes.toString("utf8");
  writeFileSync(join(folder, "response.json"), `${JSON.stringify({ status: response.status, headers: received, bytes: bytes.byteLength, sha256: sha256(bytes), body: body.slice(0, 4000) }, null, 2)}\n`);
  return { folder, status: response.status, headers: received, bytes, text: body, json: parseJson(body) };
}

/**
 * Records checks against the evidence folder `raw` made.
 *
 * @param {Ctx} ctx The journey
 * @param {Raw} answer The answer
 * @param {Check[]} checks The checks
 * @returns {boolean} Whether they all passed
 */
export function recordRaw(ctx, answer, checks) {
  return ctx.record(answer.folder, checks);
}

/**
 * @param {Uint8Array} bytes Some bytes
 * @returns {string} Their SHA-256, hex
 */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
