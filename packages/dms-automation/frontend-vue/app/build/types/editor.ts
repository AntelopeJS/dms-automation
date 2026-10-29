import type { WordedTrigger } from "../../utils/describe";
import type {
  GroupPort,
  GraphNode,
  ProcedureGraph,
} from "../../composables/useGraphConnect";

export interface ProcedureRecord {
  _id: string;
  name: string;
  description: string;
  enabled: boolean;
  graph: ProcedureGraph;
  // The graph's version (it moves with the graph only), and the revision
  // (it moves with every write: a save, a pause from the list). A save sends
  // the revision it started from back, so the server refuses to overwrite
  // what was written elsewhere in the meantime.
  version?: number;
  revision?: number;
}

// Subgraph navigation stack. The first entry is always the procedure root;
// each subsequent entry is a group / template segment the user has entered.
// Cleared and re-seeded whenever the selected procedure changes (see the
// watch on selectedId below).
//
// kind === 'procedure' — id is the procedure _id, name is its display name.
// kind === 'group'     — id is the group node's id within its parent graph.
// kind === 'template'  — reserved for the dedicated template editor view.
//                        Navigation into local groups pushes as 'group';
//                        template instances likewise push as 'group' with
//                        the read-only signal taken from the node having a
//                        templateId, not from the path kind.
export interface SubgraphPathSegment {
  kind: "procedure" | "group" | "template";
  id: string;
  name: string;
}

export interface ProcedureSnapshot {
  name: string;
  enabled: boolean;
  graph: ProcedureGraph;
  // Template mode only: the template's outer ports, edited at its root.
  ports?: GroupPort[];
}

// Walk the procedure graph following subgraphPath. Returns the full chain
// of (segment, containerGraph, groupNode|null) so currentGraph and
// currentParentGroupPorts can be derived from one traversal without
// re-walking.
//
// If a path segment can't be resolved (e.g. the group node was deleted in
// the outer graph), traversal stops at the last valid level — the caller
// is expected to also watch the stale path and trim it (see the watch on
// `selected.graph`).
export interface SubgraphFrame {
  segment: SubgraphPathSegment;
  graph: ProcedureGraph;
  // The group node that owns `graph` (i.e. graph === groupNode.subgraph).
  // Null for the procedure root.
  groupNode: GraphNode | null;
}

// Problems of the draft, asked of the server (the same validator a save
// runs) a moment after each change.
// Each issue carries a `code` (and its `params`) the locale words; its English
// `message` is the fallback for a code the locale does not know.
export interface GraphIssue {
  severity: "error" | "warning";
  message: string;
  code?: string;
  params?: Record<string, unknown>;
  nodeId?: string;
}

export interface ProcedureTriggers {
  triggers: Array<WordedTrigger & { nextAt: string | null }>;
}

export interface Choice<C extends string> {
  value: C;
  label: string;
  color?: "primary" | "neutral" | "error" | "warning";
  variant?: "solid" | "outline" | "ghost" | "soft";
}

export interface ChoiceQuestion<C extends string> {
  title: string;
  description: string;
  choices: Choice<C>[];
  /** The answer of a dialog closed without choosing (Escape, ✕, a click outside). */
  dismiss: C;
}
