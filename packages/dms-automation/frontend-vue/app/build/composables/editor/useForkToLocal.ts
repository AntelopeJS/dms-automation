import { computed, ref } from "vue";
import type { EditorContext } from "./useEditorContext";
import type {
  GraphNode,
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import type { SubgraphNavigation } from "./useSubgraphNavigation";

/** Turning a template instance back into a local group. */
export function useForkToLocal(ctx: EditorContext, nav: SubgraphNavigation) {
  const { resolveError } = useApiErrorPresenter();
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

  // ---------------------------------------------------------------------------
  // Fork-to-local-group
  // ---------------------------------------------------------------------------
  // Visible when a template-instance group node is selected — i.e. kind === 'group'
  // AND templateId is set. The fork is the escape hatch from the live-link
  // model: it converts the instance back to a local group by deep-cloning the
  // template's current subgraph into the node and dropping templateId.
  //
  // Selection rules:
  //   • Allowed even from the read-only inner-subgraph view of a template
  //     instance — this is the "Fork to edit" CTA flow. The action mutates
  //     the OUTER graph (the procedure root or whichever container holds
  //     the template instance), not the inner subgraph being viewed.
  //   • To make that work, the selection target for the fork is the deepest
  //     currentParentGroup when we're inside a template-instance subgraph,
  //     OR the selectedNode otherwise.
  //
  // The deep-clone uses a JSON parse/stringify round-trip: structuredClone
  // throws on Vue's reactive proxies (see the inline note at the clone site).
  //
  // Edge case: if the template was deleted between selection and confirm,
  // GET /:id returns 404 → we surface that as an error in the modal so the
  // user can dismiss and stop trying.
  interface ForkTarget {
    // The group node to convert (the template instance).
    node: GraphNode;
    // The graph in which that node lives. May be the procedure root or any
    // outer subgraph (when the user is viewing the inner read-only graph of
    // an instance, the instance node lives one frame up).
    containerGraph: ProcedureGraph;
  }

  const forkTarget = computed<ForkTarget | null>(() => {
    if (!selected.value) return null;
    const frames = subgraphFrames.value;
    // Case A: user is INSIDE a template-instance subgraph (read-only view).
    // The instance node is the parent group; its container is the previous
    // frame's graph.
    if (isCurrentGraphReadOnly.value && frames.length >= 2) {
      const parent = frames[frames.length - 1]!.groupNode;
      const container = frames[frames.length - 2]!.graph;
      if (parent && parent.kind === "group" && parent.templateId) {
        return { node: parent, containerGraph: container };
      }
    }
    // Case B: user has a template-instance node selected in the current
    // (editable) graph.
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
  const forkError = ref<ReturnType<typeof resolveError>>(null);

  function openFork() {
    if (!canForkToLocal.value) return;
    forkError.value = null;
    forkSubmitting.value = false;
    forkOpen.value = true;
  }

  interface FetchedTemplate {
    _id: string;
    name: string;
    description: string;
    icon: string;
    ports: GroupPort[];
    subgraph: ProcedureGraph;
  }

  // Replace the template instance node with a forked local copy. Mirrors the
  // shape of convertLocalGroupToTemplateInstance but in reverse: drops
  // templateId, installs subgraph from the fetched template, and writes back
  // through onUpdateNode / onGraphUpdate (so history + dirty-snapshot stay
  // consistent). The replacement uses a fresh node object so Vue reactivity
  // sees a real change.
  function convertTemplateInstanceToLocal(
    target: ForkTarget,
    template: FetchedTemplate,
  ): void {
    const { node, containerGraph } = target;
    const idx = containerGraph.nodes.findIndex(
      (n) => n.id === node.id && n.kind === "group",
    );
    if (idx === -1) return;
    const updated: GraphNode = {
      ...node,
      // Deep-clone the template's subgraph so subsequent edits to the
      // template (or to this fork) don't alias each other. JSON round-trip
      // strips Vue's reactive proxy — structuredClone throws on proxies.
      subgraph: JSON.parse(JSON.stringify(template.subgraph)) as ProcedureGraph,
      // Preserve the local ports if the instance carries them (it should
      // — palette drops clone template.ports onto the instance); fall back
      // to the template's port list otherwise.
      ports:
        Array.isArray(node.ports) && node.ports.length > 0
          ? node.ports.map((p) => ({ ...p }))
          : template.ports.map((p) => ({ ...p })),
    };
    delete updated.templateId;

    // If the user was inside the template instance's subgraph (Case A in
    // forkTarget), pop the read-only path segment first so the canvas
    // re-binds to the (now editable) outer graph. The user can re-enter
    // the local subgraph fresh via dblclick if they want.
    if (isCurrentGraphReadOnly.value && subgraphPath.value.length > 1) {
      subgraphPath.value = subgraphPath.value.slice(0, -1);
      selectedNodeId.value = updated.id;
    }

    // Use onUpdateNode — it walks subgraphPath and rewrites the correct
    // container graph (root or any depth). Because we just popped above
    // when needed, currentGraph now points at containerGraph.
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
          name:
            target.node.label ||
            (target.node.config?.name as string | undefined) ||
            tpl.name,
        }),
        color: "success",
        icon: "i-ph-check-circle",
      });
    } catch (e) {
      forkError.value = resolveError(e, {
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
