import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/** Options of the run strip: how many runs it draws. */
export interface LastRunsDisplayOptions {
  limit?: number;
}

/**
 * The last runs of a procedure as a strip of bars, green or red, oldest
 * first. Reads a list of statuses (`ok` / `failed`).
 */
@RegisterDisplay("automation:last-runs")
export class LastRunsDisplay extends ColumnDisplay<LastRunsDisplayOptions> {}

/**
 * What starts a procedure or a run, worded in the reader's language: the
 * webhook's method and path, the schedule in words, or the trigger's name.
 * Reads a `TriggerSummary`.
 */
@RegisterDisplay("automation:trigger")
export class TriggerDisplay extends ColumnDisplay<Record<string, never>> {}

/** A step of a procedure by its label or its type's name. Reads a `StepName`. */
@RegisterDisplay("automation:step")
export class StepDisplay extends ColumnDisplay<Record<string, never>> {}
