import { HTTPResult } from "@antelopejs/interface-api";
import { z } from "zod";
import { nodeKindZodSchema } from "../runtime/nodeKinds";
import {
  MAX_GROUP_DEPTH,
  type ValidateResult,
  validateGraph,
} from "../runtime/validate";
import type { DataValue } from "../types/dataValue";
import type { GraphNode, GroupPort, ProcedureGraph } from "../types/graph";
import { isObject } from "../types/guards";

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

/**
 * `to.branch` carries the target's trigger-in port name when the
 * target is a group node or groupOutput sentinel. Optional otherwise.
 */
const triggerEdgeSchema = z.object({
  id: z.string(),
  from: z.object({ node: z.string(), branch: z.string().optional() }),
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
  for (let item = pending.pop(); item; item = pending.pop()) {
    const { graph, depth } = item;
    deepest = Math.max(deepest, depth);
    if (deepest > max) return deepest;
    const nodes = isObject(graph) && "nodes" in graph ? graph.nodes : undefined;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      const subgraph =
        isObject(node) && "subgraph" in node ? node.subgraph : undefined;
      if (subgraph) pending.push({ graph: subgraph, depth: depth + 1 });
    }
  }
  return deepest;
}

const graphBodySchema: z.ZodType<ProcedureGraph> = z.lazy(() =>
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
  .pipe(graphBodySchema);

/**
 * group-specific fields — accepted but only meaningful when kind === "group"
 *
 * Allow other transient fields (e.g. UI metadata) without rejecting.
 */
const graphNodeSchema: z.ZodType<GraphNode> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      kind: nodeKindSchema,
      typeId: z.string().optional(),
      config: z.record(z.unknown()),
      position: z.object({ x: z.number(), y: z.number() }),
      templateId: z.string().optional(),
      ports: z.array(z.lazy(() => groupPortSchema)).optional(),
      subgraph: graphBodySchema.optional(),
    })
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
  body: DataValue,
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
