import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { DockIssue } from "../../../components/Editor/BottomDock.vue";
import type { ProcedureSummaryRow } from "../../../components/Editor/ProcedureSwitcher.vue";
import type {
  GraphNode,
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import type { WordedTrigger } from "../../../utils/describe";
import { cloneGraph, structuralKey } from "../../utils/editor/graphShape";
import type {
  GraphIssue,
  ProcedureRecord,
  ProcedureSnapshot,
} from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { SubgraphNavigation } from "./useSubgraphNavigation";
import { configName } from "./valueGuards";

const NAME_INPUT_ID = "builder-procedure-name";
const VALIDATE_DELAY_MS = 500;

/** How many things changed since the last save: the name, the switch, the template's ports, each step added, removed or changed, and the wires as one. */
function countChanges(
  current: ProcedureRecord,
  saved: ProcedureSnapshot,
  templatePorts: GroupPort[],
): number {
  let count = 0;
  if (current.name !== saved.name) count++;
  if (current.enabled !== saved.enabled) count++;
  if (
    saved.ports &&
    JSON.stringify(saved.ports) !== JSON.stringify(templatePorts)
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
}

function walkAll(graph: ProcedureGraph | undefined): GraphNode[] {
  if (!graph) return [];
  return graph.nodes.flatMap((n) => [n, ...walkAll(n.subgraph)]);
}

function nodeTypeName(ctx: EditorContext, node: GraphNode): string | undefined {
  if (node.kind === "trigger")
    return ctx.triggerTypes.value.find((x) => x.id === node.typeId)?.name;
  if (node.kind === "action")
    return ctx.actionTypes.value.find((x) => x.id === node.typeId)?.name;
  if (node.kind === "data")
    return ctx.dataNodeTypes.value.find((x) => x.id === node.typeId)?.name;
  return ctx.nodeKinds.value.find((k) => k.kind === node.kind)?.meta.ui?.label;
}

/** The draft is checked by the server a moment after each change, with the procedure and its name so it also checks what other procedures hold (a webhook path, a name). The draft as opened is checked in the browser only: a server render has no draft to check, and its timer would outlive the render. */
function useDraftValidation(ctx: EditorContext) {
  const { $authFetch, draftTriggers, editorMode, issues, props, selected } =
    ctx;
  let validateTimer: ReturnType<typeof setTimeout> | undefined;

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
        body: {
          graph: current.graph,
          enabled: current.enabled,
          procedureId: current._id,
          name: current.name,
        },
      });
      issues.value = res.issues ?? [];
      draftTriggers.value = res.triggers ?? [];
    } catch {}
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
  onMounted(scheduleValidation);
  onBeforeUnmount(() => clearTimeout(validateTimer));

  return { validateDraft };
}

/** The dock opens on the problems tab when the first blocking one shows up, and folds again once they are gone if that was what opened it. */
function useProblemsDock(
  ctx: EditorContext,
  blockingIssues: { value: GraphIssue[] },
) {
  const { dockCollapsed, dockTab } = ctx;
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
}

/** The issues as the dock lists them (named after their node), and the first of each node as the inspector shows it: code and params travel along, so it names a setting as its form does. */
function useIssueViews(
  ctx: EditorContext,
  nodeDisplayName: (id: string) => string,
) {
  const { issues, t, te } = ctx;

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

  const issuesByNode = computed(() => {
    const out = new Map<string, Omit<GraphIssue, "nodeId">>();
    for (const issue of issues.value) {
      if (!issue.nodeId) continue;
      if (!out.has(issue.nodeId) || issue.severity === "error")
        out.set(issue.nodeId, {
          severity: issue.severity,
          message: issueText(issue),
          code: issue.code,
          params: issue.params,
        });
    }
    return out;
  });

  return { dockIssues, issuesByNode };
}

/** The draft's name, state and problems: the bar's figures and what the server says of the draft. */
export function useDraftProblems(
  ctx: EditorContext,
  history: GraphHistory,
  nav: SubgraphNavigation,
) {
  const {
    editorMode,
    issues,
    processI18n,
    props,
    saveBlocked,
    savedSnapshot,
    selected,
    selectedId,
    selectedNodeId,
    subgraphPath,
    templatePorts,
  } = ctx;
  const { pushHistory } = history;
  const { groupName } = nav;

  const procedureName = computed<string>({
    get: () => selected.value?.name ?? "",
    set: (v: string) => {
      if (selected.value) selected.value.name = v;
    },
  });

  const savedName = computed<string>(
    () => savedSnapshot.value?.name || selected.value?.name || "",
  );

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

  const changeCount = computed<number>(() => {
    const current = selected.value;
    const saved = savedSnapshot.value;
    if (!current || !saved) return 0;
    return countChanges(current, saved, templatePorts.value);
  });

  const { validateDraft } = useDraftValidation(ctx);

  const blockingIssues = computed(() =>
    issues.value.filter((i) => i.severity === "error"),
  );

  function nodeDisplayName(id: string): string {
    const node = walkAll(selected.value?.graph).find((n) => n.id === id);
    if (!node) return id;
    if (node.kind === "group") return groupName(node);
    if (node.label) return node.label;
    const typeName = nodeTypeName(ctx, node);
    return typeName ? processI18n(typeName) : (configName(node) ?? node.kind);
  }

  const { dockIssues, issuesByNode } = useIssueViews(ctx, nodeDisplayName);

  useProblemsDock(ctx, blockingIssues);

  function selectNode(id: string) {
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
