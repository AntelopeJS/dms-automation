import { HTTPResult } from "@antelopejs/interface-api";
import { z } from "zod";
import { nodeKindZodSchema } from "../runtime/nodeKinds";
import {
  MAX_GROUP_DEPTH,
  type ValidateResult,
  validateGraph,
} from "../runtime/validate";
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

const triggerEdgeSchema = z.object({
  id: z.string(),
  from: z.object({ node: z.string(), branch: z.string().optional() }),
  // `to.branch` carries the target's trigger-in port name when the
  // target is a group node or groupOutput sentinel. Optional otherwise.
  to: z.object({ node: z.string(), branch: z.string().optional() }),
});

const dataEdgeSchema = z.object({
  id: z.string(),
  from: z.object({ node: z.string(), port: z.string() }),
  to: z.object({ node: z.string(), field: z.string() }),
});

/**
 * How deep the local groups of a raw graph nest, counted without recursion
 * and stopping past `max`: a hostile body nesting thousands of groups must be
 * refused before the recursive schema below walks it.
 */
function groupDepthOf(value: unknown, max: number): number {
  let deepest = 0;
  const pending: { graph: unknown; depth: number }[] = [
    { graph: value, depth: 0 },
  ];
  while (pending.length > 0) {
    const { graph, depth } = pending.pop() as (typeof pending)[number];
    deepest = Math.max(deepest, depth);
    if (deepest > max) return deepest;
    const nodes = (graph as { nodes?: unknown } | null)?.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      const subgraph = (node as { subgraph?: unknown } | null)?.subgraph;
      if (subgraph) pending.push({ graph: subgraph, depth: depth + 1 });
    }
  }
  return deepest;
}

const graphShapeSchema: z.ZodType<ProcedureGraph> = z.lazy(() =>
  z.object({
    nodes: z.array(graphNodeSchema),
    triggerEdges: z.array(triggerEdgeSchema),
    dataEdges: z.array(dataEdgeSchema),
  }),
);

export const procedureGraphSchema: z.ZodType<
  ProcedureGraph,
  z.ZodTypeDef,
  unknown
> = z
  .unknown()
  .refine((graph) => groupDepthOf(graph, MAX_GROUP_DEPTH) <= MAX_GROUP_DEPTH, {
    message: `groups are nested more than ${MAX_GROUP_DEPTH} levels deep`,
  })
  .pipe(graphShapeSchema);

const graphNodeSchema: z.ZodType<GraphNode> = z.lazy(() =>
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
      subgraph: graphShapeSchema.optional(),
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
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
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
