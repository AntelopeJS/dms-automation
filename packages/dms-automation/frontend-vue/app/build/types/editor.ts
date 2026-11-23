import type { WordedTrigger } from "../../utils/describe";
import type { JsonValue } from "../../utils/json";
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
  /** Moves with the graph only. */
  version?: number;
  /**
   * Moves with every write, a save or a pause from the list. A save sends the
   * revision it started from back, so the server refuses to overwrite what was
   * written elsewhere in the meantime.
   */
  revision?: number;
}

/**
 * One step of the subgraph navigation stack, whose first entry is always the
 * procedure root: `procedure` (id is the procedure `_id`), `group` (id is the
 * group node's id in its parent graph) or `template` (reserved for the
 * template editor; a template instance pushes as `group`, read-only because
 * the node has a `templateId`).
 */
export interface SubgraphPathSegment {
  kind: "procedure" | "group" | "template";
  id: string;
  name: string;
}

export interface ProcedureSnapshot {
  name: string;
  enabled: boolean;
  graph: ProcedureGraph;
  /** Template mode only: the template's outer ports, edited at its root. */
  ports?: GroupPort[];
}

/**
 * One level of the walk down the procedure graph along the subgraph path: it
 * stops at the last level that resolves, when a group was deleted in the outer
 * graph.
 */
export interface SubgraphFrame {
  segment: SubgraphPathSegment;
  graph: ProcedureGraph;
  /** The group node that owns `graph`; null for the procedure root. */
  groupNode: GraphNode | null;
}

/**
 * A problem of the draft, asked of the server (the same validator a save runs)
 * a moment after each change. `code` and `params` are what the locale words;
 * the English `message` is the fallback for a code the locale does not know.
 */
export interface GraphIssue {
  severity: "error" | "warning";
  message: string;
  code?: string;
  params?: Record<string, JsonValue>;
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
