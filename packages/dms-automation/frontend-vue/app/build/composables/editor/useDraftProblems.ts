import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { DockIssue } from "../../../components/Editor/BottomDock.vue";
import type { ProcedureSummaryRow } from "../../../components/Editor/ProcedureSwitcher.vue";
import type {
  GraphNode,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import type { WordedTrigger } from "../../../utils/describe";
import { cloneGraph, structuralKey } from "../../utils/editor/graphShape";
import type { GraphIssue } from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { SubgraphNavigation } from "./useSubgraphNavigation";

/** The draft's name, state and problems: the bar's figures and what the server says of the draft. */
export function useDraftProblems(
  ctx: EditorContext,
  history: GraphHistory,
  nav: SubgraphNavigation,
) {
  const {
    $authFetch,
    actionTypes,
    dataNodeTypes,
    dockCollapsed,
    dockTab,
    draftTriggers,
    editorMode,
    issues,
    nodeKinds,
    processI18n,
    props,
    saveBlocked,
    savedSnapshot,
    selected,
    selectedId,
    selectedNodeId,
    subgraphPath,
    t,
    te,
    templatePorts,
    triggerTypes,
  } = ctx;
  const { pushHistory } = history;
  const { groupName } = nav;

  const procedureName = computed<string>({
    get: () => selected.value?.name ?? "",
    set: (v: string) => {
      if (selected.value) selected.value.name = v;
    },
  });

  // Titles and toasts about what is stored name it as stored, not as the
  // draft spells it (possibly blank) at that moment.
  const savedName = computed<string>(
    () => savedSnapshot.value?.name || selected.value?.name || "",
  );

  // The name is the one field outside the graph a save checks: a blank one is
  // said under the name, and Save waits for it.
  const NAME_INPUT_ID = "builder-procedure-name";
  const nameMissing = computed<boolean>(
    () => !!selected.value && !selected.value.name.trim(),
  );

  const procedureEnabled = computed<boolean>({
    get: () => selected.value?.enabled ?? false,
    set: (v: boolean) => {
      if (selected.value) selected.value.enabled = v;
    },
  });

  const summariesRead = useApiData<ProcedureSummaryRow[]>(() =>
    editorMode.value === "procedure"
      ? `${props.apiUrl}/procedures/summary`
      : null,
  );
  const summaries = computed(() => summariesRead.data.value ?? []);

  const currentSummary = computed(
    () =>
      summaries.value.find((s) => s.procedureId === selectedId.value) ?? null,
  );

  /** How many things changed since the last save, for "2 unsaved changes". */
  const changeCount = computed<number>(() => {
    const current = selected.value;
    const saved = savedSnapshot.value;
    if (!current || !saved) return 0;
    let count = 0;
    if (current.name !== saved.name) count++;
    if (current.enabled !== saved.enabled) count++;
    if (
      saved.ports &&
      JSON.stringify(saved.ports) !== JSON.stringify(templatePorts.value)
    )
      count++;
    const before = new Map(
      saved.graph.nodes.map((n) => [n.id, JSON.stringify(n)]),
    );
    const after = new Map(
      current.graph.nodes.map((n) => [n.id, JSON.stringify(n)]),
    );
    for (const [id, value] of after) if (before.get(id) !== value) count++;
    for (const id of before.keys()) if (!after.has(id)) count++;
    const edges = (g: ProcedureGraph) =>
      JSON.stringify([g.triggerEdges, g.dataEdges]);
    if (edges(current.graph) !== edges(saved.graph)) count++;
    return count;
  });

  let validateTimer: ReturnType<typeof setTimeout> | undefined;
  const VALIDATE_DELAY_MS = 500;

  async function validateDraft() {
    const current = selected.value;
    if (!current || editorMode.value !== "procedure") {
      issues.value = [];
      draftTriggers.value = [];
      return;
    }
    try {
      const res = await $authFetch<{
        issues: typeof issues.value;
        triggers?: WordedTrigger[];
      }>(`${props.apiUrl}/procedures/validate`, {
        method: "POST",
        onResponse({ response, options }) {
          if (
            response.status === HTTP_FORBIDDEN &&
            response.headers.get("x-dms-readonly") === "1"
          )
            options.onResponseError = undefined;
        },
        // With the procedure and its name, the server also checks what other
        // procedures hold (a webhook path, a name).
        body: {
          graph: current.graph,
          enabled: current.enabled,
          procedureId: current._id,
          name: current.name,
        },
      });
      issues.value = res.issues ?? [];
      draftTriggers.value = res.triggers ?? [];
    } catch {
      // A graph the schema refuses is reported on save.
    }
  }

  function scheduleValidation() {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(() => void validateDraft(), VALIDATE_DELAY_MS);
  }
  watch(
    () =>
      selected.value
        ? [
            structuralKey(selected.value.graph),
            selected.value.name,
            selected.value.enabled,
          ].join("|")
        : "",
    scheduleValidation,
  );
  // The draft as opened is checked in the browser: a server render has no
  // draft to check, and its timer would outlive the render.
  onMounted(scheduleValidation);
  onBeforeUnmount(() => clearTimeout(validateTimer));

  const blockingIssues = computed(() =>
    issues.value.filter((i) => i.severity === "error"),
  );

  /** How the builder names a node: its label, else its type's name. */
  function nodeDisplayName(id: string): string {
    const node = walkAll(selected.value?.graph).find((n) => n.id === id);
    if (!node) return id;
    if (node.kind === "group") return groupName(node);
    if (node.label) return node.label;
    const typeName =
      node.kind === "trigger"
        ? triggerTypes.value.find((x) => x.id === node.typeId)?.name
        : node.kind === "action"
          ? actionTypes.value.find((x) => x.id === node.typeId)?.name
          : node.kind === "data"
            ? dataNodeTypes.value.find((x) => x.id === node.typeId)?.name
            : nodeKinds.value.find((k) => k.kind === node.kind)?.meta.ui?.label;
    return typeName
      ? processI18n(typeName)
      : ((node.config?.name as string | undefined) ?? node.kind);
  }

  function walkAll(graph: ProcedureGraph | undefined): GraphNode[] {
    if (!graph) return [];
    return graph.nodes.flatMap((n) => [n, ...walkAll(n.subgraph)]);
  }

  /** An issue in the user's language. */
  function issueText(issue: GraphIssue): string {
    const key = `dms_automation.editor.problems.codes.${issue.code}`;
    return issue.code && te(key) ? t(key, issue.params ?? {}) : issue.message;
  }

  const dockIssues = computed<DockIssue[]>(() =>
    issues.value.map((issue) => ({
      ...issue,
      message: issueText(issue),
      nodeName: issue.nodeId ? nodeDisplayName(issue.nodeId) : undefined,
    })),
  );

  // Code and params travel along: the inspector names a setting as its form does.
  const issuesByNode = computed<Record<string, Omit<GraphIssue, "nodeId">>>(
    () => {
      const out: Record<string, Omit<GraphIssue, "nodeId">> = {};
      for (const issue of issues.value) {
        if (!issue.nodeId) continue;
        if (!out[issue.nodeId] || issue.severity === "error")
          out[issue.nodeId] = {
            severity: issue.severity,
            message: issueText(issue),
            code: issue.code,
            params: issue.params,
          };
      }
      return out;
    },
  );

  let dockOpenedForProblems = false;
  watch(
    () => blockingIssues.value.length,
    (count, before) => {
      if (count > 0 && !before) {
        dockTab.value = "problems";
        dockCollapsed.value = false;
        dockOpenedForProblems = true;
      } else if (
        count === 0 &&
        dockOpenedForProblems &&
        dockTab.value === "problems"
      ) {
        dockCollapsed.value = true;
      }
    },
  );
  watch([dockTab, dockCollapsed], () => {
    if (dockCollapsed.value || dockTab.value !== "problems")
      dockOpenedForProblems = false;
  });

  function selectNode(id: string) {
    // A node inside a group is named by its top-level group in the issues.
    subgraphPath.value = subgraphPath.value.slice(0, 1);
    selectedNodeId.value = id;
  }

  function onCancel() {
    if (!selected.value || !savedSnapshot.value) return;
    const snap = savedSnapshot.value;
    selected.value.name = snap.name;
    selected.value.enabled = snap.enabled;
    selected.value.graph = cloneGraph(snap.graph);
    if (snap.ports)
      templatePorts.value = snap.ports.map((port) => ({ ...port }));
    pushHistory(selected.value.graph);
    // A refused save is answered by the draft it refused: discarding it
    // clears the banner, and the name, outside the graph, is checked again.
    saveBlocked.value = false;
    void validateDraft();
  }

  return {
    procedureName,
    savedName,
    NAME_INPUT_ID,
    nameMissing,
    procedureEnabled,
    summariesRead,
    summaries,
    currentSummary,
    changeCount,
    blockingIssues,
    nodeDisplayName,
    dockIssues,
    issuesByNode,
    selectNode,
    onCancel,
    validateDraft,
  };
}

export type DraftProblems = ReturnType<typeof useDraftProblems>;
