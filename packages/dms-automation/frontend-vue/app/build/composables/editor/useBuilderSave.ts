import { watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import { issuesOf } from "../../utils/editor/apiErrors";
import type {
  ChoiceQuestion,
  GraphIssue,
  ProcedureRecord,
  ProcedureSnapshot,
} from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { DraftProblems } from "./useDraftProblems";
import type { SavedTriggers } from "./useSavedTriggers";
import type { UnsavedGuards } from "./useUnsavedGuards";
import { seedSubgraphPath } from "./useSubgraphNavigation";
import { isNumber, isRecord } from "../../../utils/json";

/** The composables a save reads and acts through. */
interface SaveDependencies {
  history: GraphHistory;
  problems: DraftProblems;
  triggers: SavedTriggers;
  guards: UnsavedGuards;
  later: { onTestRun: () => Promise<void> };
}

/** The server refused a save because the procedure was written elsewhere; `data.revision` is the revision it holds. */
interface StaleConflict {
  data: { revision: number };
}

function isStaleConflict(error: unknown): error is StaleConflict {
  return (
    apiErrorStatus(error) === 409 &&
    isRecord(error) &&
    isRecord(error.data) &&
    isNumber(error.data.revision)
  );
}

function staleQuestion(
  t: EditorContext["t"],
  name: string,
): ChoiceQuestion<"stay" | "reload" | "overwrite"> {
  return {
    title: t("dms_automation.editor.stale.title", { name }),
    description: t("dms_automation.editor.stale.description"),
    choices: [
      {
        value: "stay",
        label: t("dms_automation.editor.stale.keep"),
        color: "neutral",
        variant: "ghost",
      },
      {
        value: "reload",
        label: t("dms_automation.editor.stale.reload"),
        color: "neutral",
        variant: "outline",
      },
      {
        value: "overwrite",
        label: t("dms_automation.editor.stale.overwrite"),
        color: "warning",
      },
    ],
    dismiss: "stay",
  };
}

async function saveTemplate(
  ctx: EditorContext,
  current: ProcedureRecord,
  sent: ProcedureSnapshot,
): Promise<void> {
  const { $authFetch, props, savedSnapshot, t, templateIcon, toast } = ctx;
  await $authFetch(`${props.apiUrl}/templates/${current._id}`, {
    method: "PUT",
    body: {
      name: sent.name,
      description: current.description,
      icon: templateIcon.value,
      ports: sent.ports ?? [],
      subgraph: sent.graph,
    },
  });
  savedSnapshot.value = sent;
  toast.add({
    title: t("dms_automation.templates.saved", { name: sent.name }),
    color: "success",
    icon: "i-ph-check-circle",
  });
}

async function saveProcedure(
  ctx: EditorContext,
  current: ProcedureRecord,
  sent: ProcedureSnapshot,
  onTestRun: () => Promise<void>,
): Promise<void> {
  const { $authFetch, issues, props, savedSnapshot, t, toast } = ctx;
  const res = await $authFetch<{
    version: number;
    revision: number;
    issues?: GraphIssue[];
  }>(`${props.apiUrl}/procedures/${current._id}`, {
    method: "PUT",
    body: {
      name: sent.name,
      description: current.description,
      enabled: sent.enabled,
      graph: sent.graph,
      expectedRevision: current.revision,
    },
  });
  current.version = res.version;
  current.revision = res.revision;
  savedSnapshot.value = sent;
  if (res.issues) issues.value = res.issues;
  toast.add({
    title: t("dms_automation.editor.savedToast", { name: sent.name }),
    description: res.issues?.length
      ? t("dms_automation.editor.savedWithProblems", {
          count: res.issues.length,
        })
      : undefined,
    color: "success",
    icon: "i-ph-check-circle",
    actions: [
      {
        label: t("dms_automation.editor.testRun"),
        onClick: () => void onTestRun(),
      },
    ],
  });
}

/**
 * The revision an overwrite is sent against. Overwriting puts the draft's edits over what was saved elsewhere, not its on/off state over a pause or a resume made elsewhere: unless the switch was flipped in this draft, the procedure takes the state it has now and its revision. When that cannot be read, the draft's state is saved, against `fallback`.
 */
async function revisionToOverwrite(
  ctx: EditorContext,
  current: ProcedureRecord,
  fallback: number,
): Promise<number> {
  if (current.enabled !== ctx.savedSnapshot.value?.enabled) return fallback;
  try {
    const saved = await ctx.$authFetch<{ enabled: boolean; revision: number }>(
      `${ctx.props.apiUrl}/procedures/${current._id}`,
    );
    current.enabled = saved.enabled;
    return saved.revision;
  } catch {
    return fallback;
  }
}

async function replaceWithSaved(
  ctx: EditorContext,
  current: ProcedureRecord,
): Promise<void> {
  const { $authFetch, procedures, props, selectedNodeId } = ctx;
  const fresh = await $authFetch<ProcedureRecord>(
    `${props.apiUrl}/procedures/${current._id}`,
  );
  procedures.value = procedures.value.map((p) =>
    p._id === fresh._id ? fresh : p,
  );
  selectedNodeId.value = null;
}

/**
 * Saving the open procedure (or template), and the way out of a save the server refused: when the procedure was saved elsewhere since the draft was loaded, the user reloads what is saved now or overwrites it with the draft.
 */
export function useBuilderSave(
  ctx: EditorContext,
  { history, problems, triggers, guards, later }: SaveDependencies,
) {
  const errorPresenter = useApiErrorPresenter();
  const {
    dockCollapsed,
    dockTab,
    editorMode,
    issues,
    saveBlocked,
    saving,
    selected,
    t,
  } = ctx;
  const { initHistoryAndSaved, takeSnapshot } = history;
  const { NAME_INPUT_ID, blockingIssues, nameMissing, selectNode } = problems;
  const { savedName, summariesRead } = problems;
  const { savedTriggersRead } = triggers;
  const { askChoice } = guards;
  const { onTestRun } = later;

  async function enableNow() {
    if (!selected.value) return;
    selected.value.enabled = true;
    await onSave();
  }

  async function onSave(): Promise<boolean> {
    if (!selected.value) return false;
    if (nameMissing.value) {
      document.getElementById(NAME_INPUT_ID)?.focus();
      return false;
    }
    saving.value = true;
    const current = selected.value;
    const sent = takeSnapshot(current);
    try {
      if (editorMode.value === "template") {
        await saveTemplate(ctx, current, sent);
        return true;
      }
      await saveProcedure(ctx, current, sent, onTestRun);
      void summariesRead.refresh();
      void savedTriggersRead.refresh();
      return true;
    } catch (e) {
      if (editorMode.value === "procedure" && isStaleConflict(e))
        return await resolveStale(current, e.data.revision);
      const refused = issuesOf(e);
      if (refused) {
        issues.value = refused;
        saveBlocked.value = true;
        dockTab.value = "problems";
        dockCollapsed.value = false;
      } else {
        errorPresenter.presentError(e, {
          fallbackKey:
            editorMode.value === "template"
              ? "dms_automation.templates.saveError"
              : "dms_automation.editor.saveError",
        });
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function resolveStale(
    current: ProcedureRecord,
    staleRevision: number,
  ): Promise<boolean> {
    saving.value = false;
    const choice = await askChoice(staleQuestion(t, savedName.value));
    if (choice === "overwrite") {
      current.revision = await revisionToOverwrite(ctx, current, staleRevision);
      return await onSave();
    }
    if (choice === "reload") await reloadSelected();
    return false;
  }

  async function reloadSelected() {
    const current = selected.value;
    if (!current) return;
    try {
      await replaceWithSaved(ctx, current);
      initHistoryAndSaved();
      seedSubgraphPath(ctx);
      saveBlocked.value = false;
      void summariesRead.refresh();
      void savedTriggersRead.refresh();
    } catch (e) {
      errorPresenter.presentError(e, {
        fallbackKey: "dms_automation.editor.loadProceduresError",
      });
    }
  }

  watch(blockingIssues, (list) => {
    if (list.length === 0) saveBlocked.value = false;
  });

  async function saveAsDraft() {
    if (!selected.value) return;
    selected.value.enabled = false;
    if (await onSave()) saveBlocked.value = false;
  }

  function goToFirstProblem() {
    const first =
      blockingIssues.value.find((i) => i.nodeId) ??
      issues.value.find((i) => i.nodeId);
    if (first?.nodeId) selectNode(first.nodeId);
  }

  return {
    onSave,
    enableNow,
    saveAsDraft,
    goToFirstProblem,
  };
}

export type BuilderSave = ReturnType<typeof useBuilderSave>;
