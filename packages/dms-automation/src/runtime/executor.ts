import type { GraphNode, ProcedureGraph } from "../types/graph";
import type { FireNode, LogEntry, RunLog } from "../types/runLog";
// Side-effect import: every `nodes/<kind>.ts` registers itself on load,
// so anything consuming the registry (the `/api/automation/node-kinds`
// route, the validator, executors) sees the built-ins immediately —
// not only after the first run.
import "./builtins";
import type { ExecutionResult } from "./executionResult";
import { flattenGroups } from "./flatten";
import { type NodeCtx, nodeKinds } from "./nodeKinds";
import { registry } from "./registry";
import { DataCache, resolveInputs } from "./resolveInputs";
import type { TemplateCache } from "./resolveSubgraph";
import { SubWalk } from "./subwalk";
import { validateGraph } from "./validate";

export interface RunOptions {
  procedureId?: string;
  templateCache?: TemplateCache;
}

interface RunCtx {
  procedureId: string;
  runId: string;
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

function appendEntry(
  runCtx: RunCtx,
  { source, level, message, node, value }: AppendedEntry,
): void {
  // `value` is set rather than spread: an entry without one has no `value`
  // key at all, which is what the wire format and its readers expect.
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

function describeValue(v: unknown): { type: string; value: unknown } {
  if (v === null) return { type: "null", value: null };
  if (Array.isArray(v)) return { type: "array", value: v };
  return { type: typeof v, value: v };
}

function describeRecord(
  obj: Record<string, unknown>,
): Record<string, { type: string; value: unknown }> {
  const out: Record<string, { type: string; value: unknown }> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = describeValue(v);
  return out;
}

/**
 * Execute a ProcedureGraph starting from `triggerNodeId`. The executor
 * looks actions up from the kind registry; no per-run hook or registry
 * handle is needed from the caller.
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
  // No caller supplies an external abort signal today; keep a never-aborting
  // signal so the node-execution contract (NodeCtx.signal) and the executor's
  // cancellation guards stay in place for future cancellable runs.
  const signal = new AbortController().signal;

  const cache = new DataCache();
  const runCtx: RunCtx = {
    procedureId,
    runId,
    runStart,
    fires: [],
    entries: [],
    fireSeq: { n: 0 },
    eventSeq: { n: 0 },
    // Placeholder; replaced as soon as the top-level fire opens below.
    currentFireId: "",
    cache,
    signal,
  };

  // Open a synthetic "run" fire so the initial "run started" entry has
  // somewhere to attach. The fire's source is the trigger seed; port is
  // null (no port discrimination at bootstrap).
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

  // Flatten away all group nodes so the executor never has to special-case
  // them. After this point the graph is a flat ProcedureGraph with no
  // `group` / `groupInput` / `groupOutput` nodes; inner-node ids carry a
  // `<groupId>__` prefix per nesting level.
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
    return {
      status: "failed",
      errorMessage: message,
      logs: toRunLog(runCtx),
    };
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
 */
async function runSubWalk(subwalk: SubWalk, runCtx: RunCtx): Promise<void> {
  const graph = subwalk.graph;
  const order = subwalk.topoOrder();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const evalDataNode = makeDataNodeEvaluator(graph, nodeById, runCtx);
  const resolveNodeInputs = (n: GraphNode): Record<string, unknown> =>
    resolveInputs(n, graph.dataEdges, runCtx.cache, evalDataNode);

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

    const inputs = resolveNodeInputs(node);

    try {
      const entry = nodeKinds.get(node.kind);
      if (!entry) {
        throw new Error(`unsupported node kind "${node.kind}"`);
      }
      // Per-execute continuation state. After execute returns, the outer
      // walk applies it to branchDecisions:
      //   - explicit ports  → just those ports propagate (others dead)
      //   - default         → metadata's continuationPorts minus any
      //                       port the execute already claimed via
      //                       fireTrigger. Side ports stay dead even if
      //                       never fired (e.g. empty foreach must not
      //                       propagate `body`).
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
      appendEntry(runCtx, {
        source: "exec",
        level: "error",
        message,
        node: { id: nodeId, kind: node.kind },
      });
      throw err;
    }
    subwalk.markExecuted(nodeId);
  }
}

interface ContinuationState {
  explicit: string[];
}

function makeNodeCtx(
  node: GraphNode,
  subwalk: SubWalk,
  runCtx: RunCtx,
  resolveNodeInputs: (n: GraphNode) => Record<string, unknown>,
  contState: ContinuationState,
): NodeCtx {
  return {
    procedureId: runCtx.procedureId,
    runId: runCtx.runId,
    nodeId: node.id,
    signal: runCtx.signal,
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
): (id: string) => Record<string, unknown> | undefined {
  const evalStack = new Set<string>();

  const evaluator = (nodeId: string): Record<string, unknown> | undefined => {
    const cached = runCtx.cache.getCachedData(nodeId);
    if (cached !== undefined) return cached;

    const dn = nodeById.get(nodeId);
    if (!dn) return undefined;
    if (dn.kind !== "data") {
      return runCtx.cache.getOutput(nodeId) as
        | Record<string, unknown>
        | undefined;
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
      );
      const out = type.evaluate(inputs) as Record<string, unknown>;
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
