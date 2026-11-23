import type { NodeKindEntry } from "../../../composables/useAutomationNodeKinds";
import {
  schemaFromKind,
  type ActionType,
  type DataEdge,
  type DataNodeType,
  type GroupPort,
  type JsonSchema,
  type ProcedureGraph,
  type TriggerEdge,
  type TriggerType,
  type TypeCatalog,
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

/**
 * The port name a cut trigger edge gets: its source branch label if present,
 * else "main". The "main" default for non-branching cuts is intentional: the
 * GroupNode / sentinel renderers place a trigger port named "main" on the
 * title bar (mirroring ordinary trigger/action nodes), so a group wrapping a
 * linear flow looks just like a single action. Branch-labeled ports (if.then,
 * switch.<case>, …) render in the body.
 */
export function desiredPortNameForTrigger(branch: string | undefined): string {
  return branch && branch.length > 0 ? branch : "main";
}

/**
 * `desired`, or the first free `desired-2`, `desired-3`… among the `taken`
 * names of one (kind, direction), which this reserves the result in. The user
 * can rename a port later in the GroupPortEditor.
 */
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
  /** The input sentinel's id, generated up front so the inner edges reference it; the caller installs the sentinel under it. */
  groupInputId: string;
  /** The output sentinel's id, generated up front like `groupInputId`. */
  groupOutputId: string;
  /** Trigger edges to add to the outer graph, replacing the cut ones. */
  outerTriggerEdges: TriggerEdge[];
  /** Data edges to add to the outer graph, replacing the cut ones. */
  outerDataEdges: DataEdge[];
  /** Trigger edges inside the new subgraph, joining the sentinels to the inner ends of the cut edges. */
  innerTriggerEdges: TriggerEdge[];
  /** Data edges inside the new subgraph, joining the sentinels to the inner ends of the cut edges. */
  innerDataEdges: DataEdge[];
}

function catalogOf(sources: SchemaSources): TypeCatalog {
  return {
    nodeKinds: sources.nodeKinds.value,
    triggerTypes: sources.triggerTypes.value,
    actionTypes: sources.actionTypes.value,
    dataNodeTypes: sources.dataNodeTypes.value,
  };
}

/** The schema of one data port of a node, on one side; `group` carries its ports on the node itself, not in the kind registry. */
function findSchemaForDataPort(
  sources: SchemaSources,
  nodeId: string,
  port: string,
  direction: "in" | "out",
): JsonSchema | undefined {
  const node = sources.currentGraph.value?.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  if (node.kind === "group")
    return (node.ports ?? []).find(
      (p) => p.kind === "data" && p.direction === direction && p.name === port,
    )?.schema;
  return schemaFromKind(node, catalogOf(sources), direction)?.properties?.[
    port
  ];
}

export function findSchemaForDataSourcePort(
  sources: SchemaSources,
  nodeId: string,
  port: string,
): JsonSchema | undefined {
  return findSchemaForDataPort(sources, nodeId, port, "out");
}

export function findSchemaForDataTargetField(
  sources: SchemaSources,
  nodeId: string,
  field: string,
): JsonSchema | undefined {
  return findSchemaForDataPort(sources, nodeId, field, "in");
}

interface PlanState {
  ports: GroupPort[];
  outerTriggerEdges: TriggerEdge[];
  outerDataEdges: DataEdge[];
  innerTriggerEdges: TriggerEdge[];
  innerDataEdges: DataEdge[];
  /** Port names taken by data inputs; each (kind, direction) has its own set, so a data-in "input" and a data-out "output" coexist. */
  takenDataIn: Set<string>;
  /** Port names taken by data outputs. */
  takenDataOut: Set<string>;
  /** Port names taken by trigger inputs. */
  takenTriggerIn: Set<string>;
  /** Port names taken by trigger outputs. */
  takenTriggerOut: Set<string>;
}

interface PlanIds {
  groupId: string;
  groupInputId: string;
  groupOutputId: string;
}

/** A trigger edge from inside the selection to outside becomes a trigger-out port, the group node's `from.branch` being the port name. */
function planTriggerOut(state: PlanState, ids: PlanIds, e: TriggerEdge): void {
  const name = uniqueName(
    desiredPortNameForTrigger(e.from.branch),
    state.takenTriggerOut,
  );
  state.ports.push({ kind: "trigger", direction: "out", name });
  state.outerTriggerEdges.push({
    id: newId(),
    from: { node: ids.groupId, branch: name },
    to: { node: e.to.node },
  });
  state.innerTriggerEdges.push({
    id: newId(),
    from: { node: e.from.node, branch: e.from.branch },
    to: { node: ids.groupOutputId, branch: name },
  });
}

/** A trigger edge from outside to inside becomes a trigger-in port, named on `to.branch` outside and on `from.branch` of the groupInput inside. */
function planTriggerIn(state: PlanState, ids: PlanIds, e: TriggerEdge): void {
  const name = uniqueName(
    desiredPortNameForTrigger(e.from.branch),
    state.takenTriggerIn,
  );
  state.ports.push({ kind: "trigger", direction: "in", name });
  state.outerTriggerEdges.push({
    id: newId(),
    from: { node: e.from.node, branch: e.from.branch },
    to: { node: ids.groupId, branch: name },
  });
  state.innerTriggerEdges.push({
    id: newId(),
    from: { node: ids.groupInputId, branch: name },
    to: { node: e.to.node },
  });
}

function planDataOut(
  state: PlanState,
  ids: PlanIds,
  e: DataEdge,
  sources: SchemaSources,
): void {
  const name = uniqueName(e.from.port, state.takenDataOut);
  state.ports.push({
    kind: "data",
    direction: "out",
    name,
    schema: findSchemaForDataSourcePort(sources, e.from.node, e.from.port),
  });
  state.outerDataEdges.push({
    id: newId(),
    from: { node: ids.groupId, port: name },
    to: { node: e.to.node, field: e.to.field },
  });
  state.innerDataEdges.push({
    id: newId(),
    from: { node: e.from.node, port: e.from.port },
    to: { node: ids.groupOutputId, field: name },
  });
}

function planDataIn(
  state: PlanState,
  ids: PlanIds,
  e: DataEdge,
  sources: SchemaSources,
): void {
  const name = uniqueName(e.to.field, state.takenDataIn);
  state.ports.push({
    kind: "data",
    direction: "in",
    name,
    schema: findSchemaForDataTargetField(sources, e.to.node, e.to.field),
  });
  state.outerDataEdges.push({
    id: newId(),
    from: { node: e.from.node, port: e.from.port },
    to: { node: ids.groupId, field: name },
  });
  state.innerDataEdges.push({
    id: newId(),
    from: { node: ids.groupInputId, port: name },
    to: { node: e.to.node, field: e.to.field },
  });
}

/**
 * The plan to wrap `selection` in a group: each edge cut by the selection
 * becomes a port of the group, an outer edge to the group node and an inner
 * edge from or to a sentinel.
 */
export function planNewGroup(
  g: ProcedureGraph,
  selection: Set<string>,
  groupId: string,
  sources: SchemaSources,
): NewGroupPlan {
  const state: PlanState = {
    ports: [],
    outerTriggerEdges: [],
    outerDataEdges: [],
    innerTriggerEdges: [],
    innerDataEdges: [],
    takenDataIn: new Set<string>(),
    takenDataOut: new Set<string>(),
    takenTriggerIn: new Set<string>(),
    takenTriggerOut: new Set<string>(),
  };
  const ids = { groupId, groupInputId: newId(), groupOutputId: newId() };

  for (const e of g.triggerEdges) {
    const fromIn = selection.has(e.from.node);
    const toIn = selection.has(e.to.node);
    if (fromIn === toIn) continue;
    if (fromIn) planTriggerOut(state, ids, e);
    else planTriggerIn(state, ids, e);
  }

  for (const e of g.dataEdges) {
    const fromIn = selection.has(e.from.node);
    const toIn = selection.has(e.to.node);
    if (fromIn === toIn) continue;
    if (fromIn) planDataOut(state, ids, e, sources);
    else planDataIn(state, ids, e, sources);
  }

  return {
    groupId,
    groupPorts: state.ports,
    groupInputId: ids.groupInputId,
    groupOutputId: ids.groupOutputId,
    outerTriggerEdges: state.outerTriggerEdges,
    outerDataEdges: state.outerDataEdges,
    innerTriggerEdges: state.innerTriggerEdges,
    innerDataEdges: state.innerDataEdges,
  };
}
