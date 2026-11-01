import {
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";

/** A JSON scalar. */
export type JsonPrimitive = string | number | boolean | null;

/** A JSON value: what a node reads, returns, emits or logs. */
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

/**
 * A JSON object. A key may hold `undefined` for a field left unset:
 * `JSON.stringify` leaves that key out, so the object still writes as JSON.
 */
export type JsonObject = { [key: string]: JsonValue | undefined };

/**
 * A JSON Schema, as a node type declares its settings, inputs and outputs.
 * The keywords the builder and the runtime read are typed; any other keyword
 * (`additionalProperties`, `format`, an `x-` extension…) holds a JSON value.
 */
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: { [name: string]: JsonSchema };
  items?: JsonSchema;
  required?: string[];
  enum?: JsonValue[];
  default?: JsonValue;
  minimum?: number;
  maximum?: number;
  [keyword: string]: JsonValue | undefined;
}

export type LogLevel = "info" | "warn" | "error";

export interface ExecutionCtx {
  procedureId: string;
  runId: string;
  nodeId: string;
  /**
   * True when the step runs in a test run (the builder's **Test run**, or a
   * re-run of one): a draft is being tried. An action that declares
   * `dryRun` is then simulated instead of executed, and any action (or the
   * code it calls) can tell a test from a real run. Older implementations
   * leave it out: read it as false.
   */
  dryRun?: boolean;
  /**
   * Emit a structured log entry into the current run record. The executor
   * binds this per-node so the entry is auto-tagged with the calling
   * nodeId / nodeKind.
   */
  log(level: LogLevel, message: string, value?: JsonValue): void;
}

/**
 * A trigger: `activate` arms it and resolves with a handle, `deactivate`
 * receives that handle back. `THandle` types it for the implementer; the
 * automation module treats it as opaque. `emit` hands the graph a payload,
 * which the run stores and shows: a JSON value.
 */
export interface TriggerType<
  TConfig = unknown,
  TOutput extends JsonValue = JsonValue,
  THandle = unknown,
> {
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
  activate(config: TConfig, emit: (payload: TOutput) => void): Promise<THandle>;
  deactivate(handle: THandle): Promise<void>;
}

/**
 * An action. It resolves with the values its output ports carry, a JSON
 * object, or with nothing: the step then has no output. A run fails the step
 * whose action resolves with anything else.
 */
export interface ActionType<
  TInput = unknown,
  TOutput extends JsonObject | void = JsonObject | void,
> {
  id: string;
  name: string;
  description: string;
  icon: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  /**
   * Whether `execute` changes anything outside the run: sends a message,
   * writes a record, calls a service. Defaults to `true`. Declare `false`
   * for an action that only reads or computes, so a test run that uses it
   * asks no confirmation.
   */
  sideEffects?: boolean;
  /**
   * Simulates the action in a test run: called instead of `execute`, with
   * the same input and `ctx.dryRun` set, it must have no effect and resolve
   * to a plausible output (the shape of `outputSchema`) for the steps that
   * read it. Without it, a test run executes the action for real, once the
   * user has confirmed it. Not called when `sideEffects` is `false`.
   */
  dryRun?(input: TInput, ctx: ExecutionCtx): Promise<TOutput>;
  execute(input: TInput, ctx: ExecutionCtx): Promise<TOutput>;
}

/**
 * A data node. It evaluates to the values its output ports carry, a JSON
 * object; a run fails the step that reads a data node evaluating to anything
 * else.
 */
export interface DataNodeType<
  TInput = unknown,
  TOutput extends JsonObject = JsonObject,
> {
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
 * `templateId` or an inline `subgraph`.
 */
export interface ProcedureGraphNode {
  id: string;
  kind: string;
  typeId?: string;
  /** The name the builder gave the step, when it gave one. */
  label?: string;
  config: JsonObject;
  position: { x: number; y: number };
  templateId?: string;
  ports?: ProcedureGroupPort[];
  subgraph?: ProcedureGraph;
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
 * What `DeclareProcedure` did. A declared procedure is written once and
 * belongs to its users from then on:
 *   "created" — no procedure had this id: it was stored.
 *   "kept"    — a procedure already has this id: it is left as it is.
 */
export type DeclaredProcedureStatus = "created" | "kept";

/** A problem on a graph, as the builder lists it. */
export interface ProcedureIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  /** The values the message names (a field, a bound, a type id), for its translations. */
  params?: { [name: string]: string | number };
}

export interface DeclaredProcedure {
  id: string;
  status: DeclaredProcedureStatus;
  /** Whether the stored procedure is enabled (a kept one may differ). */
  enabled: boolean;
  /** The declared graph's problems, none of them blocking (see the docs). */
  issues: ProcedureIssue[];
}

/** How a run ended. */
export type ProcedureRunStatus = "ok" | "failed";

export interface RunProcedureOptions {
  /**
   * What the trigger hands the graph. Left out, the last payload that
   * trigger received in a stored run, else `{}`: Run now's default.
   */
  payload?: JsonValue;
  /** The trigger node to start from: the manual one, else the first, by default. */
  triggerNodeId?: string;
}

/** A run `RunProcedure` started, once it is stored. */
export interface ProcedureRunOutcome {
  runId: string;
  status: ProcedureRunStatus;
  /** Why the run failed. */
  errorMessage?: string;
}

export const ListTriggerTypes = InterfaceFunction<() => TriggerType[]>();
export const ListActionTypes = InterfaceFunction<() => ActionType[]>();
export const ListDataNodeTypes = InterfaceFunction<() => DataNodeType[]>();
export const InvokeProcedure =
  InterfaceFunction<(id: string, payload?: JsonValue) => Promise<string>>();
/**
 * Run a saved procedure now, from any of its triggers (a schedule, a
 * webhook, a manual one…), as "Run now" in the builder does: a graph with
 * blocking issues is refused, and the payload defaults to the trigger's last
 * one. Resolves once the run is stored. Waits until the automation module
 * has started.
 */
export const RunProcedure =
  InterfaceFunction<
    (id: string, options?: RunProcedureOptions) => Promise<ProcedureRunOutcome>
  >();
/**
 * Create a procedure shipped as code, keyed by `declaration.id`, when no
 * procedure has that id yet. An existing one is never touched: a later
 * declaration answers "kept", whatever it declares. Waits until the
 * automation module has started.
 */
export const DeclareProcedure =
  InterfaceFunction<
    (declaration: ProcedureDeclaration) => Promise<DeclaredProcedure>
  >();
