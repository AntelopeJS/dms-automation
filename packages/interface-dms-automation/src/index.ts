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

export const ListTriggerTypes = InterfaceFunction<() => TriggerType[]>();
export const ListActionTypes = InterfaceFunction<() => ActionType[]>();
export const ListDataNodeTypes = InterfaceFunction<() => DataNodeType[]>();
export const InvokeProcedure =
  InterfaceFunction<(id: string, payload?: unknown) => Promise<string>>();
