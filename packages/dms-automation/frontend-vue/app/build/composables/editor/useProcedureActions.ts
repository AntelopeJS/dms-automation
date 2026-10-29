import type { EditorContext } from "./useEditorContext";
import type { EditorLoad } from "./useEditorLoad";
import type { DraftProblems } from "./useDraftProblems";
import type { UnsavedGuards } from "./useUnsavedGuards";

/** Creating, deleting and exporting a procedure. */
export function useProcedureActions(
  ctx: EditorContext,
  load: EditorLoad,
  problems: DraftProblems,
  guards: UnsavedGuards,
) {
  const {
    $authFetch,
    builderPath,
    confirmFrom,
    newProcedureOpen,
    procedures,
    props,
    router,
    selected,
    selectedId,
    t,
    toast,
  } = ctx;
  const { loadList } = load;
  const { savedName, summariesRead } = problems;
  const { confirmDiscard } = guards;

  async function onCreated(id: string) {
    await Promise.all([loadList(), summariesRead.refresh()]);
    selectedId.value = id;
    void router.replace(`${builderPath()}?selected=${id}`);
  }

  async function onCreate() {
    if (!(await confirmDiscard())) return;
    newProcedureOpen.value = true;
  }

  async function onDelete() {
    const current = selected.value;
    if (!current) return;
    const name = savedName.value;
    // The server words the dialog, as the procedures table's delete does.
    await confirmFrom(`${props.apiUrl}/procedures/{{row.id}}/delete-confirm`, {
      params: { id: current._id },
      onConfirm: async () => {
        await $authFetch(`${props.apiUrl}/procedures/${current._id}`, {
          method: "DELETE",
        });
        procedures.value = procedures.value.filter(
          (p) => p._id !== current._id,
        );
        selectedId.value = procedures.value[0]?._id ?? null;
        void router.replace(
          selectedId.value
            ? `${builderPath()}?selected=${selectedId.value}`
            : builderPath(),
        );
        toast.add({
          title: t("dms_automation.editor.deleted", { name }),
          color: "success",
          icon: "i-ph-check-circle",
        });
        void summariesRead.refresh();
      },
    });
  }

  async function onExport() {
    const current = selected.value;
    if (!current) return;
    const data = await $authFetch<unknown>(
      `${props.apiUrl}/procedures/${current._id}/export`,
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${current.name.replace(/[^\w-]+/g, "-").toLowerCase() || "procedure"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return {
    onCreated,
    onCreate,
    onDelete,
    onExport,
  };
}

export type ProcedureActions = ReturnType<typeof useProcedureActions>;
