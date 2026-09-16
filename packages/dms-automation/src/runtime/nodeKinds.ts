import type {
  JsonSchema,
  LogLevel,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import type { GraphNode } from "../types/graph";

/**
 * Execution context handed to every node kind's `execute`. Fire downstream
 * sub-walks, mutate data outputs (which invalidates downstream caches),
 * log into the enclosing fire, and observe cancellation.
 */
export interface NodeCtx {
  readonly procedureId: string;
  readonly runId: string;
  readonly nodeId: string;
  /** Run-cancellation signal. Always present; may never abort. */
  readonly signal: AbortSignal;

  /**
   * Fire one of this node's trigger-out ports as a SIDE fire — opens a
   * child fire, claims the port on the outer sub-walk so the outer topo
   * iteration doesn't also auto-propagate through it, then synchronously
   * runs a nested sub-walk on `port` and awaits its completion.
   *
   * Use for ports whose downstream should appear nested under this node
   * in the runs UI (foreach `body`, tryCatch `try`/`catch`, parallel
   * branches). Do NOT use for the continuation — that's implicit (see
   * `continueWith`).
   *
   * `opts.iteration` annotates per-iteration fires for higher-order
   * nodes so the runs UI can render iteration groupings.
   */
  fireTrigger(port: string, opts?: { iteration?: number }): Promise<void>;

  /**
   * Select which trigger-out port the outer walk should auto-propagate
   * through after this node's execute returns. Records on the outer
   * sub-walk's branch decisions; the chosen port stays in the same fire
   * as this node (no child fire) so the downstream reads as a linear
   * continuation of the parent flow.
   *
   * Call from branching nodes (if/switch) where no port is implicitly the
   * continuation, or from higher-order nodes that want to redirect the
   * default `main` continuation (e.g. retry on exhaustion takes
   * `exhausted` as the continuation instead of `main`).
   *
   * Calling this with N different ports records all of them; the outer
   * walk propagates through each.
   */
  continueWith(port: string): void;

  /**
   * Replace this node's data outputs. Bumps the source's version, so any
   * data-node cache downstream of this node will invalidate on next pull.
   * Called once for terminal nodes; called multiple times within a single
   * `execute` for higher-order nodes (foreach per iteration).
   */
  setOutputs(values: Record<string, unknown>): void;

  /**
   * Structured log entry. Attached to the enclosing fire and
   * auto-tagged with this node's id/kind.
   */
  log(level: LogLevel, message: string, value?: unknown): void;

  /**
   * Re-resolve this node's data inputs from the current cache. Lets a
   * higher-order node read fresh upstream values between iterations after
   * a body sub-walk has mutated dependent outputs. No built-in kind calls
   * it yet.
   */
  resolveInputs(): Record<string, unknown>;
}

export type NodeExecute = (
  node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
) => Promise<void>;

/**
 * Per-NodeKind metadata. Drives the divergence validator, the
 * executor's continuation logic, AND the frontend renderer (via the
 * optional `ui` sub-object served through `/api/automation/node-kinds`).
 *
 * Every declared port is classified as either a CONTINUATION port (folds
 * back into the parent flow; auto-propagates after execute returns unless
 * overridden via ctx.continueWith) or a SIDE port (never auto-propagates;
 * fires when execute calls ctx.fireTrigger — opens a child fire and runs
 * nested — or becomes the continuation when execute selects it via
 * ctx.continueWith, as if/retry do).
 */
export interface NodeKindMeta {
  /** Continuation ports — auto-propagate after execute returns. */
  continuationPorts: string[];
  /** Side ports — never auto-propagate; fired via ctx.fireTrigger or selected via ctx.continueWith. */
  sidePorts: string[];
  /**
   * UI rendering hints. Optional — kinds with their own bespoke Vue
   * component (group, groupInput, groupOutput) omit this. Anything that
   * renders through the editor's GenericNode component declares its full
   * port spec here so the frontend doesn't have to special-case the kind.
   */
  ui?: NodeKindUI;
}

export interface PortRef {
  name: string;
  type?: string;
}

/**
 * Layout spec for the frontend GenericNode. Combines:
 *  - static label/icon/port lists declared per kind, and
 *  - dynamic hooks: pull additional trigger-out ports from a config key,
 *    or pull data port lists from a registered TriggerType / ActionType /
 *    DataNodeType by `node.typeId`.
 *
 * The frontend resolves these into the final {triggerOuts, dataIns,
 * dataOuts} arrays for a given node instance.
 */
export interface NodeKindUI {
  label: string;
  icon?: string;
  hasTriggerIn: boolean;
  hasMainTriggerOut: boolean;
  /** Body trigger-out ports always present (rendered after dynamic ones). */
  staticTriggerOuts: string[];
  /** Data inputs always present. */
  staticDataIns: PortRef[];
  /** Data outputs always present. */
  staticDataOuts: PortRef[];
  /**
   * Config key whose string-array value contributes additional
   * trigger-out ports, prepended before `staticTriggerOuts`. Used for
   * switch (`cases`) and parallel (`ports`).
   */
  dynamicTriggerOutsFromConfig?: string;
  /**
   * Pull label / icon / category / data port schemas from a registered
   * type referenced by `node.typeId`. Set for action / trigger / data.
   */
  typeRegistry?: "triggers" | "actions" | "dataNodes";
  dataInsFromTypeSchema?: "inputSchema" | "outputSchema" | "configSchema";
  dataOutsFromTypeSchema?: "inputSchema" | "outputSchema" | "configSchema";
  labelFromType?: boolean;
  iconFromType?: boolean;
  categoryFromType?: boolean;
  /**
   * Palette grouping key (e.g. "flow", "helper"). Omit to keep this kind
   * out of the generic palette — useful for kinds that are summoned by
   * type-registry pickers (trigger/action/data) or by bespoke editor flows
   * (group/groupInput/groupOutput).
   */
  category?: string;
  /**
   * Initial config the editor seeds when this kind is dropped onto the
   * canvas. structuredCloned per instance. Type-registry-backed kinds
   * derive their defaults from the selected type's schema instead.
   */
  defaultConfig?: Record<string, unknown>;
  /**
   * JsonSchema the inspector renders into a config form. For type-registry
   * kinds the inspector uses the selected type's config/input schemas
   * instead.
   */
  configSchema?: JsonSchema;
}

interface NodeKindEntry {
  execute: NodeExecute;
  meta: NodeKindMeta;
}

export class NodeKindRegistry {
  private entries = new Map<string, NodeKindEntry>();

  register(kind: string, execute: NodeExecute, meta: NodeKindMeta): void {
    this.entries.set(kind, { execute, meta });
  }

  get(kind: string): NodeKindEntry | undefined {
    return this.entries.get(kind);
  }

  metaOf(kind: string): NodeKindMeta | undefined {
    return this.entries.get(kind)?.meta;
  }

  has(kind: string): boolean {
    return this.entries.has(kind);
  }

  /**
   * Returns true if `kind` may legitimately have multiple outgoing trigger
   * edges. Derived from the kind's classification:
   *  - side ports exist (foreach/tryCatch/retry/if/...),
   *  - more than one continuation port,
   *  - dynamic trigger-outs from config (switch.cases, parallel.ports),
   *  - or it's an entry-point trigger node (the typeRegistry === "triggers"
   *    case — bootstrap triggers may fan out into parallel paths).
   */
  mayDiverge(kind: string): boolean {
    const meta = this.entries.get(kind)?.meta;
    if (!meta) return false;
    return (
      meta.sidePorts.length > 0 ||
      meta.continuationPorts.length > 1 ||
      !!meta.ui?.dynamicTriggerOutsFromConfig ||
      meta.ui?.typeRegistry === "triggers"
    );
  }

  /**
   * Snapshot of every registered kind's metadata. Used by the
   * `/api/automation/node-kinds` route to feed the editor.
   */
  listAll(): Array<{ kind: string; meta: NodeKindMeta }> {
    return [...this.entries.entries()].map(([kind, entry]) => ({
      kind,
      meta: entry.meta,
    }));
  }
}

export const nodeKinds = new NodeKindRegistry();

/**
 * Zod schema that accepts any kind currently registered in `nodeKinds`,
 * plus the special `"group"` literal (group is handled by `flatten.ts`
 * rather than registered in the kind registry). Used by the procedure /
 * template HTTP routes so the kind list is the single source of truth.
 *
 * The predicate runs at parse time, so the registry must be populated
 * (via `import "./runtime/builtins"`) before any request is validated —
 * the module entry point imports the builtins at load time (directly and
 * through the routes → executor chain), long before `start()` runs.
 */
export function nodeKindZodSchema(): z.ZodType<string> {
  return z.string().refine((k) => nodeKinds.has(k) || k === "group", {
    message: "unknown node kind",
  });
}
