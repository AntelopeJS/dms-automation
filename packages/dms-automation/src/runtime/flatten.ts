import type {
  DataEdge,
  GroupNode,
  ProcedureGraph,
  TriggerEdge,
} from "../types/graph";
import { triggerEdgeEnd } from "../types/graph";
import { resolveSubgraph, type TemplateCache } from "./resolveSubgraph";

/**
 * Recursion guard. Template reference cycles are caught by validateTemplate
 * at save time; this is the runtime backstop.
 */
const MAX_FLATTEN_DEPTH = 32;

/**
 * Recursively rewrite a ProcedureGraph by inlining every group node into
 * its parent: inner non-sentinel nodes get prefixed ids, internal inner
 * edges get re-emitted with prefixed endpoints, and every outer edge that
 * touched a group's boundary is rewired to point directly at the inner
 * node(s) that produce / consume it.
 *
 * The output graph contains no `group` / `groupInput` / `groupOutput`
 * nodes, so the executor never has to special-case them. Groups remain a
 * pure editor-time organization tool.
 *
 * Nested groups are handled by flattening bottom-up: each group's
 * subgraph is recursively flattened before that group is inlined into
 * its parent, so prefixes compose (`<outerId>__<innerId>__<leafId>`).
 *
 * Templates are resolved via `templateCache`, same as before — a template
 * instance's `subgraph` is fetched from the cache and then flattened
 * identically to a local-subgraph group.
 */
export function flattenGroups(
  graph: ProcedureGraph,
  templateCache?: TemplateCache,
): ProcedureGraph {
  return flattenInner(graph, templateCache, 0);
}

interface Expansion {
  flatInner: ProcedureGraph;
  groupInputId: string;
  groupOutputId: string;
  prefix: string;
}

function flattenInner(
  graph: ProcedureGraph,
  templateCache: TemplateCache | undefined,
  depth: number,
): ProcedureGraph {
  if (depth >= MAX_FLATTEN_DEPTH) {
    throw new Error(
      `flatten depth exceeded (>${MAX_FLATTEN_DEPTH}); likely a template reference cycle`,
    );
  }

  const result: ProcedureGraph = {
    nodes: [],
    triggerEdges: [],
    dataEdges: [],
  };

  const expansions = new Map<string, Expansion>();

  // Pass 1: walk nodes. Non-group nodes pass through; group nodes get their
  // subgraph recursively flattened and their inner non-sentinel nodes
  // added with prefixed ids. Sentinel nodes are dropped — outer edges
  // touching the group boundary are rewritten in Pass 2.
  for (const node of graph.nodes) {
    if (node.kind !== "group") {
      result.nodes.push(node);
      continue;
    }
    expandGroupNode(
      node as GroupNode,
      templateCache,
      depth,
      result,
      expansions,
    );
  }

  // Pass 2: rewrite outer edges. For each outer edge, compute the
  // effective source(s) and target(s) by expanding group endpoints, then
  // emit the cartesian product. Outer edges with neither endpoint a group
  // pass through unchanged.
  for (const e of graph.triggerEdges) {
    rewriteTriggerEdge(e, expansions, result.triggerEdges);
  }
  for (const e of graph.dataEdges) {
    rewriteDataEdge(e, expansions, result.dataEdges);
  }

  return result;
}

/**
 * Flattens one group node into `result` and records how it was expanded, so
 * Pass 2 can rewrite the outer edges that touch its boundary.
 *
 * The group's own sentinel nodes are dropped and its inner nodes re-emitted
 * under a `<groupId>__` prefix. Inner edges are emitted here only when neither
 * endpoint is a sentinel: the sentinel-touching ones carry the boundary and are
 * consumed by the outer-edge rewrite instead.
 */
function expandGroupNode(
  groupNode: GroupNode,
  templateCache: TemplateCache | undefined,
  depth: number,
  result: ProcedureGraph,
  expansions: Map<string, Expansion>,
): void {
  const subgraph = resolveSubgraph(
    groupNode,
    templateCache ?? { get: () => undefined },
  );
  const flatInner = flattenInner(subgraph, templateCache, depth + 1);

  const giNode = flatInner.nodes.find((n) => n.kind === "groupInput");
  const goNode = flatInner.nodes.find((n) => n.kind === "groupOutput");
  if (!giNode) {
    throw new Error(
      `flatten: group "${groupNode.id}" subgraph missing groupInput sentinel`,
    );
  }
  if (!goNode) {
    throw new Error(
      `flatten: group "${groupNode.id}" subgraph missing groupOutput sentinel`,
    );
  }

  const prefix = `${groupNode.id}__`;
  const touchesSentinel = (nodeId: string): boolean =>
    nodeId === giNode.id || nodeId === goNode.id;

  for (const inner of flatInner.nodes) {
    if (inner.kind === "groupInput" || inner.kind === "groupOutput") continue;
    result.nodes.push({ ...inner, id: prefix + inner.id });
  }

  for (const e of flatInner.triggerEdges) {
    if (touchesSentinel(e.from.node) || touchesSentinel(e.to.node)) continue;
    result.triggerEdges.push({
      id: prefix + e.id,
      from: triggerEdgeEnd(prefix + e.from.node, e.from.branch),
      to: triggerEdgeEnd(prefix + e.to.node, e.to.branch),
    });
  }

  for (const e of flatInner.dataEdges) {
    if (touchesSentinel(e.from.node) || touchesSentinel(e.to.node)) continue;
    result.dataEdges.push({
      id: prefix + e.id,
      from: { node: prefix + e.from.node, port: e.from.port },
      to: { node: prefix + e.to.node, field: e.to.field },
    });
  }

  expansions.set(groupNode.id, {
    flatInner,
    groupInputId: giNode.id,
    groupOutputId: goNode.id,
    prefix,
  });
}

function rewriteTriggerEdge(
  e: TriggerEdge,
  expansions: Map<string, Expansion>,
  out: TriggerEdge[],
): void {
  const sourceExp = expansions.get(e.from.node);
  const targetExp = expansions.get(e.to.node);

  // Effective sources: (node, branch?, edgeIdSuffix). For a group source,
  // each inner edge into groupOutput at the matching port contributes a
  // direct source — its writer node + writer port — to the rewritten edge.
  type SourceEnd = { node: string; branch?: string; idSuffix: string };
  const sources: SourceEnd[] = [];
  if (sourceExp) {
    const outerPort = e.from.branch;
    for (const innerE of sourceExp.flatInner.triggerEdges) {
      if (innerE.to.node !== sourceExp.groupOutputId) continue;
      // The outer trigger-out port name lives on the inner edge's
      // `to.branch` — edges into a groupOutput sentinel always carry it.
      const innerOuterPort = innerE.to.branch;
      if (innerOuterPort !== outerPort) continue;
      sources.push({
        ...triggerEdgeEnd(
          sourceExp.prefix + innerE.from.node,
          innerE.from.branch,
        ),
        idSuffix: `src:${innerE.id}`,
      });
    }
    if (sources.length === 0) return; // Group source port has no inner writer.
  } else {
    sources.push({
      ...triggerEdgeEnd(e.from.node, e.from.branch),
      idSuffix: "",
    });
  }

  type TargetEnd = { node: string; branch?: string; idSuffix: string };
  const targets: TargetEnd[] = [];
  if (targetExp) {
    const outerPort = e.to.branch;
    for (const innerE of targetExp.flatInner.triggerEdges) {
      if (innerE.from.node !== targetExp.groupInputId) continue;
      if (innerE.from.branch !== outerPort) continue;
      targets.push({
        ...triggerEdgeEnd(targetExp.prefix + innerE.to.node, innerE.to.branch),
        idSuffix: `tgt:${innerE.id}`,
      });
    }
    if (targets.length === 0) return; // Group target port has no inner consumer.
  } else {
    targets.push({ ...triggerEdgeEnd(e.to.node, e.to.branch), idSuffix: "" });
  }

  for (const src of sources) {
    for (const tgt of targets) {
      const idParts = [e.id, src.idSuffix, tgt.idSuffix].filter(
        (s) => s.length > 0,
      );
      out.push({
        id: idParts.join("__"),
        from: triggerEdgeEnd(src.node, src.branch),
        to: triggerEdgeEnd(tgt.node, tgt.branch),
      });
    }
  }
}

function rewriteDataEdge(
  e: DataEdge,
  expansions: Map<string, Expansion>,
  out: DataEdge[],
): void {
  const sourceExp = expansions.get(e.from.node);
  const targetExp = expansions.get(e.to.node);

  type SourceEnd = { node: string; port: string; idSuffix: string };
  const sources: SourceEnd[] = [];
  if (sourceExp) {
    // The outer edge originates from `group.<port>`. Find the inner data
    // edge that writes into groupOutput at that field; its source is the
    // effective source. Validator restricts data-out ports to one writer,
    // so this typically yields one entry.
    const outerPort = e.from.port;
    for (const innerE of sourceExp.flatInner.dataEdges) {
      if (innerE.to.node !== sourceExp.groupOutputId) continue;
      if (innerE.to.field !== outerPort) continue;
      sources.push({
        node: sourceExp.prefix + innerE.from.node,
        port: innerE.from.port,
        idSuffix: `src:${innerE.id}`,
      });
    }
    if (sources.length === 0) return; // Unwired group data-out port; skip.
  } else {
    sources.push({ node: e.from.node, port: e.from.port, idSuffix: "" });
  }

  type TargetEnd = { node: string; field: string; idSuffix: string };
  const targets: TargetEnd[] = [];
  if (targetExp) {
    // The outer edge targets `group.<field>` (data-in). Find every inner
    // data edge reading from groupInput at that port; each is an inner
    // consumer. Possibly multiple — fan out to all of them.
    const outerPort = e.to.field;
    for (const innerE of targetExp.flatInner.dataEdges) {
      if (innerE.from.node !== targetExp.groupInputId) continue;
      if (innerE.from.port !== outerPort) continue;
      targets.push({
        node: targetExp.prefix + innerE.to.node,
        field: innerE.to.field,
        idSuffix: `tgt:${innerE.id}`,
      });
    }
    if (targets.length === 0) return; // Unwired group data-in port.
  } else {
    targets.push({ node: e.to.node, field: e.to.field, idSuffix: "" });
  }

  for (const src of sources) {
    for (const tgt of targets) {
      const idParts = [e.id, src.idSuffix, tgt.idSuffix].filter(
        (s) => s.length > 0,
      );
      out.push({
        id: idParts.join("__"),
        from: { node: src.node, port: src.port },
        to: { node: tgt.node, field: tgt.field },
      });
    }
  }
}
