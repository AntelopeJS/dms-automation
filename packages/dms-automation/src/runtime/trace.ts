import type { ProcedureGraph } from "../types/graph";
import type { LogEntry, RunLog } from "../types/runLog";
import { type StepName, stepName } from "./describe";

/** How a step of a run ended. */
export type StepStatus = "ok" | "failed" | "running";

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
}

/** A top-level step of the graph that no fire reached. */
export interface SkippedStep {
  nodeId: string;
  name: StepName;
}

export interface RunTrace {
  steps: TraceStep[];
  skipped: SkippedStep[];
}

interface StepValue {
  durationMs?: number;
  inputs?: unknown;
  output?: unknown;
}

const NOT_A_STEP = new Set(["data", "groupInput", "groupOutput"]);

/** The trigger a run started from, and what it received. */
export interface TriggerSeed {
  nodeId: string;
  payload: unknown;
}

// The executor seeds the walk with the trigger's output instead of running
// it, so the log has no step for it: the trace starts with one, at 0 ms,
// whose output is the payload.
function triggerStep(
  graph: ProcedureGraph | undefined,
  log: RunLog | undefined,
  trigger: TriggerSeed,
): TraceStep {
  return {
    nodeId: trigger.nodeId,
    name: graph ? stepName(graph, trigger.nodeId) : { nodeId: trigger.nodeId },
    fireId: log?.fires.find((f) => f.parentFireId === null)?.id ?? "",
    startMs: 0,
    durationMs: 0,
    status: "ok",
    output: { type: typeof trigger.payload, value: trigger.payload },
  };
}

function valueOf(entry: LogEntry): StepValue {
  return entry.value && typeof entry.value === "object"
    ? (entry.value as StepValue)
    : {};
}

function closeStep(step: TraceStep, entry: LogEntry, status: StepStatus) {
  const value = valueOf(entry);
  step.status = status;
  step.durationMs = value.durationMs ?? entry.ts - step.startMs;
  if (value.inputs !== undefined) step.inputs = value.inputs;
  if (value.output !== undefined) step.output = value.output;
  if (status === "failed") step.error = entry.message;
}

/**
 * Read the steps of a run from its log. Each "executing" entry opens a step,
 * the next "executed" or error entry of the same node and fire closes it. A
 * log written before steps recorded their duration still gives the order and
 * the failures, without timings.
 */
export function traceOf(
  graph: ProcedureGraph | undefined,
  log: RunLog | undefined,
  trigger?: TriggerSeed,
): RunTrace {
  const steps: TraceStep[] = trigger ? [triggerStep(graph, log, trigger)] : [];
  const open = new Map<string, TraceStep>();
  const name = (id: string): StepName =>
    graph ? stepName(graph, id) : { nodeId: id };
  for (const entry of log?.entries ?? []) {
    if (entry.source !== "exec" || !entry.nodeId) continue;
    if (entry.nodeKind && NOT_A_STEP.has(entry.nodeKind)) continue;
    const key = `${entry.fireId}#${entry.nodeId}`;
    if (entry.message === "executing") {
      const step: TraceStep = {
        nodeId: entry.nodeId,
        name: name(entry.nodeId),
        fireId: entry.fireId,
        startMs: entry.ts,
        durationMs: null,
        status: "running",
      };
      steps.push(step);
      open.set(key, step);
      continue;
    }
    const step = open.get(key);
    if (!step) continue;
    if (entry.message === "executed") closeStep(step, entry, "ok");
    else if (entry.level === "error") closeStep(step, entry, "failed");
    else continue;
    open.delete(key);
  }
  return { steps, skipped: skippedSteps(graph, steps) };
}

function skippedSteps(
  graph: ProcedureGraph | undefined,
  steps: readonly TraceStep[],
): SkippedStep[] {
  if (!graph) return [];
  const reached = new Set(steps.map((s) => s.nodeId.split("__")[0]));
  return graph.nodes
    .filter((n) => !NOT_A_STEP.has(n.kind) && n.kind !== "trigger")
    .filter((n) => !reached.has(n.id))
    .map((n) => ({ nodeId: n.id, name: stepName(graph, n.id) }));
}
