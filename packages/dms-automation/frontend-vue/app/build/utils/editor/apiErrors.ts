import type { GraphIssue } from "../../types/editor";

export interface SaveRefusal {
  data?: {
    issues?: Array<
      | {
          severity?: string;
          message?: string;
          code?: string;
          params?: Record<string, unknown>;
          nodeId?: string;
          path?: unknown[];
        }
      | string
    >;
  };
}

export function issuesOf(error: unknown): GraphIssue[] | null {
  const raw = (error as SaveRefusal)?.data?.issues;
  if (!Array.isArray(raw)) return null;
  // A field of the body other than the graph (zod issues carry its path) is
  // not a problem of the graph.
  if (
    raw.some(
      (issue) =>
        typeof issue === "object" &&
        Array.isArray(issue.path) &&
        issue.path[0] !== "graph",
    )
  )
    return null;
  return raw.map((issue) =>
    typeof issue === "string"
      ? { severity: "error" as const, message: issue }
      : {
          severity: issue.severity === "warning" ? "warning" : "error",
          message: issue.message ?? "",
          code: issue.code,
          params: issue.params,
          nodeId: issue.nodeId,
        },
  );
}

// Render the 400 body from src/routes/templates.ts:
//   - Zod failure → { error: 'invalid body', issues: ZodIssue[] }
//   - validateGraph failure → { error: 'invalid graph', issues: string[] }
//   - cycle → { error: 'template reference cycle', cycle: string[] }
// Other errors (network, 401, 500) fall back to the message string.
export function formatTemplateError(err: unknown): string {
  const data = (err as { data?: unknown; message?: string } | undefined)
    ?.data as
    | {
        error?: string;
        issues?: Array<
          { path?: Array<string | number>; message?: string } | string
        >;
        cycle?: string[];
      }
    | undefined;
  if (data && typeof data === "object") {
    const head = data.error ?? "Request failed";
    if (Array.isArray(data.issues) && data.issues.length > 0) {
      const lines = data.issues.map((iss) => {
        if (typeof iss === "string") return iss;
        const path = Array.isArray(iss.path) ? iss.path.join(".") : "";
        const msg = iss.message ?? "invalid";
        return path ? `${path}: ${msg}` : msg;
      });
      return `${head}\n${lines.join("\n")}`;
    }
    if (Array.isArray(data.cycle) && data.cycle.length > 0) {
      return `${head}: ${data.cycle.join(" → ")}`;
    }
    return head;
  }
  return describeApiError(err);
}

export function formatForkError(err: unknown): string {
  const status = err as { statusCode?: number; status?: number } | undefined;
  const code = status?.statusCode ?? status?.status;
  if (code === 404) {
    return "This template no longer exists. It may have been deleted by another user.";
  }
  const data = (err as { data?: { error?: string } } | undefined)?.data;
  if (data?.error) return data.error;
  return describeApiError(err);
}
