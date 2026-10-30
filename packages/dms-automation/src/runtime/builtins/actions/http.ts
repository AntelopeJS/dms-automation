import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { type DataValue, parseJsonText } from "../../../types/dataValue";
import { isObject, isString } from "../../../types/guards";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface HttpInput {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  failOnStatus?: boolean;
}

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

interface HttpOutput {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The body parsed, when the server says it is JSON; null otherwise. */
  json: unknown;
}

/** Module-wide settings of the action, from the module config. */
export interface HttpRequestOptions {
  /**
   * Refuse requests to loopback, private (RFC 1918, unique local), link-local
   * (cloud metadata endpoints included) and other non-public addresses. Off by
   * default.
   */
  blockPrivateNetwork?: boolean;
}

let options: HttpRequestOptions = {};

/** Called once with the module config, before any procedure runs. */
export function setHttpRequestOptions(next: HttpRequestOptions): void {
  options = next;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * The longest a step may wait: a run holds its caller (a test run, Run now)
 * until it ends.
 */
const MAX_TIMEOUT_MS = 5 * 60_000;
/**
 * Larger responses are refused rather than held in memory and written to the
 * run log, whose size is bounded (see boundRunLog).
 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Characters of the response quoted in the error of a failed status. */
const ERROR_EXCERPT_CHARS = 500;
/** Characters of the response written to the run log on a failed status. */
const LOGGED_BODY_CHARS = 4000;
const MAX_REDIRECTS = 5;

const privateNetwork = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  privateNetwork.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  privateNetwork.addSubnet(address, prefix, "ipv6");
}

/**
 * NAT64 (RFC 6052): the last 32 bits of an address in 64:ff9b::/96 are the
 * IPv4 address a NAT64 gateway forwards to, private or not.
 */
const nat64 = new BlockList();
nat64.addSubnet("64:ff9b::", 96, "ipv6");

/** The URL parser serializes any IPv6 spelling as hexadecimal groups. */
function embeddedIpv4(address: string): string {
  const groups = new URL(`http://[${address}]`).hostname
    .slice(1, -1)
    .split(":");
  const [high = 0, low = 0] = groups
    .slice(-2)
    .map((g) => Number.parseInt(g || "0", 16));
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function isPrivateAddress(address: string, family: number): boolean {
  if (family !== 6) return privateNetwork.check(address, "ipv4");
  if (nat64.check(address, "ipv6")) {
    return privateNetwork.check(embeddedIpv4(address), "ipv4");
  }
  return privateNetwork.check(address, "ipv6");
}

function checkUrl(raw: unknown): URL {
  if (!isString(raw) || raw.trim() === "") {
    throw new Error("The URL is empty.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Only http:// and https:// URLs are supported (got ${url.protocol}//).`,
    );
  }
  return url;
}

function toHeaders(raw: unknown): Headers {
  if (raw !== undefined && raw !== null) {
    if (!isObject(raw) || Array.isArray(raw)) {
      throw new Error(
        'Headers must be an object of names and values, like {"Accept": "application/json"}.',
      );
    }
  }
  try {
    return new Headers((raw ?? {}) as Record<string, string>);
  } catch (err) {
    throw new Error(
      `Invalid header: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Fails when `url` points at a non-public address (see HttpRequestOptions). */
async function checkPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  const blocked = addresses.find((a) => isPrivateAddress(a.address, a.family));
  if (blocked) {
    throw new Error(
      `${host} is a private network address (${blocked.address}): this server refuses requests to its internal network (httpRequest.blockPrivateNetwork).`,
    );
  }
}

/** The request a redirect leads to, as fetch would follow it. */
function redirected(
  init: RequestInit,
  status: number,
  crossOrigin: boolean,
): RequestInit {
  const headers = new Headers(init.headers);
  if (crossOrigin) {
    for (const name of ["authorization", "cookie", "proxy-authorization"]) {
      headers.delete(name);
    }
  }
  const toGet =
    (status === 303 && init.method !== "HEAD") ||
    ((status === 301 || status === 302) && init.method === "POST");
  if (!toGet) return { ...init, headers };
  headers.delete("content-type");
  return { ...init, method: "GET", body: undefined, headers };
}

/**
 * Redirects are followed here so every hop is checked: a public URL can
 * redirect to an internal one.
 */
async function send(url: URL, init: RequestInit): Promise<Response> {
  if (!options.blockPrivateNetwork) return fetch(url, init);
  let target = url;
  let request = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkPublicHost(target);
    const res = await fetch(target, { ...request, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    const next = checkUrl(new URL(location, target).href);
    request = redirected(request, res.status, next.origin !== target.origin);
    target = next;
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects.`);
}

/** The body as text, refused past MAX_RESPONSE_BYTES. */
async function readBody(res: Response): Promise<string> {
  const tooLarge = () =>
    new Error(
      `the response is larger than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB.`,
    );
  if (Number(res.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await res.body?.cancel();
    throw tooLarge();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}

/** Why the request got no response, in words, from the error fetch threw. */
function failureReason(err: unknown, url: URL, timeoutMs: number): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return `no response after ${seconds(timeoutMs)}. Raise the timeout (timeoutMs) if the server is slow.`;
  }
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const code = isObject(cause) && "code" in cause ? cause.code : undefined;
  if (isString(code)) {
    const reason = networkReason(code, url);
    if (reason) return `${reason} (${code}).`;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === "bad port") {
    return `port ${url.port} is not allowed for HTTP requests.`;
  }
  return message;
}

function networkReason(code: string, url: URL): string | undefined {
  switch (code) {
    case "ECONNREFUSED":
      return `connection refused by ${url.host}: nothing answers at this address and port`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `host not found: ${url.hostname}. Check the URL`;
    case "ECONNRESET":
    case "UND_ERR_SOCKET":
      return `${url.host} closed the connection unexpectedly`;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return `${url.host} cannot be reached`;
  }
  if (/CERT|SSL|TLS/.test(code)) {
    return `the security certificate of ${url.hostname} is not trusted`;
  }
  return undefined;
}

/** What to look at for a failed status, for someone who did not write the API. */
function statusHint(status: number): string {
  if (status === 401 || status === 403) {
    return " Check the credentials sent in the headers.";
  }
  if (status === 404) return " Check the URL.";
  if (status === 405) return " Check the method.";
  if (status === 400 || status === 422) {
    return " The server rejected the request: check the body and the URL parameters.";
  }
  if (status === 429) {
    return " Too many requests: wait, or wrap the step in Retry.";
  }
  if (status >= 500) {
    return " The server failed: try again later, or wrap the step in Retry.";
  }
  return "";
}

function excerpt(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function headersOf(res: Response) {
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

function parseJson(res: Response, body: string): DataValue {
  if (!/\bjson\b/i.test(res.headers.get("content-type") ?? "")) return null;
  try {
    return parseJsonText(body);
  } catch {
    return null;
  }
}

/**
 * Titles are what a problem calls the field ("Fill in “URL”."); the
 * inspector shows its own translated labels.
 */
export const httpAction: ActionType<HttpInput, HttpOutput> = {
  id: "http.request",
  name: "$dms_automation.types.http.name",
  description: "$dms_automation.types.http.description",
  icon: "i-ph-globe",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", title: "URL" },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        default: "GET",
        title: "Method",
      },
      headers: { type: "object", title: "Headers", "x-redact": "headers" },
      body: { type: ["object", "string"], title: "Body" },
      timeoutMs: {
        type: "number",
        default: DEFAULT_TIMEOUT_MS,
        minimum: 1,
        maximum: MAX_TIMEOUT_MS,
        title: "Timeout (ms)",
        description: "$dms_automation.types.httpFields.timeoutMs",
      },
      failOnStatus: {
        type: "boolean",
        default: true,
        title: "Fail on an error status",
        description: "$dms_automation.types.httpFields.failOnStatus",
      },
    },
    required: ["url"],
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "number" },
      headers: { type: "object", "x-redact": "headers" },
      body: { type: "string" },
      json: {},
    },
  },
  /**
   * The timeout covers the whole exchange, reading the body included.
   * fetch refuses a body on GET and HEAD: drop it, and say so in the log
   * rather than failing the step with the runtime's cryptic message.
   * An object body is sent as JSON: say so, unless the graph set a type.
   */
  async execute(input, ctx) {
    const method = input.method ?? "GET";
    const url = checkUrl(input.url);
    const headers = toHeaders(input.headers);
    const requested =
      Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs)
        : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(requested, MAX_TIMEOUT_MS);
    if (requested > MAX_TIMEOUT_MS) {
      ctx.log("warn", `timeoutMs capped at ${MAX_TIMEOUT_MS} (5 minutes)`);
    }
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (input.body !== undefined && BODYLESS_METHODS.has(method)) {
      ctx.log("warn", `${method} request: body ignored`);
    } else if (input.body !== undefined) {
      const { body } = input;
      if (isString(body)) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }
    }

    const request = `${method} ${url.href}`;
    let res: Response;
    let body: string;
    try {
      res = await send(url, init);
      body = await readBody(res);
    } catch (err) {
      throw new Error(
        `${request} failed: ${failureReason(err, url, timeoutMs)}`,
        { cause: err },
      );
    }

    const failed = res.status < 200 || res.status >= 300;
    if (failed && input.failOnStatus !== false) {
      if (body) {
        ctx.log("error", "response body", excerpt(body, LOGGED_BODY_CHARS));
      }
      const status = `${res.status} ${res.statusText}`.trim();
      const quoted = body
        ? ` Response: ${excerpt(body, ERROR_EXCERPT_CHARS)}`
        : "";
      throw new Error(
        `${request} → ${status}.${statusHint(res.status)}${quoted}`,
      );
    }
    return {
      status: res.status,
      headers: headersOf(res),
      body,
      json: parseJson(res, body),
    };
  },
};
