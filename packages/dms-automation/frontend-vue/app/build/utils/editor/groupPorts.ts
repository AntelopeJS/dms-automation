import type {
  DataEdge,
  GraphNode,
  GroupPort,
  TriggerEdge,
} from "../../../composables/useGraphConnect";
import { newId } from "../../../utils/automation";

/** A port of a group node that kept its place in its (kind, direction) bucket under a new name. */
export interface PortRename {
  kind: "data" | "trigger";
  direction: "in" | "out";
  oldName: string;
  newName: string;
}

/**
 * Port renames between two port arrays of the same group node, matched in two
 * passes scoped per (kind, direction): ports present in both arrays under the
 * same name are unchanged, and the remaining old and new ports pair up by
 * position, each pair a rename. Unpaired old-only ports are deletions and
 * unpaired new-only ports additions. Heuristic, but the GroupPortEditor emits
 * one mutation per UX action, so each `ports:update` typically carries a single
 * delta and the pairing is unambiguous.
 */
export function detectPortRenames(
  oldPorts: GroupPort[],
  newPorts: GroupPort[],
): PortRename[] {
  const renames: PortRename[] = [];
  const buckets: Array<{ kind: "data" | "trigger"; direction: "in" | "out" }> =
    [
      { kind: "data", direction: "in" },
      { kind: "data", direction: "out" },
      { kind: "trigger", direction: "in" },
      { kind: "trigger", direction: "out" },
    ];
  for (const b of buckets) {
    const oldInBucket = oldPorts.filter(
      (p) => p.kind === b.kind && p.direction === b.direction,
    );
    const newInBucket = newPorts.filter(
      (p) => p.kind === b.kind && p.direction === b.direction,
    );
    const newNames = new Set(newInBucket.map((p) => p.name));
    const oldNames = new Set(oldInBucket.map((p) => p.name));
    const oldOnly = oldInBucket.filter((p) => !newNames.has(p.name));
    const newOnly = newInBucket.filter((p) => !oldNames.has(p.name));
    for (const [i, oldPort] of oldOnly.entries()) {
      const newPort = newOnly[i];
      if (!newPort) break;
      renames.push({
        kind: b.kind,
        direction: b.direction,
        oldName: oldPort.name,
        newName: newPort.name,
      });
    }
  }
  return renames;
}

function renameDataEdges(
  dataEdges: DataEdge[],
  nodeId: string,
  rename: PortRename,
  end: "from" | "to",
): void {
  for (const e of dataEdges) {
    if (
      end === "from" &&
      e.from.node === nodeId &&
      e.from.port === rename.oldName
    )
      e.from.port = rename.newName;
    if (end === "to" && e.to.node === nodeId && e.to.field === rename.oldName)
      e.to.field = rename.newName;
  }
}

function renameTriggerEdges(
  triggerEdges: TriggerEdge[],
  nodeId: string,
  rename: PortRename,
  end: "from" | "to",
): void {
  for (const e of triggerEdges) {
    if (
      end === "from" &&
      e.from.node === nodeId &&
      e.from.branch === rename.oldName
    )
      e.from.branch = rename.newName;
    if (end === "to" && e.to.node === nodeId && e.to.branch === rename.oldName)
      e.to.branch = rename.newName;
  }
}

/**
 * Rewrites, in place, the edge endpoints that referenced the renamed port
 * names. `nodeId` is the node owning the renamed ports: the outer group node
 * (for the outer graph's edges) or a sentinel node id (for the inner edges).
 * The rename's direction picks the edge end: data/in the `to.field`, data/out
 * the `from.port`, trigger/in the `to.branch`, trigger/out the `from.branch`,
 * each on edges whose end node is `nodeId`. The sentinels invert the direction
 * (an inbound port on the group is an OUTBOUND handle on the groupInput
 * sentinel and vice versa), so callers pass `invertDirection: true` for the
 * inner edges.
 */
export function applyPortRenamesToEdges(
  triggerEdges: TriggerEdge[],
  dataEdges: DataEdge[],
  nodeId: string,
  renames: PortRename[],
  invertDirection: boolean,
): void {
  for (const r of renames) {
    const isOut = invertDirection
      ? r.direction === "in"
      : r.direction === "out";
    const end = isOut ? "from" : "to";
    if (r.kind === "data") renameDataEdges(dataEdges, nodeId, r, end);
    else renameTriggerEdges(triggerEdges, nodeId, r, end);
  }
}

function portNames(
  ports: GroupPort[],
  kind: GroupPort["kind"],
  direction: GroupPort["direction"],
): Set<string> {
  return new Set(
    ports
      .filter((p) => p.kind === kind && p.direction === direction)
      .map((p) => p.name),
  );
}

/**
 * Makes sure the group node's local subgraph has its sentinels and that no
 * inner edge references a port that was just removed. The sentinels are
 * auto-managed (the user never creates them); their handle set is derived at
 * render time from the parent group's `ports` array, so this owns four things:
 * a single groupInput and a single groupOutput exist; data edges whose
 * source or target port no longer exists are dropped; trigger edges out of
 * groupInput whose branch no longer exists are dropped; so are trigger edges
 * into groupOutput whose target port (`to.branch`) no longer exists.
 */
export function syncSentinels(group: GraphNode): void {
  if (!group.subgraph) return;

  let gi = group.subgraph.nodes.find((n) => n.kind === "groupInput");
  let go = group.subgraph.nodes.find((n) => n.kind === "groupOutput");

  if (!gi) {
    gi = {
      id: newId(),
      kind: "groupInput",
      config: {},
      position: { x: 0, y: 0 },
    };
    group.subgraph.nodes.push(gi);
  }
  if (!go) {
    go = {
      id: newId(),
      kind: "groupOutput",
      config: {},
      position: { x: 600, y: 0 },
    };
    group.subgraph.nodes.push(go);
  }

  const ports = Array.isArray(group.ports) ? group.ports : [];
  const validDataIn = portNames(ports, "data", "in");
  const validDataOut = portNames(ports, "data", "out");
  const validTriggerIn = portNames(ports, "trigger", "in");
  const validTriggerOut = portNames(ports, "trigger", "out");

  const giId = gi.id;
  const goId = go.id;

  group.subgraph.dataEdges = group.subgraph.dataEdges.filter((e) => {
    if (e.from.node === giId && !validDataIn.has(e.from.port)) return false;
    if (e.to.node === goId && !validDataOut.has(e.to.field)) return false;
    return true;
  });

  group.subgraph.triggerEdges = group.subgraph.triggerEdges.filter((e) => {
    if (e.from.node === giId) {
      const branch = e.from.branch ?? "main";
      if (!validTriggerIn.has(branch)) return false;
    }
    if (e.to.node === goId && e.to.branch !== undefined) {
      if (!validTriggerOut.has(e.to.branch)) return false;
    }
    return true;
  });
}
