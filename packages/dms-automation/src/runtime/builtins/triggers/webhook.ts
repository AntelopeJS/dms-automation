import {
  getRegisteredRouteHandlers,
  HTTPResult,
  ReadBody,
  RegisterRoute,
  type RequestContext,
  type RouteHandler,
  routesProxy,
} from "@antelopejs/interface-api";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { TriggerArmError } from "../../armErrors";
import type { ConfigProblem } from "../../validate";
import {
  type DataRecord,
  type DataValue,
  parseJsonText,
} from "../../../types/dataValue";
import { isString } from "../../../types/guards";

interface WebhookConfig {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
}

interface WebhookOutput {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[]>;
  body: DataValue;
  params: Record<string, string>;
}

interface WebhookHandle {
  routeId: string;
}

const DEFAULT_METHOD = "POST";

/**
 * A webhook answers anyone, without authentication: it must never shadow a
 * route of the server's API or of the DMS. These prefixes are refused even
 * before their routes are registered; any other registered route is found in
 * the router (see webhookRouteConflict).
 */
const RESERVED_PREFIXES = ["/api", "/auth", "/dms", "/modules", "/settings"];
/** Letters, digits, `-._~`, `/` between segments and `:` for route parameters. */
const PATH_PATTERN = /^\/[A-Za-z0-9._~:/-]*$/;
const UNSAFE_SEGMENTS = /\/\/|(^|\/)\.\.?(\/|$)/;

function isReserved(path: string): boolean {
  const lower = path.toLowerCase();
  return RESERVED_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}/`),
  );
}

/** Why a webhook path cannot be served, or undefined when it can. */
export function webhookPathProblem(path: DataValue): ConfigProblem | undefined {
  const value = isString(path) ? path.trim() : "";
  if (!PATH_PATTERN.test(value) || UNSAFE_SEGMENTS.test(value)) {
    return {
      code: "webhookPathInvalid",
      params: { path: value },
      message: `webhook path must start with "/" and use only letters, digits and - . _ ~ : / (got ${JSON.stringify(path ?? "")})`,
    };
  }
  if (isReserved(value)) {
    return {
      code: "webhookPathReserved",
      params: { path: value },
      message: `webhook path ${value} is reserved for the API`,
    };
  }
  return undefined;
}

/**
 * The route a webhook config answers on, as two webhooks compare: the method,
 * and the path without its trailing slash.
 */
export function webhookRouteOf(config: DataRecord | undefined) {
  const configuredMethod = config?.method;
  const configuredPath = config?.path;
  const method = isString(configuredMethod) ? configuredMethod : DEFAULT_METHOD;
  const path = isString(configuredPath) ? configuredPath.trim() : "";
  return { method, path: path.length > 1 ? path.replace(/\/+$/, "") : path };
}

/**
 * The ids of the routes this module's webhooks registered: the save check
 * leaves them out (a procedure's armed webhook is not a conflict with
 * itself), while arming counts them (two webhooks on one route are refused
 * when the second arms).
 */
const armedRoutes = new Set<string>();

const segmentsOf = (path: string) => path.split("/").filter(Boolean);

/** Whether two route paths match the same requests (`:param` matches any). */
function pathsOverlap(a: string, b: string): boolean {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  return (
    left.length === right.length &&
    left.every((segment, i) => {
      const other = right[i] ?? "";
      return (
        segment === other || segment.startsWith(":") || other.startsWith(":")
      );
    })
  );
}

/**
 * The route already registered on the server (a controller of the DMS, of a
 * module, or another webhook) that answers the same requests, as a problem:
 * the webhook would shadow it, or never be called.
 */
export function webhookRouteConflict(
  method: string,
  path: string,
  ownRouteIds: ReadonlySet<string> = new Set(),
): ConfigProblem | undefined {
  const verb = method.toUpperCase();
  const taken = getRegisteredRouteHandlers().some(
    ({ id, handler }) =>
      !ownRouteIds.has(id) &&
      handler.mode === "handler" &&
      [verb, "ALL", "*"].includes(handler.method.toUpperCase()) &&
      pathsOverlap(handler.location, path),
  );
  if (!taken) return undefined;
  return {
    code: "webhookRouteTaken",
    params: { method: verb, path },
    message: `${verb} ${path} already answers for another route of the server`,
  };
}

/** An armed webhook of a procedure: its settings, and whose it is. */
export interface ArmedWebhook {
  config: DataRecord;
  procedure: string;
}

/**
 * A webhook refused for a route another procedure's webhook already holds,
 * reworded to name that procedure (the router knows routes, not
 * procedures). Any other refusal is returned as it is.
 */
export function namedRouteConflict(
  problem: ConfigProblem,
  config: DataRecord,
  armed: Iterable<ArmedWebhook>,
): ConfigProblem {
  if (problem.code !== "webhookRouteTaken") return problem;
  const { method, path } = webhookRouteOf(config);
  for (const other of armed) {
    const route = webhookRouteOf(other.config);
    if (route.method !== method || !pathsOverlap(route.path, path)) continue;
    return {
      code: "webhookPathTaken",
      params: { method, path, procedure: other.procedure },
      message: `${method} ${path} already answers for the procedure "${other.procedure}"`,
    };
  }
  return problem;
}

/** The routes of this module's armed webhooks. */
export function armedWebhookRouteIds(): ReadonlySet<string> {
  return armedRoutes;
}

/** The query string, a key given several times read as a list. */
export function queryOf(url: URL) {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : (values[0] ?? "");
  }
  return query;
}

/** The body as JSON, a decoded form, or the raw text. */
function parseBody(text: string, contentType: string | undefined): DataValue {
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return parseJsonText(text);
  } catch {
    return text;
  }
}

export const webhookTrigger: TriggerType<WebhookConfig, WebhookOutput> = {
  id: "webhook",
  name: "$dms_automation.types.webhook.name",
  description: "$dms_automation.types.webhook.description",
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
        default: DEFAULT_METHOD,
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
  /**
   * An already armed webhook on this route is a conflict like any route:
   * the router would hand every call to the first one.
   */
  async activate(config, emit) {
    const { method, path } = webhookRouteOf({ ...config });
    const problem =
      webhookPathProblem(config.path) ?? webhookRouteConflict(method, path);
    if (problem) throw new TriggerArmError(problem);

    /**
     * A body over the size limit rejects with a 413: the caller is told,
     * and the procedure does not run on a payload it never received.
     */
    const handler: RouteHandler = {
      mode: "handler",
      method,
      location: path,
      parameters: [{ provider: (ctx) => ctx, modifiers: [] }],
      properties: {},
      proto: {},
      callback: async (ctx: RequestContext) => {
        const buf = await ReadBody(ctx);
        const body =
          buf.length > 0
            ? parseBody(
                buf.toString("utf8"),
                ctx.rawRequest.headers["content-type"],
              )
            : undefined;

        emit({
          method: ctx.rawRequest.method ?? method,
          headers: ctx.rawRequest.headers,
          query: queryOf(ctx.url),
          body,
          params: ctx.routeParameters,
        });

        return new HTTPResult(200, { ok: true });
      },
    };

    const routeId = String(RegisterRoute(handler));
    armedRoutes.add(routeId);
    return { routeId } satisfies WebhookHandle;
  },
  async deactivate(h: WebhookHandle | undefined) {
    if (!h?.routeId) return;
    routesProxy.unregister(h.routeId);
    armedRoutes.delete(h.routeId);
  },
};
