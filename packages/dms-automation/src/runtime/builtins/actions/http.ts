import type { ActionType } from "@antelopejs/interface-dms-automation";

interface HttpInput {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
}

interface HttpOutput {
  status: number;
  body: string;
}

export const httpAction: ActionType<HttpInput, HttpOutput> = {
  id: "http.request",
  name: "HTTP Request",
  description: "Make an HTTP request",
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
  async execute(input) {
    const method = input.method ?? "GET";
    const init: RequestInit = { method, headers: input.headers };
    if (input.body !== undefined) {
      init.body =
        typeof input.body === "string"
          ? input.body
          : JSON.stringify(input.body);
    }
    const res = await fetch(input.url, init);
    const body = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
    return { status: res.status, body };
  },
};
