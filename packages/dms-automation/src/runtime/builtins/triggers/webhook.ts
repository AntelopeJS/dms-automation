import {
  HTTPResult,
  ReadBody,
  RegisterRoute,
  type RequestContext,
  type RouteHandler,
  routesProxy,
} from "@antelopejs/interface-api";
import type { TriggerType } from "@antelopejs/interface-dms-automation";

interface WebhookConfig {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
}

interface WebhookOutput {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string>;
  body: unknown;
  params: Record<string, string>;
}

interface WebhookHandle {
  routeId: string;
}

export const webhookTrigger: TriggerType<WebhookConfig, WebhookOutput> = {
  id: "webhook",
  name: "Webhook",
  description:
    "Registers an HTTP endpoint that fires the procedure on each request",
  icon: "i-ph-webhooks-logo",
  cluster: "replicated",
  configSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to register, e.g. /webhooks/my-event",
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        default: "POST",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      method: { type: "string" },
      headers: { type: "object" },
      query: { type: "object" },
      body: {},
      params: { type: "object" },
    },
  },
  async activate(config, emit) {
    const path = (config.path ?? "").trim();
    if (!path || !path.startsWith("/")) {
      throw new Error(
        `webhook path must be a non-empty string starting with "/" (got ${JSON.stringify(config.path)})`,
      );
    }
    const method = config.method ?? "POST";

    const handler: RouteHandler = {
      mode: "handler",
      method,
      location: path,
      parameters: [{ provider: (ctx) => ctx, modifiers: [] }],
      properties: {},
      proto: {},
      callback: async (ctx: RequestContext) => {
        let body: unknown;
        try {
          const buf = await ReadBody(ctx);
          if (buf && buf.length > 0) {
            const text = buf.toString("utf8");
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
        } catch {
          // best-effort body read; ignore parse errors
        }

        const query: Record<string, string> = {};
        ctx.url.searchParams.forEach((v, k) => {
          query[k] = v;
        });

        emit({
          method: ctx.rawRequest.method ?? method,
          headers: ctx.rawRequest.headers,
          query,
          body,
          params: ctx.routeParameters,
        });

        return new HTTPResult(200, { ok: true });
      },
    };

    const id = RegisterRoute(handler);
    return { routeId: String(id) } satisfies WebhookHandle;
  },
  async deactivate(handle) {
    const h = handle as WebhookHandle | undefined;
    if (!h?.routeId) return;
    routesProxy.unregister(h.routeId);
  },
};
