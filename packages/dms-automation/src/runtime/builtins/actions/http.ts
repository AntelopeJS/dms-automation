import type { ActionType } from "@antelopejs/interface-dms-automation";

interface HttpInput {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
}

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

interface HttpOutput {
  status: number;
  body: string;
}

export const httpAction: ActionType<HttpInput, HttpOutput> = {
  id: "http.request",
  name: "$dms_automation.types.http.name",
  description: "$dms_automation.types.http.description",
  icon: "i-ph-globe",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        default: "GET",
      },
      headers: { type: "object" },
      body: { type: ["object", "string"] },
    },
    required: ["url"],
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "number" },
      body: { type: "string" },
    },
  },
  async execute(input, ctx) {
    const method = input.method ?? "GET";
    const headers = new Headers(input.headers);
    const init: RequestInit = { method, headers };
    // fetch refuses a body on GET and HEAD: drop it, and say so in the log
    // rather than failing the step with the runtime's cryptic message.
    if (input.body !== undefined && BODYLESS_METHODS.has(method)) {
      ctx.log("warn", `${method} request: body ignored`);
    } else if (input.body !== undefined) {
      const isText = typeof input.body === "string";
      init.body = isText ? (input.body as string) : JSON.stringify(input.body);
      // An object body is sent as JSON: say so, unless the graph set a type.
      if (!isText && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
    const res = await fetch(input.url, init);
    const body = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }
    return { status: res.status, body };
  },
};
