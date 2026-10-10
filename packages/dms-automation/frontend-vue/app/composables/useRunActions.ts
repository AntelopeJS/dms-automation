import { ref } from "vue";
import { useAutomationRuns } from "./useAutomationRuns";

/**
 * "Re-run with this payload", shared by the run drawer, the trace and the
 * builder: it asks first (side effects are real), runs, and opens the new
 * run's trace.
 */
export function useRunActions(options: { apiUrl: string; traceUrl: string }) {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const toast = useToast();
  const router = useDmsRouter();
  const runs = useAutomationRuns(options.apiUrl);
  const rerunning = ref(false);

  async function rerun(runId: string, procedureName: string): Promise<void> {
    let newRunId: string | null = null;
    const confirmed = await confirm({
      title: t("dms_automation.runs.rerunConfirmTitle"),
      description: t("dms_automation.runs.rerunConfirmDescription", {
        name: procedureName,
      }),
      color: "warning",
      icon: "i-ph-arrow-clockwise",
      confirmLabel: t("dms_automation.runs.rerun"),
      onConfirm: async () => {
        rerunning.value = true;
        try {
          newRunId = (await runs.rerun(runId)).runId;
        } finally {
          rerunning.value = false;
        }
      },
    });
    if (!confirmed || !newRunId) return;
    toast.add({
      title: t("dms_automation.runs.rerunDone", { name: procedureName }),
      color: "success",
      icon: "i-ph-check-circle",
    });
    await router.push(`${options.traceUrl}?run=${newRunId}`);
  }

  return { rerun, rerunning };
}
