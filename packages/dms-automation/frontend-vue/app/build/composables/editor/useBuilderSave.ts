import { watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import { issuesOf } from "../../utils/editor/apiErrors";
import type { GraphIssue, ProcedureRecord } from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { DraftProblems } from "./useDraftProblems";
import type { SavedTriggers } from "./useSavedTriggers";
import type { UnsavedGuards } from "./useUnsavedGuards";
import { seedSubgraphPath } from "./useSubgraphNavigation";

/** Saving the open procedure (or template), and the way out of a save the server refused. */
export function useBuilderSave(
  ctx: EditorContext,
  history: GraphHistory,
  problems: DraftProblems,
  triggers: SavedTriggers,
  guards: UnsavedGuards,
  later: { onTestRun: () => Promise<void> },
) {
  const {
    $authFetch,
    dockCollapsed,
    dockTab,
    editorMode,
    issues,
    procedures,
    props,
    saveBlocked,
    savedSnapshot,
    saving,
    selected,
    selectedNodeId,
    t,
    templateIcon,
    toast,
  } = ctx;
  const { initHistoryAndSaved, takeSnapshot } = history;
  const {
    NAME_INPUT_ID,
    blockingIssues,
    nameMissing,
    savedName,
    selectNode,
    summariesRead,
  } = problems;
  const { savedTriggersRead } = triggers;
  const { askChoice } = guards;
  const { onTestRun } = later;

  async function enableNow() {
    if (!selected.value) return;
    selected.value.enabled = true;
    await onSave();
  }

  /** Save the open procedure (or template). Resolves whether it was saved. */
  async function onSave(): Promise<boolean> {
    if (!selected.value) return false;
    if (nameMissing.value) {
      document.getElementById(NAME_INPUT_ID)?.focus();
      return false;
    }
    saving.value = true;
    const current = selected.value;
    // What is sent is what counts as saved: a change made while the request
    // runs stays an unsaved change.
    const sent = takeSnapshot(current);
    try {
      if (editorMode.value === "template") {
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
        return true;
      }
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
      void summariesRead.refresh();
      void savedTriggersRead.refresh();
      return true;
    } catch (e) {
      if (editorMode.value === "procedure" && apiErrorStatus(e) === 409)
        return await resolveStale(current, e);
      const refused = issuesOf(e);
      if (refused) {
        issues.value = refused;
        saveBlocked.value = true;
        dockTab.value = "problems";
        dockCollapsed.value = false;
      } else {
        toast.add({
          title:
            editorMode.value === "template"
              ? t("dms_automation.templates.saveError")
              : t("dms_automation.editor.saveError"),
          description: describeApiError(e),
          color: "error",
          icon: "i-ph-warning",
        });
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  /**
   * The procedure was saved elsewhere (another tab, a pause from the list)
   * since this draft was loaded, and the server refused to overwrite it:
   * reload what is saved now, or overwrite it with the draft.
   */
  async function resolveStale(
    current: ProcedureRecord,
    error: unknown,
  ): Promise<boolean> {
    saving.value = false;
    let latest = (error as { data: { revision: number } }).data.revision;
    const choice = await askChoice({
      title: t("dms_automation.editor.stale.title", { name: savedName.value }),
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
    });
    if (choice === "overwrite") {
      // Overwriting puts the draft's edits over what was saved elsewhere, not
      // its on/off state over a pause or a resume made elsewhere: unless the
      // switch was flipped in this draft, the procedure stays as it is now.
      if (current.enabled === savedSnapshot.value?.enabled) {
        try {
          const saved = await $authFetch<{
            enabled: boolean;
            revision: number;
          }>(`${props.apiUrl}/procedures/${current._id}`);
          current.enabled = saved.enabled;
          latest = saved.revision;
        } catch {
          // Unreadable: the draft's state is saved, as before.
        }
      }
      current.revision = latest;
      return await onSave();
    }
    if (choice === "reload") await reloadSelected();
    return false;
  }

  /** Replaces the draft with the procedure as it is saved now. */
  async function reloadSelected() {
    const current = selected.value;
    if (!current) return;
    try {
      const fresh = await $authFetch<ProcedureRecord>(
        `${props.apiUrl}/procedures/${current._id}`,
      );
      procedures.value = procedures.value.map((p) =>
        p._id === fresh._id ? fresh : p,
      );
      selectedNodeId.value = null;
      initHistoryAndSaved();
      seedSubgraphPath(ctx);
      saveBlocked.value = false;
      void summariesRead.refresh();
      void savedTriggersRead.refresh();
    } catch (e) {
      toast.add({
        title: t("dms_automation.editor.loadProceduresError"),
        description: describeApiError(e),
        color: "error",
        icon: "i-ph-warning",
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
