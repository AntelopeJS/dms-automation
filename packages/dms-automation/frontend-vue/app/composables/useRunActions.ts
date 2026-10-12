import { ref } from "vue";
import { type RerunResult, useAutomationRuns } from "./useAutomationRuns";

/**
 * "Re-run with this payload", shared by the run drawer, the trace and the
 * builder: it asks first, in the server's words (side effects are real, the
 * procedure may be paused, some headers are replayed redacted, or the run
 * cannot be re-run at all), runs, says how the new run ended and opens its
 * trace.
 */
export function useRunActions(options: { apiUrl: string; traceUrl: string }) {
  const { t } = useI18n();
  const { processI18n } = useTranslation();
  const { confirm } = useConfirm();
  const toast = useToast();
  const router = useDmsRouter();
  const runs = useAutomationRuns(options.apiUrl);
  const rerunning = ref(false);

  async function rerun(runId: string, procedureName: string): Promise<void> {
    // A second click while the first is under way does nothing: the button
    // shows it loading. The server also refuses a re-run asked twice in a
    // row, and the dialog shows its message.
    if (rerunning.value) return;
    rerunning.value = true;
    let dialog;
    try {
      dialog = await runs.rerunConfirm(runId);
    } catch (e) {
      toast.add({
        title: t("dms_automation.trace.rerunUnavailable"),
        description: (e as Error).message,
        color: "error",
        icon: "i-ph-warning-circle",
      });
      return;
    } finally {
      rerunning.value = false;
    }
    const params = { name: procedureName, ...dialog.params };
    const text = (value: string | undefined) =>
      value === undefined ? undefined : processI18n(value, params);
    let result: RerunResult | undefined;
    const confirmed = await confirm({
      title: text(dialog.title) ?? "",
      description: text(dialog.description),
      color: dialog.color ?? "warning",
      icon: dialog.icon ?? "i-ph-arrow-clockwise",
      confirmLabel: text(dialog.confirmLabel),
      impact: dialog.impact?.map((note) => ({
        ...note,
        label: text(note.label) ?? "",
      })),
      blocked: dialog.blocked,
      onConfirm: dialog.blocked
        ? undefined
        : async () => {
            rerunning.value = true;
            try {
              result = await runs.rerun(runId);
            } finally {
              rerunning.value = false;
            }
          },
    });
    if (!confirmed || !result) return;
    const failed = result.status === "failed";
    toast.add({
      title: failed
        ? t("dms_automation.trace.rerunFailed", { name: procedureName })
        : t("dms_automation.runs.rerunDone", { name: procedureName }),
      description: result.warning ? processI18n(result.warning) : undefined,
      color: failed ? "error" : "success",
      icon: failed ? "i-ph-x-circle" : "i-ph-check-circle",
    });
    await router.push(
      `${options.traceUrl}?run=${encodeURIComponent(result.runId)}`,
    );
  }

  return { rerun, rerunning };
}
