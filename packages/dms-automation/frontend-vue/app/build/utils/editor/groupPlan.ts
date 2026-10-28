import type { NodeKindEntry } from "../../../composables/useAutomationNodeKinds";
import type {
  ActionType,
  DataEdge,
  DataNodeType,
  GroupPort,
  JsonSchema,
  JsonSchemaProperty,
  ProcedureGraph,
  TriggerEdge,
  TriggerType,
} from "../../../composables/useGraphConnect";
import { newId } from "../../../utils/automation";

/** What the schema lookups read, each as the editor's computed holds it. */
export interface SchemaSources {
  readonly currentGraph: { readonly value: ProcedureGraph | null };
  readonly nodeKinds: { readonly value: NodeKindEntry[] };
  readonly triggerTypes: { readonly value: TriggerType[] };
  readonly actionTypes: { readonly value: ActionType[] };
  readonly dataNodeTypes: { readonly value: DataNodeType[] };
}

// Friendly default port names. Each cut edge maps to a desired name based on
// the user-facing label on the cut side; if two edges land on the same name
// (e.g. two inside actions both have an `input` field), we suffix `-2`, `-3`
// per (kind, direction). The user can rename later in the GroupPortEditor.
//
// Port name picks:
//   data-in    → target node's input field name
//   data-out   → source node's output port name
//   trigger-in → source branch label if present, else 'main'
//   trigger-out → source branch label if present, else 'main'
//
// The "main" default for non-branching trigger cuts is intentional: the
// GroupNode / sentinel renderers place a trigger port named "main" on the
// title bar (mirroring ordinary trigger/action nodes), so a typical group
// wrapping linear flow looks just like a single action — title-bar in/out.
// Branch-labeled ports (if.then, switch.<case>, …) render in the body.
export function desiredPortNameForTrigger(branch: string | undefined): string {
  return branch && branch.length > 0 ? branch : "main";
}

// Dedup against an already-declared set scoped to (kind, direction). The set
// is mutated as new names are reserved.
export function uniqueName(desired: string, taken: Set<string>): string {
  if (!taken.has(desired)) {
    taken.add(desired);
    return desired;
  }
  let i = 2;
  while (taken.has(`${desired}-${i}`)) i++;
  const final = `${desired}-${i}`;
  taken.add(final);
  return final;
}

export interface NewGroupPlan {
  groupId: string;
  groupPorts: GroupPort[];
  // Sentinel node ids — the planner generates them up front so its inner
  // edges reference real ids; the caller installs the sentinel nodes
  // under these ids.
  groupInputId: string;
  groupOutputId: string;
  // Edges to add to the outer graph (replacements for cut edges).
  outerTriggerEdges: TriggerEdge[];
  outerDataEdges: DataEdge[];
  // Edges to add inside the new subgraph (connecting sentinels to the
  // inner endpoints of the cut edges).
  innerTriggerEdges: TriggerEdge[];
  innerDataEdges: DataEdge[];
}

// Build a JsonSchema property bag from a kind's declared static port
// list — used as the fallback when no type-registry schema applies.
export function staticPortsToSchema(
  ports: ReadonlyArray<{ name: string; type?: string }>,
): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const p of ports) {
    properties[p.name] = p.type ? { type: p.type } : {};
  }
  return { properties };
}

export function findSchemaForDataSourcePort(
  sources: SchemaSources,
  nodeId: string,
  port: string,
): JsonSchema | undefined {
  const { currentGraph, nodeKinds, triggerTypes, actionTypes, dataNodeTypes } =
    sources;
  const g = currentGraph.value;
  if (!g) return undefined;
  const node = g.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  // `group` carries its ports on the node itself, not in the kind registry.
  if (node.kind === "group") {
    const p = (node.ports ?? []).find(
      (pp) => pp.kind === "data" && pp.direction === "out" && pp.name === port,
    );
    return p?.schema as JsonSchema | undefined;
  }
  const ui = nodeKinds.value.find((k) => k.kind === node.kind)?.meta.ui;
  if (!ui) return undefined;
  let outputSchema: JsonSchema | undefined;
  if (ui.typeRegistry && ui.dataOutsFromTypeSchema) {
    const key = ui.dataOutsFromTypeSchema;
    if (ui.typeRegistry === "triggers") {
      const t = triggerTypes.value.find((tt) => tt.id === node.typeId) as
        | Record<string, JsonSchema | undefined>
        | undefined;
      outputSchema = t?.[key];
    } else if (ui.typeRegistry === "actions") {
      const a = actionTypes.value.find((aa) => aa.id === node.typeId) as
        | Record<string, JsonSchema | undefined>
        | undefined;
      outputSchema = a?.[key];
    } else {
      const d = dataNodeTypes.value.find((dd) => dd.id === node.typeId) as
        | Record<string, JsonSchema | undefined>
        | undefined;
      outputSchema = d?.[key];
    }
  }
  if (!outputSchema && ui.staticDataOuts.length > 0) {
    outputSchema = staticPortsToSchema(ui.staticDataOuts);
  }
  const prop = outputSchema?.properties?.[port];
  if (!prop) return undefined;
  return prop as JsonSchema;
}

export function findSchemaForDataTargetField(
  sources: SchemaSources,
  nodeId: string,
  field: string,
): JsonSchema | undefined {
  const { currentGraph, nodeKinds, triggerTypes, actionTypes, dataNodeTypes } =
    sources;
  const g = currentGraph.value;
  if (!g) return undefined;
  const node = g.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  if (node.kind === "group") {
    const p = (node.ports ?? []).find(
      (pp) => pp.kind === "data" && pp.direction === "in" && pp.name === field,
    );
    return p?.schema as JsonSchema | undefined;
  }
  const ui = nodeKinds.value.find((k) => k.kind === node.kind)?.meta.ui;
  if (!ui) return undefined;
  let inputSchema: JsonSchema | undefined;
  if (ui.typeRegistry && ui.dataInsFromTypeSchema) {
    const key = ui.dataInsFromTypeSchema;
    if (ui.typeRegistry === "actions") {
      const a = actionTypes.value.find((aa) => aa.id === node.typeId) as
        | Record<string, JsonSchema | undefined>
        | undefined;
      inputSchema = a?.[key];
    } else if (ui.typeRegistry === "dataNodes") {
      const d = dataNodeTypes.value.find((dd) => dd.id === node.typeId) as
        | Record<string, JsonSchema | undefined>
        | undefined;
      inputSchema = d?.[key];
    } else {
      const t = triggerTypes.value.find((tt) => tt.id === node.typeId) as
        | Record<string, JsonSchema | undefined>
        | undefined;
      inputSchema = t?.[key];
    }
  }
  if (!inputSchema && ui.staticDataIns.length > 0) {
    inputSchema = staticPortsToSchema(ui.staticDataIns);
  }
  const prop = inputSchema?.properties?.[field];
  if (!prop) return undefined;
  return prop as JsonSchema;
}

export function planNewGroup(
  g: ProcedureGraph,
  selection: Set<string>,
  groupId: string,
  sources: SchemaSources,
): NewGroupPlan {
  const ports: GroupPort[] = [];
  const outerTriggerEdges: TriggerEdge[] = [];
  const outerDataEdges: DataEdge[] = [];
  const innerTriggerEdges: TriggerEdge[] = [];
  const innerDataEdges: DataEdge[] = [];

  // Per (kind, direction) name reservations — keeps dedup scoped so a
  // data-in "input" and a data-out "output" can coexist even if a
  // hypothetical trigger-in shared the same desired label.
  const takenDataIn = new Set<string>();
  const takenDataOut = new Set<string>();
  const takenTriggerIn = new Set<string>();
  const takenTriggerOut = new Set<string>();

  // We need sentinel ids that match the ones syncSentinels will (re)use.
  // Generate them up front so the inner edges below can reference them;
  // then we splat them into the subgraph and let syncSentinels see them
  // already in place.
  const groupInputId = newId();
  const groupOutputId = newId();

  for (const e of g.triggerEdges) {
    const fromIn = selection.has(e.from.node);
    const toIn = selection.has(e.to.node);
    if (fromIn === toIn) continue; // both inside or both outside → not cut
    if (fromIn && !toIn) {
      // Cut: source inside, target outside → declare trigger-out port.
      const name = uniqueName(
        desiredPortNameForTrigger(e.from.branch),
        takenTriggerOut,
      );
      ports.push({ kind: "trigger", direction: "out", name });
      // Outer: new edge from the OUTER group node's trigger-out handle
      // to the original target node. `from.branch` IS the port name —
      // matches how connect parses `group-trigger-out-<port>`.
      outerTriggerEdges.push({
        id: newId(),
        from: { node: groupId, branch: name },
        to: { node: e.to.node },
      });
      // Inner: original source node fires into groupOutput. Source-side
      // branch is preserved verbatim (for if/switch routing); target
      // port name lives on `to.branch` so the renderer can pick the
      // right `groupOutput-trigger-in-<port>` handle.
      innerTriggerEdges.push({
        id: newId(),
        from: { node: e.from.node, branch: e.from.branch },
        to: { node: groupOutputId, branch: name },
      });
    } else {
      // Cut: source outside, target inside → declare trigger-in port.
      const name = uniqueName(
        desiredPortNameForTrigger(e.from.branch),
        takenTriggerIn,
      );
      ports.push({ kind: "trigger", direction: "in", name });
      // Outer: original source node fires into OUTER group node's
      // trigger-in handle. Port name lives on `to.branch` (rendered as
      // `group-trigger-in-<port>` via the renderer).
      outerTriggerEdges.push({
        id: newId(),
        from: { node: e.from.node, branch: e.from.branch },
        to: { node: groupId, branch: name },
      });
      // Inner: groupInput fires into original target. Port name lives
      // on `from.branch` — matches the syncSentinels filter for
      // trigger edges out of groupInput.
      innerTriggerEdges.push({
        id: newId(),
        from: { node: groupInputId, branch: name },
        to: { node: e.to.node },
      });
    }
  }

  for (const e of g.dataEdges) {
    const fromIn = selection.has(e.from.node);
    const toIn = selection.has(e.to.node);
    if (fromIn === toIn) continue;
    if (fromIn && !toIn) {
      // Cut: source inside, target outside → declare data-out port.
      const name = uniqueName(e.from.port, takenDataOut);
      ports.push({
        kind: "data",
        direction: "out",
        name,
        schema: findSchemaForDataSourcePort(sources, e.from.node, e.from.port),
      });
      // Outer: group node's data-out → original target field.
      outerDataEdges.push({
        id: newId(),
        from: { node: groupId, port: name },
        to: { node: e.to.node, field: e.to.field },
      });
      // Inner: original source → groupOutput's data-in port (name).
      innerDataEdges.push({
        id: newId(),
        from: { node: e.from.node, port: e.from.port },
        to: { node: groupOutputId, field: name },
      });
    } else {
      // Cut: source outside, target inside → declare data-in port.
      const name = uniqueName(e.to.field, takenDataIn);
      ports.push({
        kind: "data",
        direction: "in",
        name,
        schema: findSchemaForDataTargetField(sources, e.to.node, e.to.field),
      });
      // Outer: original source → group node's data-in port.
      outerDataEdges.push({
        id: newId(),
        from: { node: e.from.node, port: e.from.port },
        to: { node: groupId, field: name },
      });
      // Inner: groupInput's data-out → original target field.
      innerDataEdges.push({
        id: newId(),
        from: { node: groupInputId, port: name },
        to: { node: e.to.node, field: e.to.field },
      });
    }
  }

  return {
    groupId,
    groupPorts: ports,
    groupInputId,
    groupOutputId,
    outerTriggerEdges,
    outerDataEdges,
    innerTriggerEdges,
    innerDataEdges,
  };
}
