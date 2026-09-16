import { HTTPResult } from "@antelopejs/interface-api";
import { z } from "zod";
import { nodeKindZodSchema } from "../runtime/nodeKinds";
import { type ValidateResult, validateGraph } from "../runtime/validate";
import type { GraphNode, GroupPort, ProcedureGraph } from "../types/graph";

/**
 * Shared Zod schemas for ProcedureGraph and its constituents. Imported by
 * both `routes/procedures.ts` and `routes/templates.ts` so the two stay
 * in lockstep (the previous hand-duplicated copies had already drifted —
 * procedures was accepting `z.record(z.unknown())` for ports while
 * templates used the typed groupPortSchema).
 */

const nodeKindSchema = nodeKindZodSchema();

export const groupPortSchema: z.ZodType<GroupPort> = z.object({
  name: z.string().min(1),
  kind: z.enum(["data", "trigger"]),
  direction: z.enum(["in", "out"]),
  schema: z.record(z.unknown()).optional(),
});

export const triggerEdgeSchema = z.object({
  id: z.string(),
  from: z.object({ node: z.string(), branch: z.string().optional() }),
  // `to.branch` carries the target's trigger-in port name when the
  // target is a group node or groupOutput sentinel. Optional otherwise.
  to: z.object({ node: z.string(), branch: z.string().optional() }),
});

export const dataEdgeSchema = z.object({
  id: z.string(),
  from: z.object({ node: z.string(), port: z.string() }),
  to: z.object({ node: z.string(), field: z.string() }),
});

export const procedureGraphSchema: z.ZodType<ProcedureGraph> = z.lazy(() =>
  z.object({
    nodes: z.array(graphNodeSchema),
    triggerEdges: z.array(triggerEdgeSchema),
    dataEdges: z.array(dataEdgeSchema),
  }),
);

export const graphNodeSchema: z.ZodType<GraphNode> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      kind: nodeKindSchema,
      typeId: z.string().optional(),
      config: z.record(z.unknown()),
      position: z.object({ x: z.number(), y: z.number() }),
      // group-specific fields — accepted but only meaningful when kind === "group"
      templateId: z.string().optional(),
      ports: z.array(z.lazy(() => groupPortSchema)).optional(),
      subgraph: procedureGraphSchema.optional(),
    })
    // Allow other transient fields (e.g. UI metadata) without rejecting.
    .passthrough(),
) as z.ZodType<GraphNode>;

/**
 * Parse `body` against `schema`, run graph validation on whatever the
 * caller selects out of the parsed shape, and throw HTTPResult(400)
 * with structured issues on either failure. Used by both procedures
 * and templates routes.
 */
export function parseAndValidate<T>(
  schema: z.ZodType<T>,
  body: unknown,
  graphSelector: (data: T) => ProcedureGraph,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPResult(400, {
      error: "invalid body",
      issues: parsed.error.issues,
    });
  }
  const verdict: ValidateResult = validateGraph(graphSelector(parsed.data));
  if (!verdict.ok) {
    throw new HTTPResult(400, {
      error: "invalid graph",
      issues: verdict.errors,
    });
  }
  return parsed.data;
}
