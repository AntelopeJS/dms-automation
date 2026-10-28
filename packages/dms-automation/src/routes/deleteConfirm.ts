import type {
  ConfirmDialog,
  ConfirmDialogImpact,
} from "@antelopejs/interface-dms/base";
import type { Procedure } from "../db/tables/procedure.table";
import { parseGraphSafe, triggersOf } from "../runtime/describe";
import { cronText } from "../runtime/wording";
import type { ProcedureGraph } from "../types/graph";
import { API_MESSAGES } from "./requests";

const WEEKDAY_KEY = /\.days\.(\w+)$/;

/**
 * A schedule as an impact line of the delete dialog: the dialog draws a `$`
 * key with its own params, so the schedule's words go in `params` when no
 * other line uses them; the expression is shown as written otherwise.
 *
 * A weekday is a nested key the dialog cannot compose: one key per day.
 */
function scheduleImpact(cron: string, params: Record<string, unknown>): string {
  const text = cronText(cron);
  if (typeof text === "string") return text;
  const own: Record<string, unknown> = { ...text.params };
  let key = text.key;
  const day = own.day as { key?: string } | undefined;
  if (day && typeof day === "object") {
    const weekday = WEEKDAY_KEY.exec(day.key ?? "")?.[1];
    if (!weekday) return cron;
    key = `${API_MESSAGES.slice(1)}.weekly.${weekday}`;
    delete own.day;
  }
  if (Object.keys(own).some((name) => name in params)) return cron;
  Object.assign(params, own);
  return `$${key}`;
}

/** What changes when a procedure stops: its webhooks and schedules. */
function stopImpact(
  graph: ProcedureGraph | undefined,
  params: Record<string, unknown>,
): ConfirmDialogImpact[] {
  return (graph ? triggersOf(graph) : [])
    .filter((t) => t.path || t.cron)
    .map((t) =>
      t.path
        ? {
            icon: "i-ph-webhooks-logo",
            label: `${API_MESSAGES}.deleteImpact.webhook`,
            count: `${t.method} ${t.path}`,
          }
        : {
            icon: "i-ph-clock",
            label: "$dms_automation.procedures.deleteImpact.schedule",
            count: scheduleImpact(t.cron ?? "", params),
          },
    );
}

/**
 * The delete dialog, worded for the procedure: what stops answering, how
 * often it ran this week (`runCount`), and, for an enabled one, its name to
 * type. A disabled one is told the delete cannot be undone.
 *
 * An enabled procedure is deleted by typing its name.
 */
export function deleteDialogOf(
  procedure: Procedure,
  runCount: number,
): ConfirmDialog {
  const params: Record<string, unknown> = {
    name: procedure.name,
    count: runCount,
  };
  const dialog: ConfirmDialog = {
    title: "$dms_automation.procedures.deleteTitle",
    description: procedure.enabled
      ? `${API_MESSAGES}.deleteEnabledDescription`
      : `${API_MESSAGES}.deleteDescription`,
    params,
    icon: "i-ph-trash",
    color: "error",
    confirmLabel: "$dms_automation.procedures.deleteConfirm",
    impact: procedure.enabled
      ? stopImpact(parseGraphSafe(procedure.graph), params)
      : [],
  };
  if (procedure.enabled) dialog.confirmText = procedure.name;
  return dialog;
}
