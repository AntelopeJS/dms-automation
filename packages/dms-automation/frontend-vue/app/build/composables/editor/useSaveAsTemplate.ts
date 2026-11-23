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

const DEFAULT_TEMPLATE_ICON = "i-ph-package";

/** The group node as an instance of a template: it keeps its place and loses its inline subgraph. */
function asTemplateInstance(group: GraphNode, templateId: string): GraphNode {
  const updated: GraphNode = { ...group, templateId };
  delete updated.subgraph;
  return updated;
}

/** The save-as-template form: its fields, its state, and the errors shown under its fields. */
function useTemplateForm() {
  const saveAsTemplateName = ref<string>("");
  const templateFieldErrors = useFieldErrors({
    fields: { name: TEMPLATE_NAME_ID },
  });
  watch(saveAsTemplateName, () => templateFieldErrors.clear("name"));
  return {
    saveAsTemplateOpen: ref<boolean>(false),
    saveAsTemplateName,
    saveAsTemplateDescription: ref<string>(""),
    saveAsTemplateIcon: ref<string>(DEFAULT_TEMPLATE_ICON),
    saveAsTemplateSubmitting: ref<boolean>(false),
    saveAsTemplateError: ref<string | null>(null),
    templateFieldErrors,
  };
}

/** Saving a local group as a template, and linking the group to it. */
export function useSaveAsTemplate(
  ctx: EditorContext,
  history: GraphHistory,
  nav: SubgraphNavigation,
  save: BuilderSave,
) {
  const errorPresenter = useApiErrorPresenter();
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

  const form = useTemplateForm();

  function openSaveAsTemplate() {
    const n = selectedLocalGroupNode.value;
    if (!n) return;
    form.saveAsTemplateName.value = groupName(n);
    form.saveAsTemplateDescription.value = "";
    form.saveAsTemplateIcon.value = DEFAULT_TEMPLATE_ICON;
    form.saveAsTemplateError.value = null;
    form.templateFieldErrors.clear();
    form.saveAsTemplateSubmitting.value = false;
    form.saveAsTemplateOpen.value = true;
  }

  function convertLocalGroupToTemplateInstance(
    nodeId: string,
    templateId: string,
  ): void {
    const g = currentGraph.value;
    if (!g) return;
    const existing = g.nodes.find((n) => n.id === nodeId && n.kind === "group");
    if (!existing) return;
    onUpdateNode(asTemplateInstance(existing, templateId));
  }

  async function submitSaveAsTemplate() {
    const n = selectedLocalGroupNode.value;
    if (!n) return;
    const name = form.saveAsTemplateName.value.trim();
    if (!name) {
      await form.templateFieldErrors.setError(
        "name",
        t("dms_automation.editor.saveTemplateModal.nameRequired"),
      );
      return;
    }
    if (!n.subgraph) {
      form.saveAsTemplateError.value = t(
        "dms_automation.editor.saveTemplateModal.noSubgraph",
      );
      return;
    }
    form.saveAsTemplateSubmitting.value = true;
    form.saveAsTemplateError.value = null;
    try {
      const body = {
        name,
        description: form.saveAsTemplateDescription.value.trim(),
        icon: form.saveAsTemplateIcon.value.trim() || DEFAULT_TEMPLATE_ICON,
        ports: Array.isArray(n.ports) ? n.ports : [],
        subgraph: n.subgraph,
      };
      const created = await $authFetch<{ _id: string }>(
        "/api/automation/templates",
        { method: "POST", body },
      );
      const linkOnly = !isDirty.value;
      convertLocalGroupToTemplateInstance(n.id, created._id);
      form.saveAsTemplateOpen.value = false;
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
      if (validation) form.saveAsTemplateError.value = validation;
      else
        errorPresenter.presentError(e, {
          fallbackKey: "dms_automation.templates.saveError",
        });
    } finally {
      form.saveAsTemplateSubmitting.value = false;
    }
  }

  return {
    selectedLocalGroupNode,
    canSaveAsTemplate,
    ...form,
    openSaveAsTemplate,
    submitSaveAsTemplate,
  };
}

export type SaveAsTemplate = ReturnType<typeof useSaveAsTemplate>;
