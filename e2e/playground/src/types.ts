import {
  type ActionType,
  type DataNodeType,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  RegisterActionType,
  RegisterDataNodeType,
  RegisterTriggerType,
  type TriggerType,
  UnregisterActionType,
  UnregisterDataNodeType,
  UnregisterTriggerType,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import { bump, ledger, type LedgerEntry } from "./ledger";

/** Accepts any value and types it as a JSON object: the fixture hands the runtime values it must refuse, on purpose. */
const anyObject = z.custom<JsonObject>();

/** One armed handle of a fixture trigger. */
interface Handle {
  type: string;
  topic: string;
  emit: (payload: JsonValue) => void;
  active: boolean;
}

/** Every handle the fixture triggers armed, active or not. */
export const handles: Handle[] = [];

const STRING_SCHEMA = { type: "string" } as const;

function note(entry: LedgerEntry): void {
  ledger.push(entry);
}

function trigger(id: string, name: string, cluster: "singleton" | "replicated"): TriggerType<{ topic?: string }, JsonValue, Handle> {
  return {
    id,
    name,
    description: `Fixture trigger ${id}`,
    icon: "i-lucide-zap",
    configSchema: { type: "object", properties: { topic: { ...STRING_SCHEMA, title: "Topic" } } },
    outputSchema: { type: "object", properties: { topic: STRING_SCHEMA, value: STRING_SCHEMA } },
    cluster,
    async activate(config, emit) {
      const handle: Handle = { type: id, topic: config.topic ?? "", emit, active: true };
      handles.push(handle);
      note({ kind: "activate", type: id, topic: handle.topic });
      return handle;
    },
    async deactivate(handle) {
      handle.active = false;
      note({ kind: "deactivate", type: id, topic: handle.topic });
    },
  };
}

const badArm: TriggerType<{ topic?: string }, JsonValue, null> = {
  id: "verify.bad-arm",
  name: "Fixture trigger that cannot arm",
  description: "activate always throws",
  icon: "i-lucide-zap-off",
  configSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  cluster: "replicated",
  async activate() {
    note({ kind: "activate-refused", type: "verify.bad-arm" });
    throw new Error("the fixture refuses to arm");
  },
  async deactivate() {},
};

const hangArm: TriggerType<{ topic?: string }, JsonValue, null> = {
  id: "verify.hang-arm",
  name: "Fixture trigger that never arms",
  description: "activate never settles",
  icon: "i-lucide-hourglass",
  configSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  cluster: "replicated",
  activate: () => new Promise<null>(() => {}),
  async deactivate() {},
};

const hangDisarm: TriggerType<{ topic?: string }, JsonValue, Handle> = {
  ...trigger("verify.hang-disarm", "Fixture trigger that never disarms", "replicated"),
  async deactivate(handle) {
    note({ kind: "deactivate-start", type: "verify.hang-disarm", topic: handle.topic });
    await new Promise<never>(() => {});
  },
};

const echo: ActionType<{ value?: JsonValue; n?: number }, JsonObject> = {
  id: "verify.echo",
  name: "Fixture echo",
  description: "Returns its input; reads and computes only",
  icon: "i-lucide-repeat",
  sideEffects: false,
  inputSchema: { type: "object", properties: { value: {}, n: { type: "number" } } },
  outputSchema: { type: "object", properties: { value: {}, n: { type: "number" } } },
  async execute(input) {
    return { value: input.value ?? null, n: input.n ?? null };
  },
};

interface EffectInput {
  label?: string;
}

function effect(id: string, flavour: "both" | "execute-only" | "pure"): ActionType<EffectInput, JsonObject> {
  const base: ActionType<EffectInput, JsonObject> = {
    id,
    name: `Fixture ${id}`,
    description: `Records what ran in the ledger (${flavour})`,
    icon: "i-lucide-send",
    inputSchema: { type: "object", properties: { label: { ...STRING_SCHEMA, title: "Label" } } },
    outputSchema: { type: "object", properties: { mode: STRING_SCHEMA, label: STRING_SCHEMA } },
    async execute(input, ctx) {
      note({ kind: "execute", type: id, label: input.label ?? "", ctxDryRun: ctx.dryRun ?? false, procedureId: ctx.procedureId, runId: ctx.runId, nodeId: ctx.nodeId });
      return { mode: "executed", label: input.label ?? "" };
    },
  };
  if (flavour === "both" || flavour === "pure") {
    base.dryRun = async (input, ctx) => {
      note({ kind: "dry-run", type: id, label: input.label ?? "", ctxDryRun: ctx.dryRun ?? false, procedureId: ctx.procedureId, runId: ctx.runId, nodeId: ctx.nodeId });
      return { mode: "simulated", label: input.label ?? "" };
    };
  }
  if (flavour === "pure") base.sideEffects = false;
  return base;
}

interface FailInput {
  message?: string;
}

const failing: ActionType<FailInput, JsonObject> = {
  id: "verify.fail",
  name: "Fixture failure",
  description: "Throws an Error",
  icon: "i-lucide-bomb",
  inputSchema: { type: "object", properties: { message: STRING_SCHEMA } },
  outputSchema: { type: "object" },
  async execute(input) {
    throw new Error(input.message ?? "boom");
  },
};

interface ThrowInput {
  kind?: string;
}

/** The non-Error values the `verify.throw` action throws, by name. */
function thrownValue(kind: string): JsonValue | undefined {
  switch (kind) {
    case "number":
      return 42;
    case "object":
      return { code: "E_FIXTURE", detail: "object failure" };
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "empty-string":
      return "";
    case "array":
      return ["a", "b"];
    default:
      return "plain string failure";
  }
}

/** Throws a value that is not an Error: a string, a number, a plain object, null, undefined, a symbol-free primitive. */
const throwing: ActionType<ThrowInput, JsonObject> = {
  id: "verify.throw",
  name: "Fixture throw of a non-Error value",
  description: "Throws what `kind` names: string, number, object, null, undefined, empty-string, array",
  icon: "i-lucide-bomb",
  inputSchema: { type: "object", properties: { kind: STRING_SCHEMA } },
  outputSchema: { type: "object" },
  async execute(input) {
    throw thrownValue(input.kind ?? "string");
  },
};

const arrayOut: ActionType<unknown, JsonObject> = {
  id: "verify.array-output",
  name: "Fixture array output",
  description: "Resolves with an array, which a run refuses",
  icon: "i-lucide-brackets",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  execute: async () => anyObject.parse([1, 2]),
};

const stringOut: ActionType<unknown, JsonObject> = {
  id: "verify.string-output",
  name: "Fixture string output",
  description: "Resolves with a string, which a run refuses",
  icon: "i-lucide-quote",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  execute: async () => anyObject.parse("text"),
};

const nothing: ActionType<unknown, void> = {
  id: "verify.nothing",
  name: "Fixture nothing",
  description: "Resolves with nothing",
  icon: "i-lucide-circle-slash",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  async execute() {},
};

interface LogInput {
  message?: string;
}

const logging: ActionType<LogInput, JsonObject> = {
  id: "verify.log-levels",
  name: "Fixture log levels",
  description: "Logs at each level with a structured value",
  icon: "i-lucide-scroll-text",
  sideEffects: false,
  inputSchema: { type: "object", properties: { message: STRING_SCHEMA } },
  outputSchema: { type: "object" },
  async execute(input, ctx) {
    ctx.log("info", `info ${input.message ?? ""}`, { level: "info", list: [1, 2, 3] });
    ctx.log("warn", `warn ${input.message ?? ""}`, "text value");
    ctx.log("error", `error ${input.message ?? ""}`);
    return {};
  },
};

interface FlakyInput {
  key?: string;
  failTimes?: number;
}

const flaky: ActionType<FlakyInput, JsonObject> = {
  id: "verify.flaky",
  name: "Fixture flaky action",
  description: "Fails its first `failTimes` calls per key, then succeeds",
  icon: "i-lucide-dice-5",
  inputSchema: { type: "object", properties: { key: STRING_SCHEMA, failTimes: { type: "number" } } },
  outputSchema: { type: "object", properties: { attempt: { type: "number" } } },
  async execute(input) {
    const attempt = bump(`flaky:${input.key ?? ""}`);
    note({ kind: "flaky", key: input.key ?? "", attempt });
    if (attempt <= (input.failTimes ?? 0)) throw new Error(`flaky failure ${attempt}`);
    return { attempt };
  },
};

interface TickInput {
  key?: string;
}

const tick: ActionType<TickInput, JsonObject> = {
  id: "verify.tick",
  name: "Fixture tick",
  description: "Counts its calls per key and records each in the ledger",
  icon: "i-lucide-hash",
  inputSchema: { type: "object", properties: { key: STRING_SCHEMA } },
  outputSchema: { type: "object", properties: { count: { type: "number" } } },
  async execute(input, ctx) {
    const count = bump(`tick:${input.key ?? ""}`);
    note({ kind: "tick", key: input.key ?? "", count, at: Date.now(), nodeId: ctx.nodeId });
    return { count };
  },
};

interface SleepInput {
  ms?: number;
  key?: string;
}

const sleeping: ActionType<SleepInput, JsonObject> = {
  id: "verify.sleep",
  name: "Fixture sleep",
  description: "Waits `ms` milliseconds, recording its start and end",
  icon: "i-lucide-timer",
  inputSchema: { type: "object", properties: { ms: { type: "number" }, key: STRING_SCHEMA } },
  outputSchema: { type: "object" },
  async execute(input) {
    note({ kind: "sleep-start", key: input.key ?? "", at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, input.ms ?? 0));
    note({ kind: "sleep-end", key: input.key ?? "", at: Date.now() });
    return {};
  },
};

const context: ActionType<unknown, JsonObject> = {
  id: "verify.context",
  name: "Fixture context",
  description: "Returns the execution context's identifiers and dryRun",
  icon: "i-lucide-info",
  sideEffects: false,
  inputSchema: { type: "object" },
  outputSchema: { type: "object", properties: { procedureId: STRING_SCHEMA, runId: STRING_SCHEMA, nodeId: STRING_SCHEMA, dryRun: { type: "boolean" } } },
  async execute(_input, ctx) {
    return { procedureId: ctx.procedureId, runId: ctx.runId, nodeId: ctx.nodeId, dryRun: ctx.dryRun ?? false };
  },
};

const contextKeys: ActionType<unknown, JsonObject> = {
  id: "verify.context-shape",
  name: "Fixture context shape",
  description: "Returns the names of the execution context's keys",
  icon: "i-lucide-list",
  sideEffects: false,
  inputSchema: { type: "object" },
  outputSchema: { type: "object", properties: { keys: { type: "array" }, hasTenant: { type: "boolean" }, hasUser: { type: "boolean" } } },
  async execute(_input, ctx) {
    const keys = Object.keys(ctx).sort();
    return { keys, hasTenant: keys.includes("tenantId"), hasUser: keys.some((key) => /user/i.test(key)) };
  },
};

const upper: DataNodeType<{ text?: string }, JsonObject> = {
  id: "verify.upper",
  category: "Verify",
  name: "Fixture upper-case",
  description: "Upper-cases its text",
  icon: "i-lucide-case-upper",
  inputSchema: { type: "object", properties: { text: { ...STRING_SCHEMA, default: "fallback" } } },
  outputSchema: { type: "object", properties: { text: STRING_SCHEMA } },
  evaluate: (input) => ({ text: (input.text ?? "").toUpperCase() }),
};

const configured: DataNodeType<{ text?: string; suffix?: string }, JsonObject> = {
  id: "verify.suffix",
  category: "Verify",
  name: "Fixture suffix",
  description: "Appends the configured suffix to its text; the suffix is a config field, not a port",
  icon: "i-lucide-plus",
  inputSchema: { type: "object", properties: { text: STRING_SCHEMA } },
  configSchema: { type: "object", properties: { suffix: { ...STRING_SCHEMA, title: "Suffix" } } },
  outputSchema: { type: "object", properties: { text: STRING_SCHEMA } },
  evaluate: (input) => ({ text: `${input.text ?? ""}${input.suffix ?? ""}` }),
};

const badNode: DataNodeType<unknown, JsonObject> = {
  id: "verify.bad-data",
  category: "Verify",
  name: "Fixture bad data node",
  description: "Evaluates to an array",
  icon: "i-lucide-bug",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  evaluate: () => anyObject.parse([1]),
};

const throwingNode: DataNodeType<unknown, JsonObject> = {
  id: "verify.throwing-data",
  category: "Verify",
  name: "Fixture throwing data node",
  description: "Throws while evaluating",
  icon: "i-lucide-bug",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  evaluate: () => {
    throw new Error("data node exploded");
  },
};

/** Every fixture definition by kind and id, so a journey can unregister one and register it again. */
export const definitions = {
  trigger: new Map<string, TriggerType>(),
  action: new Map<string, ActionType>(),
  data: new Map<string, DataNodeType>(),
};

function remember<T extends { id: string }>(map: Map<string, T>, value: T): T {
  map.set(value.id, value);
  return value;
}

/**
 * Registers every fixture node type. The `verify.event` trigger is
 * replicated and `verify.leader-event` singleton; both fire when a journey
 * calls `POST /verify-auto/emit`.
 */
export function registerAll(): void {
  const triggers: TriggerType[] = [trigger("verify.event", "Fixture event", "replicated"), trigger("verify.leader-event", "Fixture leader event", "singleton"), badArm, hangArm, hangDisarm];
  for (const value of triggers) RegisterTriggerType(remember(definitions.trigger, value));
  const actions: ActionType[] = [echo, effect("verify.effect", "both"), effect("verify.effect-nodry", "execute-only"), effect("verify.effect-pure", "pure"), failing, throwing, arrayOut, stringOut, nothing, logging, flaky, tick, sleeping, context, contextKeys];
  for (const value of actions) RegisterActionType(remember(definitions.action, value));
  const nodes: DataNodeType[] = [upper, configured, badNode, throwingNode];
  for (const value of nodes) RegisterDataNodeType(remember(definitions.data, value));
}

export function unregisterType(kind: "trigger" | "action" | "data", id: string): void {
  if (kind === "trigger") UnregisterTriggerType(id);
  else if (kind === "action") UnregisterActionType(id);
  else UnregisterDataNodeType(id);
}

export function reregisterType(kind: "trigger" | "action" | "data", id: string): boolean {
  if (kind === "trigger") {
    const found = definitions.trigger.get(id);
    if (found) RegisterTriggerType(found);
    return found !== undefined;
  }
  if (kind === "action") {
    const found = definitions.action.get(id);
    if (found) RegisterActionType(found);
    return found !== undefined;
  }
  const found = definitions.data.get(id);
  if (found) RegisterDataNodeType(found);
  return found !== undefined;
}


/** What `POST /verify-auto/types/define` takes: a node type a journey invents at run time. */
export interface DefinedType {
  kind: "trigger" | "action" | "data";
  id: string;
  name: string;
  description?: string;
  icon?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  configSchema?: JsonSchema;
  cluster?: "singleton" | "replicated";
  category?: string;
  output?: JsonObject;
  sideEffects?: boolean;
  dryRunOutput?: JsonObject;
  /** A trigger whose first `deactivate` throws and later ones succeed, so a journey sees the retry. */
  deactivation?: "throw-once" | "hang-once";
}

/**
 * Registers a node type built from JSON, so a journey can register one late
 * (after the module armed its procedures), register the same id twice with
 * different names, or give a schema default. An action or data node
 * resolves with `output` when given, else with its input; `dryRunOutput`
 * gives an action a `dryRun` that resolves with it. A trigger is a
 * `verify.event` look-alike of the given cluster mode.
 */
export function defineType(spec: DefinedType): boolean {
  const common = { id: spec.id, name: spec.name, description: spec.description ?? `Defined ${spec.id}`, icon: spec.icon ?? "i-lucide-puzzle" };
  if (spec.kind === "trigger") {
    const base = trigger(spec.id, spec.name, spec.cluster ?? "replicated");
    const deactivate: typeof base.deactivate = (handle) => base.deactivate(handle);
    let thrown = false;
    const refuseOnce: typeof deactivate = async (handle) => {
      if (thrown) return deactivate(handle);
      thrown = true;
      if (spec.deactivation === "hang-once") {
        note({ kind: "deactivate-hung", type: spec.id, topic: handle.topic });
        return new Promise<void>(() => {});
      }
      note({ kind: "deactivate-refused", type: spec.id, topic: handle.topic });
      throw new Error("the fixture refuses to deactivate");
    };
    RegisterTriggerType(remember(definitions.trigger, { ...base, description: common.description, icon: common.icon, deactivate: spec.deactivation === undefined ? deactivate : refuseOnce }));
    return true;
  }
  if (spec.kind === "action") {
    const action: ActionType<JsonObject, JsonObject> = {
      ...common,
      inputSchema: spec.inputSchema ?? { type: "object" },
      outputSchema: spec.outputSchema ?? { type: "object" },
      async execute(input, ctx) {
        note({ kind: "defined-execute", type: spec.id, ctxDryRun: ctx.dryRun ?? false, input });
        return spec.output === undefined ? input : spec.output;
      },
    };
    if (spec.sideEffects !== undefined) action.sideEffects = spec.sideEffects;
    const dryOutput = spec.dryRunOutput;
    if (dryOutput !== undefined) {
      action.dryRun = async (input, ctx) => {
        note({ kind: "defined-dry-run", type: spec.id, ctxDryRun: ctx.dryRun ?? false, input });
        return dryOutput;
      };
    }
    RegisterActionType(remember(definitions.action, action));
    return true;
  }
  const node: DataNodeType<JsonObject, JsonObject> = {
    ...common,
    category: spec.category ?? "Verify",
    inputSchema: spec.inputSchema ?? { type: "object" },
    outputSchema: spec.outputSchema ?? { type: "object" },
    evaluate: (input) => (spec.output === undefined ? input : spec.output),
  };
  if (spec.configSchema) node.configSchema = spec.configSchema;
  RegisterDataNodeType(remember(definitions.data, node));
  return true;
}
