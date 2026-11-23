import { computed, ref } from "vue";
import type { EditorContext } from "./useEditorContext";
import type {
  GraphNode,
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import { cloneGraph } from "../../utils/editor/graphShape";
import type { SubgraphNavigation } from "./useSubgraphNavigation";
import { configName } from "./valueGuards";

/** The template instance to fork, and the graph that holds it (the one up a frame when the user views the instance's read-only inside). */
interface ForkTarget {
  node: GraphNode;
  containerGraph: ProcedureGraph;
}

interface FetchedTemplate {
  _id: string;
  name: string;
  description: string;
  icon: string;
  ports: GroupPort[];
  subgraph: ProcedureGraph;
}

/** The instance as a local group: the template's subgraph cloned in, the instance's own ports kept when it carries any. */
function forkedGroup(node: GraphNode, template: FetchedTemplate): GraphNode {
  const updated: GraphNode = {
    ...node,
    subgraph: cloneGraph(template.subgraph),
    ports:
      Array.isArray(node.ports) && node.ports.length > 0
        ? node.ports.map((p) => ({ ...p }))
        : template.ports.map((p) => ({ ...p })),
  };
  delete updated.templateId;
  return updated;
}

/** Turning a template instance back into a local group. */
export function useForkToLocal(ctx: EditorContext, nav: SubgraphNavigation) {
  const errorPresenter = useApiErrorPresenter();
  const {
    $authFetch,
    currentGraph,
    isCurrentGraphReadOnly,
    selected,
    selectedNode,
    selectedNodeId,
    subgraphFrames,
    subgraphPath,
    t,
    toast,
  } = ctx;
  const { onUpdateNode } = nav;

  const forkTarget = computed<ForkTarget | null>(() => {
    if (!selected.value) return null;
    const parentFrame = subgraphFrames.value.at(-1);
    const containerFrame = subgraphFrames.value.at(-2);
    if (isCurrentGraphReadOnly.value && parentFrame && containerFrame) {
      const parent = parentFrame.groupNode;
      if (parent && parent.kind === "group" && parent.templateId) {
        return { node: parent, containerGraph: containerFrame.graph };
      }
    }
    const sel = selectedNode.value;
    const g = currentGraph.value;
    if (sel && g && sel.kind === "group" && sel.templateId) {
      return { node: sel, containerGraph: g };
    }
    return null;
  });

  const canForkToLocal = computed<boolean>(() => forkTarget.value !== null);

  const forkOpen = ref<boolean>(false);
  const forkSubmitting = ref<boolean>(false);
  const forkError = ref<ReturnType<typeof errorPresenter.resolveError>>(null);

  function openFork() {
    if (!canForkToLocal.value) return;
    forkError.value = null;
    forkSubmitting.value = false;
    forkOpen.value = true;
  }

  function convertTemplateInstanceToLocal(
    target: ForkTarget,
    template: FetchedTemplate,
  ): void {
    const { node, containerGraph } = target;
    const idx = containerGraph.nodes.findIndex(
      (n) => n.id === node.id && n.kind === "group",
    );
    if (idx === -1) return;
    const updated = forkedGroup(node, template);

    if (isCurrentGraphReadOnly.value && subgraphPath.value.length > 1) {
      subgraphPath.value = subgraphPath.value.slice(0, -1);
      selectedNodeId.value = updated.id;
    }

    onUpdateNode(updated);
  }

  async function submitFork() {
    const target = forkTarget.value;
    if (!target) return;
    const templateId = target.node.templateId;
    if (!templateId) return;
    forkSubmitting.value = true;
    forkError.value = null;
    try {
      const tpl = await $authFetch<FetchedTemplate>(
        `/api/automation/templates/${templateId}`,
      );
      convertTemplateInstanceToLocal(target, tpl);
      forkOpen.value = false;
      toast.add({
        title: t("dms_automation.editor.forked", {
          name: target.node.label || configName(target.node) || tpl.name,
        }),
        color: "success",
        icon: "i-ph-check-circle",
      });
    } catch (e) {
      forkError.value = errorPresenter.resolveError(e, {
        fallbackKey: "dms_automation.editor.forkModal.error",
      });
    } finally {
      forkSubmitting.value = false;
    }
  }

  return {
    forkTarget,
    canForkToLocal,
    forkOpen,
    forkSubmitting,
    forkError,
    openFork,
    submitFork,
  };
}

export type ForkToLocal = ReturnType<typeof useForkToLocal>;
