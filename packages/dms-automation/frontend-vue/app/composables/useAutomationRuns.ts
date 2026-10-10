import type { StepName, TriggerSummary } from "../utils/describe";

export type LogLevel = "info" | "warn" | "error";

export interface FireNode {
  id: string;
  parentFireId: string | null;
  sourceNodeId: string;
  port: string | null;
  ts: number;
  seq: number;
  iteration?: number;
  closedAt?: number;
}

export interface LogEntry {
  fireId: string;
  ts: number;
  seq: number;
  level: LogLevel;
  source: "log" | "exec";
  nodeId?: string;
  nodeKind?: string;
  message: string;
  value?: unknown;
}

export interface RunLog {
  fires: FireNode[];
  entries: LogEntry[];
  truncated?: number;
}

/** One execution of a step, read from the run's log by the backend. */
export interface TraceStep {
  nodeId: string;
  name: StepName;
  fireId: string;
  startMs: number;
  durationMs: number | null;
  status: "ok" | "failed" | "running";
  error?: string;
  inputs?: unknown;
  output?: unknown;
}

export interface RunRef {
  runId: string;
  startedAt: string;
  durationMs: number | null;
  stepDurations: Record<string, number | null>;
}

export interface GraphNodeLite {
  id: string;
  kind: string;
  typeId?: string;
  label?: string;
  config?: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface GraphLite {
  nodes: GraphNodeLite[];
  triggerEdges: Array<{
    id: string;
    from: { node: string; branch?: string };
    to: { node: string; branch?: string };
  }>;
  dataEdges: Array<{
    id: string;
    from: { node: string; port: string };
    to: { node: string; field: string };
  }>;
}

/** A run as `GET /runs/:id` answers it, with its trace. */
export interface RunDetail {
  _id: string;
  procedureId: string;
  startedAt: string;
  endedAt?: string | null;
  status: "ok" | "failed";
  errorMessage?: string | null;
  triggerNodeId: string;
  triggerPayload?: string;
  payloadKept: boolean;
  kind?: "run" | "rerun" | "test";
  rerunOf?: string;
  failedNodeId?: string;
  instanceId?: string;
  procedureVersion?: number;
  durationMs: number | null;
  logs?: RunLog;
  procedure: {
    _id: string;
    name: string;
    enabled: boolean;
    version: number;
  } | null;
  graph: GraphLite | null;
  trigger: TriggerSummary | null;
  failedStep: StepName | null;
  trace: {
    steps: TraceStep[];
    skipped: Array<{ nodeId: string; name: StepName }>;
  };
  usualDurationMs: number | null;
  lastSuccess: RunRef | null;
  previous: {
    runId: string;
    startedAt: string;
    status: string;
    errorMessage: string;
  } | null;
  failuresInRow: number;
}

/** The run endpoints the drawer, the trace and the builder share. */
export function useAutomationRuns(apiUrl = "/api/automation") {
  const { $authFetch } = useAuthFetch();

  return {
    getRun(id: string): Promise<RunDetail> {
      return $authFetch<RunDetail>(`${apiUrl}/runs/${id}`);
    },
    rerun(id: string): Promise<{ runId: string }> {
      return $authFetch<{ runId: string }>(`${apiUrl}/runs/${id}/rerun`, {
        method: "POST",
        body: {},
      });
    },
  };
}
