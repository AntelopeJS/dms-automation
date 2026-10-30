import type { JsonSchema } from "@antelopejs/interface-dms-automation";
import { isPropertyBag } from "../types/guards";
import type { GraphNode, ProcedureGraph } from "../types/graph";
import type { FireNode, LogEntry, RunLog } from "../types/runLog";
/**
 * Side-effect import: every `nodes/<kind>.ts` registers itself on load,
 * so anything consuming the registry (the `/api/automation/node-kinds`
 * route, the validator, executors) sees the built-ins immediately —
 * not only after the first run.
 */
import "./builtins";
import { redactHeaders } from "./boundRunLog";
import { labelOf } from "./describe";
import type { ExecutionResult } from "./executionResult";
import { flattenGroups } from "./flatten";
import { type NodeCtx, nodeKinds } from "./nodeKinds";
import { registry } from "./registry";
import {
  DataCache,
  type DataNodeEvaluator,
  resolveInputs,
  schemaDefaults,
} from "./resolveInputs";
import type { TemplateCache } from "./resolveSubgraph";
import { propertiesOf } from "./schemaProperties";
import { SubWalk } from "./subwalk";
import { validateGraph } from "./validate";

export interface RunOptions {
  procedureId?: string;
  templateCache?: TemplateCache;
  /** A test run: actions that can simulate do (see `ActionType.dryRun`). */
  dryRun?: boolean;
}

interface RunCtx {
  procedureId: string;
  runId: string;
  dryRun: boolean;
  runStart: number;
  /** Accumulating fire tree for this run. */
  fires: FireNode[];
  /** Accumulating log entries, each attached to a fire by id. */
  entries: LogEntry[];
  /** Monotonic counter for minting fire ids within this run. */
  fireSeq: { n: number };
  /**
   * Monotonic per-run event counter. Bumped on every openFire and
   * appendEntry call so the runs UI has a stable secondary key for sorting
   * when `ts` ties (sub-millisecond iteration runs stamp identical `ts`).
   */
  eventSeq: { n: number };
  /** Fire currently being processed; log() attaches here. */
  currentFireId: string;
  cache: DataCache;
  signal: AbortSignal;
  /**
   * The node each error was first thrown at. Shared by every nested context:
   * a rethrow through the enclosing nodes keeps the innermost one, whatever
   * else failed meanwhile (a sibling parallel branch, an error a try/catch
   * swallowed).
   */
  failedAt: Map<unknown, string>;
}

function nowOffset(start: number): number {
  return Date.now() - start;
}

function mintFireId(runCtx: RunCtx): string {
  const id = `${runCtx.runId}-f${runCtx.fireSeq.n}`;
  runCtx.fireSeq.n += 1;
  return id;
}

function openFire(
  runCtx: RunCtx,
  init: Omit<FireNode, "id" | "ts" | "seq">,
): FireNode {
  const fire: FireNode = {
    id: mintFireId(runCtx),
    ts: nowOffset(runCtx.runStart),
    seq: runCtx.eventSeq.n++,
    ...init,
  };
  runCtx.fires.push(fire);
  return fire;
}

function closeFire(runCtx: RunCtx, fire: FireNode): void {
  fire.closedAt = nowOffset(runCtx.runStart);
}

/** What goes on one log line. `source`, `level` and `message` were adjacent
 * string parameters, where a swap read as a valid call. */
type AppendedEntry = Pick<
  LogEntry,
  "source" | "level" | "message" | "value"
> & { node?: { id: string; kind: string } };

/**
 * `value` is set rather than spread: an entry without one has no `value`
 * key at all, which is what the wire format and its readers expect.
 */
function appendEntry(
  runCtx: RunCtx,
  { source, level, message, node, value }: AppendedEntry,
): void {
  const entry: LogEntry = {
    fireId: runCtx.currentFireId,
    ts: nowOffset(runCtx.runStart),
    seq: runCtx.eventSeq.n++,
    level,
    source,
    nodeId: node?.id,
    nodeKind: node?.kind,
    message,
  };
  if (value !== undefined) entry.value = value;
  runCtx.entries.push(entry);
}

interface DescribedValue {
  type: string;
  value: unknown;
}

function describeValue(v: unknown): DescribedValue {
  if (v === null) return { type: "null", value: null };
  if (Array.isArray(v)) return { type: "array", value: v };
  return { type: typeof v, value: v };
}

function describeRecord(obj: Record<string, unknown>) {
  const out: Record<string, DescribedValue> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = describeValue(v);
  return out;
}

/**
 * Execute a ProcedureGraph starting from `triggerNodeId`. The executor
 * looks actions up from the kind registry; no per-run hook or registry
 * handle is needed from the caller.
 *
 * No caller supplies an external abort signal today; keep a never-aborting
 * signal so the node-execution contract (NodeCtx.signal) and the executor's
 * cancellation guards stay in place for future cancellable runs.
 *
 * Open a synthetic "run" fire so the initial "run started" entry has
 * somewhere to attach. The fire's source is the trigger seed; port is
 * null (no port discrimination at bootstrap).
 *
 * Flatten away all group nodes so the executor never has to special-case
 * them. After this point the graph is a flat ProcedureGraph with no
 * `group` / `groupInput` / `groupOutput` nodes; inner-node ids carry a
 * `<groupId>__` prefix per nesting level.
 */
export async function run(
  graph: ProcedureGraph,
  triggerNodeId: string,
  payload: unknown,
  options: RunOptions = {},
): Promise<ExecutionResult> {
  const procedureId = options.procedureId ?? "unknown";
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runStart = Date.now();
  const signal = new AbortController().signal;

  const cache = new DataCache();
  const runCtx: RunCtx = {
    procedureId,
    runId,
    dryRun: options.dryRun === true,
    runStart,
    fires: [],
    entries: [],
    fireSeq: { n: 0 },
    eventSeq: { n: 0 },
    currentFireId: "",
    cache,
    signal,
    failedAt: new Map(),
  };

  const rootFire = openFire(runCtx, {
    parentFireId: null,
    sourceNodeId: triggerNodeId,
    port: null,
  });
  runCtx.currentFireId = rootFire.id;
  appendEntry(runCtx, {
    source: "exec",
    level: "info",
    message: "run started",
  });

  const v = validateGraph(graph);
  if (!v.ok) {
    const errorMessage = `graph validation failed: ${v.errors.join("; ")}`;
    appendEntry(runCtx, {
      source: "exec",
      level: "error",
      message: `run failed: ${errorMessage}`,
    });
    closeFire(runCtx, rootFire);
    return emptyFailure(errorMessage, runCtx);
  }

  let flatGraph: ProcedureGraph;
  try {
    flatGraph = flattenGroups(graph, options.templateCache);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendEntry(runCtx, {
      source: "exec",
      level: "error",
      message: `flatten failed: ${message}`,
    });
    closeFire(runCtx, rootFire);
    return emptyFailure(message, runCtx);
  }

  cache.setOutput(triggerNodeId, payload);
  const topSubWalk = new SubWalk(flatGraph, triggerNodeId, undefined);
  try {
    await runSubWalk(topSubWalk, runCtx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    closeFire(runCtx, rootFire);
    const result: ExecutionResult = {
      status: "failed",
      errorMessage: message,
      logs: toRunLog(runCtx),
    };
    const failedNodeId = runCtx.failedAt.get(err);
    if (failedNodeId) result.failedNodeId = failedNodeId;
    return result;
  }

  appendEntry(runCtx, { source: "exec", level: "info", message: "run ok" });
  closeFire(runCtx, rootFire);
  return {
    status: "ok",
    logs: toRunLog(runCtx),
  };
}

function toRunLog(runCtx: RunCtx): RunLog {
  return { fires: runCtx.fires, entries: runCtx.entries };
}

function emptyFailure(errorMessage: string, runCtx: RunCtx): ExecutionResult {
  return {
    status: "failed",
    errorMessage,
    logs: toRunLog(runCtx),
  };
}

/**
 * Run a SubWalk to completion: topo-walk the trigger-reachable subgraph
 * from the SubWalk's seed, dispatching each node through `nodeKinds`.
 * Group nodes never reach this loop — `flattenGroups` inlined them before
 * the walk started.
 *
 * The caller is responsible for opening/closing the enclosing fire and
 * setting `runCtx.currentFireId` before calling this function.
 *
 * Inside the try: a data node that fails while the inputs are read (a
 * cycle, an unknown type, a bad value) fails this step, not the run alone.
 */
async function runSubWalk(subwalk: SubWalk, runCtx: RunCtx): Promise<void> {
  const graph = subwalk.graph;
  const order = subwalk.topoOrder();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const evalDataNode = makeDataNodeEvaluator(graph, nodeById, runCtx);
  const resolveNodeInputs = (n: GraphNode) =>
    resolveInputs(
      n,
      graph.dataEdges,
      runCtx.cache,
      evalDataNode,
      inputDefaults(n),
    );

  for (const nodeId of order) {
    if (runCtx.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const node = nodeById.get(nodeId);
    if (!node) {
      throw new Error(
        `node "${nodeId}" referenced in trigger edges does not exist`,
      );
    }
    if (node.kind === "data") continue;
    if (!subwalk.hasLiveIncoming(nodeId)) continue;

    appendEntry(runCtx, {
      source: "exec",
      level: "info",
      message: "executing",
      node: { id: nodeId, kind: node.kind },
    });

    const nodeStart = Date.now();
    let inputs: ReturnType<typeof resolveNodeInputs> = {};
    try {
      inputs = resolveNodeInputs(node);
      const entry = nodeKinds.get(node.kind);
      if (!entry) {
        throw new Error(`unsupported node kind "${node.kind}"`);
      }
      const contState: ContinuationState = { explicit: [] };
      const ctx = makeNodeCtx(
        node,
        subwalk,
        runCtx,
        resolveNodeInputs,
        contState,
      );
      await entry.execute(node, inputs, ctx);
      if (contState.explicit.length > 0) {
        subwalk.recordBranch(node.id, contState.explicit);
      } else {
        const claimed = subwalk.claimedPorts.get(node.id);
        const auto = entry.meta.continuationPorts.filter(
          (p) => !claimed?.has(p),
        );
        subwalk.recordBranch(node.id, auto);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!runCtx.failedAt.has(err)) runCtx.failedAt.set(err, nodeId);
      appendEntry(runCtx, {
        source: "exec",
        level: "error",
        message,
        node: { id: nodeId, kind: node.kind },
        value: {
          durationMs: Date.now() - nodeStart,
          inputs: describeRecord(redacted(inputs, typeOf(node)?.inputSchema)),
        },
      });
      throw err;
    }
    const output = runCtx.cache.getOutput(nodeId);
    appendEntry(runCtx, {
      source: "exec",
      level: "info",
      message: "executed",
      node: { id: nodeId, kind: node.kind },
      value: {
        durationMs: Date.now() - nodeStart,
        inputs: describeRecord(redacted(inputs, typeOf(node)?.inputSchema)),
        output: describeValue(
          isPropertyBag(output) && !Array.isArray(output)
            ? redacted(output, typeOf(node)?.outputSchema)
            : output,
        ),
      },
    });
    subwalk.markExecuted(nodeId);
  }
}

/**
 * A data node's error, saying where its empty wired inputs come from: the
 * cause is usually upstream (a division by zero, a field not found), not in
 * the node that fails on the empty value.
 */
function withEmptySources<E>(
  err: E,
  node: GraphNode,
  inputs: ReturnType<typeof resolveInputs>,
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
): E | Error {
  if (!(err instanceof Error)) return err;
  const sources = graph.dataEdges
    .filter((e) => e.to.node === node.id)
    .filter(
      (e) => inputs[e.to.field] === null || inputs[e.to.field] === undefined,
    )
    .map((e) => {
      const source = nodeById.get(e.from.node);
      const name =
        (source && (labelOf(source) ?? source.typeId ?? source.kind)) ??
        e.from.node;
      return `${e.to.field} comes from ${name} (${e.from.port}), which gave no value`;
    });
  if (sources.length === 0) return err;
  return new Error(`${err.message}. ${sources.join("; ")}.`, { cause: err });
}

/** The registered type behind an action or a data node, if any. */
function typeOf(node: GraphNode):
  | {
      inputSchema: JsonSchema;
      outputSchema: JsonSchema;
      configSchema?: JsonSchema;
    }
  | undefined {
  if (!node.typeId) return undefined;
  if (node.kind === "action") return registry.getAction(node.typeId);
  if (node.kind === "data") return registry.getDataNode(node.typeId);
  return undefined;
}

/** The defaults the node's type declares, applied under its config. */
function inputDefaults(node: GraphNode) {
  const type = typeOf(node);
  return {
    ...schemaDefaults(type?.inputSchema),
    ...schemaDefaults(type?.configSchema),
  };
}

/**
 * A copy of `values` fit for the run log: the fields `schema` marks
 * `"x-redact": "headers"` (HTTP header maps) have their credentials masked.
 * Only the log is masked; the node ran with the real values.
 */
function redacted(
  values: Record<string, unknown>,
  schema: JsonSchema | undefined,
) {
  const properties = propertiesOf(schema);
  const out = { ...values };
  for (const [name, prop] of Object.entries(properties)) {
    if (prop["x-redact"] === "headers" && Object.hasOwn(out, name)) {
      out[name] = redactHeaders(out[name]);
    }
  }
  return out;
}

/**
 * Per-execute continuation state. After execute returns, the outer walk
 * applies it to branchDecisions: explicit ports propagate alone (the others
 * are dead); by default the metadata's continuationPorts propagate, minus any
 * port the execute already claimed via fireTrigger. Side ports stay dead even
 * if never fired (an empty foreach must not propagate `body`).
 */
interface ContinuationState {
  explicit: string[];
}

function makeNodeCtx(
  node: GraphNode,
  subwalk: SubWalk,
  runCtx: RunCtx,
  resolveNodeInputs: (n: GraphNode) => ReturnType<NodeCtx["resolveInputs"]>,
  contState: ContinuationState,
): NodeCtx {
  return {
    procedureId: runCtx.procedureId,
    runId: runCtx.runId,
    nodeId: node.id,
    signal: runCtx.signal,
    dryRun: runCtx.dryRun,
    log(level, message, value) {
      appendEntry(runCtx, {
        source: "log",
        level,
        message,
        node: { id: node.id, kind: node.kind },
        value,
      });
    },
    setOutputs(values) {
      runCtx.cache.setOutput(node.id, values);
    },
    fireTrigger(port, opts) {
      return fireFrom(node.id, port, subwalk, runCtx, opts);
    },
    continueWith(port) {
      contState.explicit.push(port);
    },
    resolveInputs() {
      return resolveNodeInputs(node);
    },
  };
}

/**
 * Open a child fire, claim the port on the outer sub-walk, run a nested
 * sub-walk on `(sourceNodeId, port)`, then close the fire.
 *
 * Only `claimPort` is recorded — `branchDecisions` is reserved for
 * continuation ports (chosen via `ctx.continueWith`, or defaulted by the
 * outer walk after execute returns).
 * That separation is what lets a node fire `body` N times as side fires
 * AND still have `main` auto-propagate as the linear continuation.
 */
async function fireFrom(
  sourceNodeId: string,
  port: string,
  outerSubWalk: SubWalk,
  runCtx: RunCtx,
  opts?: { iteration?: number },
): Promise<void> {
  outerSubWalk.claimPort(sourceNodeId, port);

  const fireInit: Omit<FireNode, "id" | "ts" | "seq"> = {
    parentFireId: runCtx.currentFireId,
    sourceNodeId,
    port,
  };
  if (opts?.iteration !== undefined) fireInit.iteration = opts.iteration;
  const childFire = openFire(runCtx, fireInit);
  const childRunCtx: RunCtx = { ...runCtx, currentFireId: childFire.id };
  const childSubWalk = new SubWalk(outerSubWalk.graph, sourceNodeId, port);
  try {
    await runSubWalk(childSubWalk, childRunCtx);
  } finally {
    closeFire(runCtx, childFire);
  }
}

function makeDataNodeEvaluator(
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
  runCtx: RunCtx,
): DataNodeEvaluator {
  const evalStack = new Set<string>();

  const evaluator: DataNodeEvaluator = (nodeId) => {
    const cached = runCtx.cache.getCachedData(nodeId);
    if (cached !== undefined) return cached;

    const dn = nodeById.get(nodeId);
    if (!dn) return undefined;
    if (dn.kind !== "data") {
      const output = runCtx.cache.getOutput(nodeId);
      return isPropertyBag(output) ? output : undefined;
    }

    if (evalStack.has(nodeId)) {
      throw new Error(`data node cycle detected at "${nodeId}"`);
    }
    if (!dn.typeId) {
      throw new Error(`data node "${nodeId}" is missing typeId`);
    }
    const type = registry.getDataNode(dn.typeId);
    if (!type) {
      throw new Error(
        `data node "${nodeId}" references unknown type "${dn.typeId}"`,
      );
    }

    evalStack.add(nodeId);
    try {
      const inputs = resolveInputs(
        dn,
        graph.dataEdges,
        runCtx.cache,
        evaluator,
        inputDefaults(dn),
      );
      let out: Record<string, unknown>;
      try {
        out = type.evaluate(inputs) as Record<string, unknown>;
      } catch (err) {
        throw withEmptySources(err, dn, inputs, graph, nodeById);
      }
      const deps = graph.dataEdges
        .filter((e) => e.to.node === nodeId)
        .map((e) => e.from.node);
      runCtx.cache.cacheData(nodeId, out, deps);

      const incomingEdges = graph.dataEdges
        .filter((e) => e.to.node === nodeId)
        .map((e) => `${e.from.node}.${e.from.port} → .${e.to.field}`);
      appendEntry(runCtx, {
        source: "exec",
        level: "info",
        message: `evaluated ${dn.typeId}`,
        node: { id: nodeId, kind: "data" },
        value: {
          incomingEdges,
          inputs: describeRecord(inputs),
          output: describeRecord(out),
        },
      });
      return out;
    } finally {
      evalStack.delete(nodeId);
    }
  };

  return evaluator;
}
