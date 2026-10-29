import type {
  DataEdge,
  GraphNode,
  GroupPort,
  TriggerEdge,
} from "../../../composables/useGraphConnect";
import { newId } from "../../../utils/automation";

// Detect port renames between two port arrays of the same group node.
//
// Two-pass matching, scoped per (kind, direction):
//   1. Ports present in BOTH arrays under the same (kind, direction, name) are
//      considered identical — no rename.
//   2. Of the remaining old/new ports, pair them positionally within each
//      (kind, direction) bucket. Each pair is a rename (old.name → new.name).
//      Unpaired old-only ports are true deletions; unpaired new-only ports are
//      true additions.
//
// This is heuristic but the GroupPortEditor emits one mutation per UX action,
// so each ports:update typically carries a single delta and the positional
// pairing is unambiguous.
export interface PortRename {
  kind: "data" | "trigger";
  direction: "in" | "out";
  oldName: string;
  newName: string;
}

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
    // Ports that exist in both arrays with the same name didn't change.
    const oldOnly = oldInBucket.filter((p) => !newNames.has(p.name));
    const newOnly = newInBucket.filter((p) => !oldNames.has(p.name));
    const pairCount = Math.min(oldOnly.length, newOnly.length);
    for (let i = 0; i < pairCount; i++) {
      renames.push({
        kind: b.kind,
        direction: b.direction,
        oldName: oldOnly[i]!.name,
        newName: newOnly[i]!.name,
      });
    }
  }
  return renames;
}

// Rewrite edge endpoints that referenced the renamed port names. Mutates the
// provided edge arrays in place.
//
// `nodeId` is the node owning the renamed ports — either the outer group node
// (for the outer graph's edges) or a sentinel node id inside the subgraph (for
// the inner edges). The direction of the rename determines which edge end is
// affected:
//   • data/in     → edge.to.field   when edge.to.node === nodeId
//   • data/out    → edge.from.port  when edge.from.node === nodeId
//   • trigger/in  → edge.to.branch  when edge.to.node === nodeId
//   • trigger/out → edge.from.branch when edge.from.node === nodeId
//
// For the inner subgraph, the sentinels invert the direction (an inbound port
// on the group is an OUTBOUND handle on the groupInput sentinel and vice
// versa). Callers pass `invertDirection: true` so a group-level "in" rename is
// applied to the sentinel's "out" handles, etc.
export function applyPortRenamesToEdges(
  triggerEdges: TriggerEdge[],
  dataEdges: DataEdge[],
  nodeId: string,
  renames: PortRename[],
  invertDirection: boolean,
): void {
  for (const r of renames) {
    const effectiveDirection = invertDirection
      ? r.direction === "in"
        ? "out"
        : "in"
      : r.direction;
    if (r.kind === "data") {
      if (effectiveDirection === "out") {
        for (const e of dataEdges) {
          if (e.from.node === nodeId && e.from.port === r.oldName) {
            e.from.port = r.newName;
          }
        }
      } else {
        for (const e of dataEdges) {
          if (e.to.node === nodeId && e.to.field === r.oldName) {
            e.to.field = r.newName;
          }
        }
      }
    } else {
      if (effectiveDirection === "out") {
        for (const e of triggerEdges) {
          if (e.from.node === nodeId && e.from.branch === r.oldName) {
            e.from.branch = r.newName;
          }
        }
      } else {
        for (const e of triggerEdges) {
          if (e.to.node === nodeId && e.to.branch === r.oldName) {
            e.to.branch = r.newName;
          }
        }
      }
    }
  }
}

// Make sure the group node's local subgraph has the sentinels and that no
// inner edge references a port that was just removed. The sentinels are
// auto-managed (the user never creates them by hand); their handle set is
// derived at render time from the parent group's `ports` array (see
// GraphCanvas.vue `parent-group-ports` prop plumbing), so this
// function only owns four responsibilities:
//   1. Ensure a single groupInput and a single groupOutput exist.
//   2. Drop data edges whose source/target port no longer exists.
//   3. Drop trigger edges whose source branch (originating at groupInput)
//      no longer exists.
//   4. Drop trigger edges into groupOutput whose target port (`to.branch`)
//      no longer exists.
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
  const validDataIn = new Set(
    ports
      .filter((p) => p.kind === "data" && p.direction === "in")
      .map((p) => p.name),
  );
  const validDataOut = new Set(
    ports
      .filter((p) => p.kind === "data" && p.direction === "out")
      .map((p) => p.name),
  );
  const validTriggerIn = new Set(
    ports
      .filter((p) => p.kind === "trigger" && p.direction === "in")
      .map((p) => p.name),
  );
  const validTriggerOut = new Set(
    ports
      .filter((p) => p.kind === "trigger" && p.direction === "out")
      .map((p) => p.name),
  );

  const giId = gi.id;
  const goId = go.id;

  group.subgraph.dataEdges = group.subgraph.dataEdges.filter((e) => {
    if (e.from.node === giId && !validDataIn.has(e.from.port)) return false;
    if (e.to.node === goId && !validDataOut.has(e.to.field)) return false;
    return true;
  });

  group.subgraph.triggerEdges = group.subgraph.triggerEdges.filter((e) => {
    // trigger edges OUT OF groupInput carry the port name as `from.branch`
    // (the same convention if/switch use for named branches).
    if (e.from.node === giId) {
      const branch = e.from.branch ?? "main";
      if (!validTriggerIn.has(branch)) return false;
    }
    // trigger edges INTO groupOutput carry the target port name on
    // `to.branch`. If the port has been removed from the group's
    // declarations, drop the edge.
    if (e.to.node === goId && e.to.branch !== undefined) {
      if (!validTriggerOut.has(e.to.branch)) return false;
    }
    return true;
  });
}
