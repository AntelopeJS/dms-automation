import { computed, ref, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { GraphNode } from "../../../composables/useGraphConnect";
import { formatTemplateError } from "../../utils/editor/apiErrors";
import type { GraphHistory } from "./useGraphHistory";
import type { SubgraphNavigation } from "./useSubgraphNavigation";
import type { BuilderSave } from "./useBuilderSave";

/** The row layout of the save-as-template form. */
export const TEMPLATE_ROW = {
  layout: "form",
  spacing: "list",
  inset: false,
} as const;

export const TEMPLATE_NAME_ID = "save-template-name";

/** Saving a local group as a template, and linking the group to it. */
export function useSaveAsTemplate(
  ctx: EditorContext,
  history: GraphHistory,
  nav: SubgraphNavigation,
  save: BuilderSave,
) {
  const { presentError } = useApiErrorPresenter();
  const {
    $authFetch,
    currentGraph,
    isCurrentGraphReadOnly,
    selected,
    selectedNode,
    t,
    templatesRead,
    toast,
  } = ctx;
  const { isDirty } = history;
  const { groupName, onUpdateNode } = nav;
  const { onSave } = save;

  // Visible when the user has selected a single local group (kind === 'group',
  // no templateId). On submit:
  //   1. POST /api/automation/templates with { name, description, icon, ports,
  //      subgraph } from the local group.
  //   2. On success: mutate the in-graph node — set templateId = res._id, drop
  //      subgraph. The save flow (onGraphUpdate → onSave by user) propagates.
  //   3. On failure (Zod or template cycle): render the error body inline in
  //      the modal; the graph is NOT touched.
  const selectedLocalGroupNode = computed<GraphNode | null>(() => {
    const n = selectedNode.value;
    if (!n || n.kind !== "group") return null;
    if (n.templateId) return null;
    return n;
  });

  const canSaveAsTemplate = computed<boolean>(() => {
    if (!selected.value) return false;
    if (isCurrentGraphReadOnly.value) return false;
    return selectedLocalGroupNode.value !== null;
  });

  const saveAsTemplateOpen = ref<boolean>(false);
  const saveAsTemplateName = ref<string>("");
  const saveAsTemplateDescription = ref<string>("");
  const saveAsTemplateIcon = ref<string>("i-ph-package");
  const saveAsTemplateSubmitting = ref<boolean>(false);
  const saveAsTemplateError = ref<string | null>(null);

  // A missing name shows under its field; what the server refuses (issues, a
  // reference cycle) stays in the banner above the buttons.
  const templateFieldErrors = useFieldErrors({
    fields: { name: TEMPLATE_NAME_ID },
  });
  watch(saveAsTemplateName, () => templateFieldErrors.clear("name"));

  function openSaveAsTemplate() {
    const n = selectedLocalGroupNode.value;
    if (!n) return;
    saveAsTemplateName.value = groupName(n);
    saveAsTemplateDescription.value = "";
    saveAsTemplateIcon.value = "i-ph-package";
    saveAsTemplateError.value = null;
    templateFieldErrors.clear();
    saveAsTemplateSubmitting.value = false;
    saveAsTemplateOpen.value = true;
  }

  function convertLocalGroupToTemplateInstance(
    nodeId: string,
    templateId: string,
  ): void {
    const g = currentGraph.value;
    if (!g) return;
    const existing = g.nodes.find((n) => n.id === nodeId && n.kind === "group");
    if (!existing) return;
    const updated: GraphNode = { ...existing, templateId };
    delete updated.subgraph;
    onUpdateNode(updated);
  }

  async function submitSaveAsTemplate() {
    const n = selectedLocalGroupNode.value;
    if (!n) return;
    const name = saveAsTemplateName.value.trim();
    if (!name) {
      await templateFieldErrors.setError(
        "name",
        t("dms_automation.editor.saveTemplateModal.nameRequired"),
      );
      return;
    }
    if (!n.subgraph) {
      saveAsTemplateError.value = t(
        "dms_automation.editor.saveTemplateModal.noSubgraph",
      );
      return;
    }
    saveAsTemplateSubmitting.value = true;
    saveAsTemplateError.value = null;
    try {
      const body = {
        name,
        description: saveAsTemplateDescription.value.trim(),
        icon: saveAsTemplateIcon.value.trim() || "i-ph-package",
        ports: Array.isArray(n.ports) ? n.ports : [],
        subgraph: n.subgraph,
      };
      const created = await $authFetch<{ _id: string }>(
        "/api/automation/templates",
        { method: "POST", body },
      );
      // The template exists now: the procedure links to it once saved. A
      // draft with nothing else unsaved is saved at once; one with other
      // changes is left to the user, who is told.
      const linkOnly = !isDirty.value;
      convertLocalGroupToTemplateInstance(n.id, created._id);
      saveAsTemplateOpen.value = false;
      void templatesRead.refresh();
      toast.add({
        title: t("dms_automation.templates.saved", { name }),
        description: linkOnly
          ? undefined
          : t("dms_automation.editor.saveTemplateModal.saveToLink"),
        color: "success",
        icon: "i-ph-check-circle",
      });
      if (linkOnly) await onSave();
    } catch (e) {
      const validation = formatTemplateError(e);
      if (validation) saveAsTemplateError.value = validation;
      else
        presentError(e, { fallbackKey: "dms_automation.templates.saveError" });
    } finally {
      saveAsTemplateSubmitting.value = false;
    }
  }

  return {
    selectedLocalGroupNode,
    canSaveAsTemplate,
    saveAsTemplateOpen,
    saveAsTemplateName,
    saveAsTemplateDescription,
    saveAsTemplateIcon,
    saveAsTemplateSubmitting,
    saveAsTemplateError,
    templateFieldErrors,
    openSaveAsTemplate,
    submitSaveAsTemplate,
  };
}

export type SaveAsTemplate = ReturnType<typeof useSaveAsTemplate>;
