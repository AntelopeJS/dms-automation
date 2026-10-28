import { computed, type Ref } from "vue";
import type { EditorContext } from "./useEditorContext";
import { describeDateTime } from "../../../utils/describe";
import type { ProcedureTriggers } from "../../types/editor";
import type { DraftProblems } from "./useDraftProblems";

/** The triggers of the saved procedure, what the paused banner says of them, and the save state label. */
export function useSavedTriggers(ctx: EditorContext, problems: DraftProblems) {
  const {
    dateTimeFormat,
    editorMode,
    processText,
    props,
    saving,
    selected,
    selectedId,
    t,
  } = ctx;
  const { changeCount, currentSummary, savedName } = problems;

  /**
   * A URL of the procedure open, for the reads that follow it: none in
   * template mode or while no procedure is open.
   */
  function selectedProcedureUrl(path: string): () => string | null {
    return () =>
      selectedId.value && editorMode.value === "procedure"
        ? `${props.apiUrl}/procedures/${selectedId.value}/${path}`
        : null;
  }

  /**
   * Data of the procedure open, or nothing while another one's is still on
   * screen or once its read failed.
   */
  function ofSelected<T>(read: {
    data: Ref<T | null>;
    placeholder: Readonly<Ref<boolean>>;
    error: Ref<unknown>;
  }): T | null {
    return read.placeholder.value || read.error.value ? null : read.data.value;
  }

  // The saved triggers: what a paused procedure will not fire, and what Run
  // now offers.
  const savedTriggersRead = useApiData<ProcedureTriggers>(
    selectedProcedureUrl("triggers"),
  );
  const savedTriggers = computed(
    () => ofSelected(savedTriggersRead)?.triggers ?? [],
  );

  /** The banner of a disabled procedure names what will not fire (AU-16). */
  const pausedBanner = computed(() => {
    const current = selected.value;
    if (!current || current.enabled || editorMode.value !== "procedure")
      return null;
    const triggers = savedTriggers.value.filter((tr) => tr.typeId !== "manual");
    if (triggers.length === 0) return null;
    const first = triggers[0]!;
    const what = processText(first.text);
    const isDraft = currentSummary.value?.status === "draft";
    return {
      title: t(
        isDraft
          ? "dms_automation.editor.paused.draftTitle"
          : "dms_automation.editor.paused.title",
        { name: savedName.value },
      ),
      description: first.nextAt
        ? t("dms_automation.editor.paused.schedule", {
            what,
            next: describeDateTime(
              first.nextAt,
              dateTimeFormat,
              first.timeZone,
            ),
          })
        : t("dms_automation.editor.paused.other", { what }),
    };
  });

  const saveState = computed(() => {
    if (saving.value) return t("dms_automation.editor.saving");
    if (changeCount.value > 0)
      return t("dms_automation.editor.unsaved", { count: changeCount.value });
    return t("dms_automation.editor.saved");
  });

  return {
    selectedProcedureUrl,
    ofSelected,
    savedTriggersRead,
    savedTriggers,
    pausedBanner,
    saveState,
  };
}

export type SavedTriggers = ReturnType<typeof useSavedTriggers>;
