import { isGroupNode, type ProcedureGraph } from "../types/graph";
import type { FireNode, LogEntry, RunLog } from "../types/runLog";
import { type StepName, stepName } from "./describe";

/**
 * How a step of a run ended. `truncated`: its start is in the log but its
 * end was cut from it to keep the run small.
 */
type StepStatus = "ok" | "failed" | "running" | "truncated";

/**
 * One execution of a step in a run, read from its log: when it started
 * (milliseconds after the run started), how long it took, what it received
 * and what it produced. A step inside a loop has one per iteration.
 */
export interface TraceStep {
  nodeId: string;
  name: StepName;
  fireId: string;
  startMs: number;
  durationMs: number | null;
  status: StepStatus;
  error?: string;
  inputs?: unknown;
  output?: unknown;
  /** 0 in the run's own flow, one more inside each loop, try or branch. */
  depth: number;
  /**
   * Index in `steps` of the loop, retry, try/catch or parallel step whose
   * port started this one. Absent in the run's own flow.
   */
  parent?: number;
  /** That step's port: `body`, `try`, `catch`, a parallel branch. */
  port?: string;
  /** The iteration or attempt of that step, from 0. */
  iteration?: number;
  /** The branch the step chose: `then`, a switch case, `exhausted`. */
  branch?: string;
  /** A failure a Try/Catch or a Retry around the step caught. */
  handled?: boolean;
}

/**
 * Why a step of the graph did not run: the branch leading to it was not
 * taken, or the run stopped on a failure before reaching it.
 */
type SkipReason = "branch" | "stopped";

/** A top-level step of the graph that no fire reached. */
interface SkippedStep {
  nodeId: string;
  name: StepName;
  reason: SkipReason;
}

export interface RunTrace {
  steps: TraceStep[];
  /** Empty when the graph is not the one that ran, or the log is cut. */
  skipped: SkippedStep[];
  /** Ids of the trigger edges of the graph the run went along. */
  edgesTaken: string[];
  /** Log entries dropped to keep the run within its size budget. */
  truncated?: number;
}

/** How to read a run's log against a graph. */
export interface TraceOptions {
  /**
   * The graph is a later version than the one that ran: it only names the
   * steps the stored names miss, and nothing is read from its shape.
   */
  outdated?: boolean;
  /** Step names kept with the run (see `stepNamesOf`). */
  names?: Record<string, StepName>;
}

interface StepValue {
  durationMs?: number;
  inputs?: unknown;
  output?: unknown;
}

const NOT_A_STEP = new Set(["data", "groupInput", "groupOutput"]);
const FLAT_ID_SEPARATOR = "__";
const MAIN_PORT = "main";
const BRANCH_MESSAGE = /^branch: (.+)$/;

/** The trigger a run started from, and what it received. */
export interface TriggerSeed {
  nodeId: string;
  payload: unknown;
}

const topLevel = (flatId: string) =>
  flatId.split(FLAT_ID_SEPARATOR)[0] ?? flatId;

/**
 * The executor seeds the walk with the trigger's output instead of running
 * it, so the log has no step for it: the trace starts with one, at 0 ms,
 * whose output is the payload.
 */
function triggerStep(
  log: RunLog | undefined,
  trigger: TriggerSeed,
  name: StepName,
): TraceStep {
  return {
    nodeId: trigger.nodeId,
    name,
    fireId: log?.fires.find((f) => f.parentFireId === null)?.id ?? "",
    startMs: 0,
    durationMs: 0,
    status: "ok",
    output: { type: typeof trigger.payload, value: trigger.payload },
    depth: 0,
  };
}

function valueOf(entry: LogEntry): StepValue {
  return entry.value && typeof entry.value === "object"
    ? (entry.value as StepValue)
    : {};
}

/**
 * A Retry sets `error` on its output only when every attempt failed: it
 * then goes on by its `exhausted` branch.
 */
function closeStep(step: TraceStep, entry: LogEntry, status: StepStatus) {
  const value = valueOf(entry);
  step.status = status;
  step.durationMs = value.durationMs ?? entry.ts - step.startMs;
  if (value.inputs !== undefined) step.inputs = value.inputs;
  if (value.output !== undefined) step.output = value.output;
  if (status === "failed") step.error = entry.message;
  const output = (step.output as { value?: { error?: unknown } } | undefined)
    ?.value;
  if (status === "ok" && step.name.kind === "retry" && output?.error) {
    step.branch = "exhausted";
  }
}

/** How deep a fire is: 0 for the run's own, one more per enclosing port. */
function depthOf(fires: Map<string, FireNode>, fireId: string): number {
  let depth = 0;
  let fire = fires.get(fireId);
  while (fire?.parentFireId) {
    depth += 1;
    fire = fires.get(fire.parentFireId);
  }
  return depth;
}

/**
 * Read the steps of a run from its log. Each "executing" entry opens a step,
 * the next "executed" or error entry of the same node and fire closes it. A
 * log written before steps recorded their duration still gives the order and
 * the failures, without timings.
 *
 * The shape of another version, or a log with a gap, says nothing reliable
 * about the steps this run skipped or the edges it took.
 */
export function traceOf(
  graph: ProcedureGraph | undefined,
  log: RunLog | undefined,
  trigger?: TriggerSeed,
  options: TraceOptions = {},
): RunTrace {
  const name = namer(graph, options);
  const steps: TraceStep[] = trigger
    ? [triggerStep(log, trigger, name(trigger.nodeId, "trigger"))]
    : [];
  readSteps(log, steps, name);
  if (log?.truncated) markCut(steps);
  markHandled(steps);
  const shape = options.outdated ? undefined : graph;
  const trace: RunTrace = {
    steps,
    skipped: log?.truncated ? [] : skippedSteps(shape, steps, name),
    edgesTaken: shape ? edgesTaken(shape, steps, log) : [],
  };
  if (log?.truncated) trace.truncated = log.truncated;
  return trace;
}

function readSteps(
  log: RunLog | undefined,
  steps: TraceStep[],
  name: (id: string, kind?: string) => StepName,
) {
  const fires = new Map((log?.fires ?? []).map((f) => [f.id, f]));
  const open = new Map<string, number>();
  for (const entry of log?.entries ?? []) {
    if (!entry.nodeId) continue;
    if (entry.nodeKind && NOT_A_STEP.has(entry.nodeKind)) continue;
    const key = `${entry.fireId}#${entry.nodeId}`;
    if (entry.source === "log") {
      const branch = BRANCH_MESSAGE.exec(entry.message)?.[1];
      const index = open.get(key);
      if (branch && index !== undefined) steps[index]!.branch = branch;
      continue;
    }
    if (entry.message === "executing") {
      open.set(key, steps.push(openStep(entry, fires, open, name)) - 1);
      continue;
    }
    const index = open.get(key);
    if (index === undefined) continue;
    if (entry.message === "executed") closeStep(steps[index]!, entry, "ok");
    else if (entry.level === "error") {
      closeStep(steps[index]!, entry, "failed");
    } else continue;
    open.delete(key);
  }
}

/** The step that fired this port is still running while its port runs. */
function openStep(
  entry: LogEntry,
  fires: Map<string, FireNode>,
  open: Map<string, number>,
  name: (id: string, kind?: string) => StepName,
): TraceStep {
  const nodeId = entry.nodeId!;
  const step: TraceStep = {
    nodeId,
    name: name(nodeId, entry.nodeKind),
    fireId: entry.fireId,
    startMs: entry.ts,
    durationMs: null,
    status: "running",
    depth: depthOf(fires, entry.fireId),
  };
  const fire = fires.get(entry.fireId);
  if (fire?.parentFireId) {
    const parent = open.get(`${fire.parentFireId}#${fire.sourceNodeId}`);
    if (parent !== undefined) step.parent = parent;
    if (fire.port) step.port = fire.port;
    if (fire.iteration !== undefined) step.iteration = fire.iteration;
  }
  return step;
}

/**
 * Name a step: by the graph that ran first, then by the names kept with the
 * run; a later version of the graph only names what the run's names miss.
 */
function namer(graph: ProcedureGraph | undefined, options: TraceOptions) {
  const fromGraph = (id: string) => {
    const found = graph ? stepName(graph, id) : undefined;
    return found?.kind ? found : undefined;
  };
  const fromRun = (id: string) => options.names?.[id];
  const sources = options.outdated
    ? [fromRun, fromGraph]
    : [fromGraph, fromRun];
  return (id: string, kind?: string): StepName => {
    for (const source of sources) {
      const found = source(id);
      if (found) return found;
    }
    return kind ? { nodeId: id, kind } : { nodeId: id };
  };
}

/**
 * A log cut in the middle can keep a step's start and drop its end: the
 * step did not run on forever, its end is just not known.
 */
function markCut(steps: TraceStep[]) {
  for (const step of steps)
    if (step.status === "running") step.status = "truncated";
}

/**
 * A failure is caught when a step around it — the Try/Catch, the Retry —
 * still ended well.
 */
function markHandled(steps: TraceStep[]) {
  for (const step of steps) {
    if (step.status !== "failed") continue;
    let parent = step.parent;
    while (parent !== undefined) {
      if (steps[parent]!.status === "ok") {
        step.handled = true;
        break;
      }
      parent = steps[parent]!.parent;
    }
  }
}

/** The steps the failure kept from running come first. */
function skippedSteps(
  graph: ProcedureGraph | undefined,
  steps: readonly TraceStep[],
  name: (id: string) => StepName,
): SkippedStep[] {
  if (!graph) return [];
  const reached = new Set(steps.map((s) => topLevel(s.nodeId)));
  const stopped = downstreamOf(
    graph,
    steps
      .filter((s) => s.status === "failed" && !s.handled)
      .map((s) => topLevel(s.nodeId)),
  );
  const skipped = graph.nodes
    .filter((n) => !NOT_A_STEP.has(n.kind) && n.kind !== "trigger")
    .filter((n) => !reached.has(n.id))
    .map((n): SkippedStep => ({
      nodeId: n.id,
      name: name(n.id),
      reason: stopped.has(n.id) ? "stopped" : "branch",
    }));
  return [
    ...skipped.filter((s) => s.reason === "stopped"),
    ...skipped.filter((s) => s.reason === "branch"),
  ];
}

/** Every node a trigger edge leads to, from these nodes on. */
function downstreamOf(graph: ProcedureGraph, from: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of graph.triggerEdges) {
      if (edge.from.node !== id || seen.has(edge.to.node)) continue;
      seen.add(edge.to.node);
      queue.push(edge.to.node);
    }
  }
  return seen;
}

/**
 * The edges the run went along: an edge is taken when its target ran and its
 * source left by that edge's port — a port it fired (a loop body, a try), or
 * the branch it went on by (`then`, a case, `exhausted`, else `main`). A
 * group runs as its inner steps, so an edge leaving one is taken when both
 * ends ran.
 */
function edgesTaken(
  graph: ProcedureGraph,
  steps: readonly TraceStep[],
  log: RunLog | undefined,
): string[] {
  const ran = new Set(steps.map((s) => topLevel(s.nodeId)));
  const left = new Map<string, Set<string>>();
  const leave = (nodeId: string, port: string) => {
    if (nodeId.includes(FLAT_ID_SEPARATOR)) return;
    const ports = left.get(nodeId) ?? new Set<string>();
    ports.add(port);
    left.set(nodeId, ports);
  };
  for (const fire of log?.fires ?? []) {
    if (fire.parentFireId && fire.port) leave(fire.sourceNodeId, fire.port);
  }
  for (const step of steps) {
    if (step.status === "ok") leave(step.nodeId, step.branch ?? MAIN_PORT);
  }
  const groups = new Set(graph.nodes.filter(isGroupNode).map((n) => n.id));
  return graph.triggerEdges
    .filter((edge) => {
      if (!ran.has(edge.to.node)) return false;
      if (groups.has(edge.from.node)) return ran.has(edge.from.node);
      return left.get(edge.from.node)?.has(edge.from.branch ?? MAIN_PORT);
    })
    .map((edge) => edge.id);
}

/**
 * How long each step took in a run, all its iterations added up: what a
 * trace compares with the last success.
 */
export function stepDurations(
  steps: readonly TraceStep[],
): Record<string, number | null> {
  const durations: Record<string, number | null> = {};
  for (const step of steps) {
    const before = durations[step.nodeId];
    durations[step.nodeId] =
      step.durationMs === null
        ? (before ?? null)
        : (before ?? 0) + step.durationMs;
  }
  return durations;
}
