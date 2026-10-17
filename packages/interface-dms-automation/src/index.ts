import {
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";

export type JsonSchema = Record<string, unknown>;

export type LogLevel = "info" | "warn" | "error";

export interface ExecutionCtx {
  procedureId: string;
  runId: string;
  nodeId: string;
  /**
   * Emit a structured log entry into the current run record. The executor
   * binds this per-node so the entry is auto-tagged with the calling
   * nodeId / nodeKind.
   */
  log(level: LogLevel, message: string, value?: unknown): void;
}

export interface TriggerType<TConfig = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  icon: string;
  configSchema: JsonSchema;
  outputSchema: JsonSchema;
  /**
   * Cluster firing semantics. Required — no default, so every trigger type
   * makes a deliberate choice (mirrors trigger-out port classification).
   *   "singleton"  — must fire exactly once cluster-wide; only the elected
   *                  leader activates it (cron; future table-watch / interval).
   *   "replicated" — every instance activates it; the load balancer already
   *                  routes each event to exactly one instance (webhook).
   * In memory / single-instance mode the distinction is inert.
   */
  cluster: "singleton" | "replicated";
  activate(config: TConfig, emit: (payload: TOutput) => void): Promise<unknown>;
  deactivate(handle: unknown): Promise<void>;
}

export interface ActionType<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  icon: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  execute(input: TInput, ctx: ExecutionCtx): Promise<TOutput>;
}

export interface DataNodeType<TInput = unknown, TOutput = unknown> {
  id: string;
  category: string;
  name: string;
  description: string;
  icon: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  /**
   * Optional editor-only config form. When set, the inspector renders THIS
   * schema (instead of `inputSchema`) as the node's editable fields, while
   * data-in ports still derive from `inputSchema`. Used by constant nodes,
   * whose value is typed in-place (config) rather than wired (a port). The
   * config value is merged into the evaluate input by `resolveInputs`.
   */
  configSchema?: JsonSchema;
  evaluate(input: TInput): TOutput;
}

/**
 * @internal
 */
export namespace internal {
  export const RegisterTriggerType = new RegisteringProxy<
    (id: string, type: TriggerType) => void
  >();
  export const RegisterActionType = new RegisteringProxy<
    (id: string, type: ActionType) => void
  >();
  export const RegisterDataNodeType = new RegisteringProxy<
    (id: string, type: DataNodeType) => void
  >();
}

export function RegisterTriggerType(type: TriggerType): void {
  internal.RegisterTriggerType.register(type.id, type);
}

export function UnregisterTriggerType(id: string): void {
  internal.RegisterTriggerType.unregister(id);
}

export function RegisterActionType(type: ActionType): void {
  internal.RegisterActionType.register(type.id, type);
}

export function UnregisterActionType(id: string): void {
  internal.RegisterActionType.unregister(id);
}

export function RegisterDataNodeType(type: DataNodeType): void {
  internal.RegisterDataNodeType.register(type.id, type);
}

export function UnregisterDataNodeType(id: string): void {
  internal.RegisterDataNodeType.unregister(id);
}

/**
 * One node of a procedure graph, as the builder saves it and "Export JSON"
 * writes it. `kind` is "trigger", "action", "data", "group" or a flow kind
 * ("if", "switch", "foreach"…); trigger, action and data nodes name their
 * registered type in `typeId`. Group nodes carry `ports` with either a
 * `templateId` or an inline `subgraph`. Other fields (a `label`, canvas
 * metadata) are kept as given.
 */
export interface ProcedureGraphNode {
  id: string;
  kind: string;
  typeId?: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  templateId?: string;
  ports?: ProcedureGroupPort[];
  subgraph?: ProcedureGraph;
  [field: string]: unknown;
}

export interface ProcedureGroupPort {
  name: string;
  kind: "data" | "trigger";
  direction: "in" | "out";
  /** Present on data ports. */
  schema?: JsonSchema;
}

/** Runs `to` after `from`; `branch` names a port of a node that has several. */
export interface ProcedureTriggerEdge {
  id: string;
  from: { node: string; branch?: string };
  to: { node: string; branch?: string };
}

/** Feeds the output `port` of one node into the input `field` of another. */
export interface ProcedureDataEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; field: string };
}

/** A procedure graph, in the shape "Export JSON" writes under `graph`. */
export interface ProcedureGraph {
  nodes: ProcedureGraphNode[];
  triggerEdges: ProcedureTriggerEdge[];
  dataEdges: ProcedureDataEdge[];
}

/** A procedure a module ships as code. */
export interface ProcedureDeclaration {
  /**
   * Stable key chosen by the caller, namespaced `<module>.<procedure>`
   * (letters, digits, `.`, `_`, `-`): it becomes the procedure's id, so
   * `InvokeProcedure` and the builder's URL take it as is.
   */
  id: string;
  name: string;
  description?: string;
  graph: ProcedureGraph;
  /** Eligible triggers reconcile after storage; this is not an arming-success flag. */
  enabled: boolean;
}

/**
 * What `DeclareProcedure` did:
 *   "created"   — no procedure had this id: it was stored.
 *   "updated"   — the stored procedure was still what this caller declared
 *                 last, and the declaration changed: it was replaced.
 *   "unchanged" — the stored procedure is already this declaration;
 *                 run-history metadata and subscriptions synchronize again.
 *   "kept"      — someone changed the procedure since it was declared (an
 *                 edit, a pause, a resume): it is left as they made it.
 */
export type DeclaredProcedureStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "kept";

/** A problem on a graph, as the builder lists it. */
export interface ProcedureIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  params?: Record<string, unknown>;
}

export interface DeclaredProcedure {
  id: string;
  status: DeclaredProcedureStatus;
  /** Whether the stored procedure is enabled (a kept one may differ). */
  enabled: boolean;
  /** The declared graph's problems, none of them blocking (see the docs). */
  issues: ProcedureIssue[];
}

export const ListTriggerTypes = InterfaceFunction<() => TriggerType[]>();
export const ListActionTypes = InterfaceFunction<() => ActionType[]>();
export const ListDataNodeTypes = InterfaceFunction<() => DataNodeType[]>();
export const InvokeProcedure =
  InterfaceFunction<(id: string, payload?: unknown) => Promise<string>>();
/**
 * Create or refresh a procedure shipped as code, keyed by `declaration.id`.
 * Safe to call on every boot: the procedure is created once, refreshed only
 * while it is still what was declared last, and never overwritten once
 * someone changed it. Waits until the automation module has started.
 * A rejection can occur after storage. Retry the same declaration to repair
 * synchronization without advancing its revision or version.
 */
export const DeclareProcedure =
  InterfaceFunction<
    (declaration: ProcedureDeclaration) => Promise<DeclaredProcedure>
  >();
