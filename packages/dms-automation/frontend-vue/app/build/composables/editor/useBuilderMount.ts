import { computed, onMounted, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { TriggerSummary } from "../../../utils/describe";
import type { SubgraphNavigation } from "./useSubgraphNavigation";
import type { DraftProblems } from "./useDraftProblems";
import type { RunOverlay } from "./useRunOverlay";
import { isString } from "./valueGuards";

/** What the builder does when another procedure opens, when it mounts, and when its triggers change. */
export function useBuilderMount(
  ctx: EditorContext,
  nav: SubgraphNavigation,
  problems: DraftProblems,
  runs: RunOverlay,
) {
  const {
    builderPath,
    draftTriggers,
    editorMode,
    missingProcedureId,
    overlayRun,
    processI18n,
    processText,
    queryValue,
    route,
    router,
    selected,
    selectedId,
    selectedNodeId,
    subgraphPath,
    switcherOpen,
    testTriggerNodeId,
    triggerTypes,
  } = ctx;
  const { onGroupEnter } = nav;
  const { selectNode } = problems;
  const { openRunFromUrl } = runs;

  watch(selectedId, (id) => {
    if (id) missingProcedureId.value = null;
    overlayRun.value = null;
  });

  function enterPathFromUrl(): boolean {
    const ids = (queryValue("path") ?? "").split(",").filter(Boolean);
    for (const id of ids) {
      const depth = subgraphPath.value.length;
      onGroupEnter({ id });
      if (subgraphPath.value.length === depth) break;
    }
    return subgraphPath.value.length > 1;
  }

  onMounted(async () => {
    if (missingProcedureId.value) switcherOpen.value = true;
    const runId = queryValue("run");
    if (runId) await openRunFromUrl(runId);
    const nodeId = queryValue("node");
    if (nodeId) {
      if (enterPathFromUrl()) selectedNodeId.value = nodeId;
      else selectNode(nodeId);
    }
    if (
      editorMode.value === "procedure" &&
      selectedId.value &&
      queryValue("selected") !== selectedId.value
    ) {
      void router.replace({
        path: builderPath(),
        query: { ...route.query, selected: selectedId.value },
      });
    }
  });

  const selectedTriggerSummaries = computed<TriggerSummary[]>(() =>
    (selected.value?.graph.nodes ?? []).flatMap((n) => {
      const typeId = n.typeId;
      if (n.kind !== "trigger" || !typeId) return [];
      const config = n.config;
      return [
        {
          nodeId: n.id,
          typeId,
          typeName:
            triggerTypes.value.find((x) => x.id === typeId)?.name ?? typeId,
          path: isString(config?.path) ? config.path : undefined,
          method: isString(config?.method) ? config.method : undefined,
          cron: isString(config?.cron) ? config.cron : undefined,
        },
      ];
    }),
  );

  function triggerLabel(trigger: TriggerSummary): string {
    const worded = draftTriggers.value.find(
      (tr) => tr.nodeId === trigger.nodeId,
    );
    return worded ? processText(worded.text) : processI18n(trigger.typeName);
  }

  const testTriggerItems = computed(() =>
    selectedTriggerSummaries.value.map((trigger) => ({
      label: triggerLabel(trigger),
      value: trigger.nodeId ?? "",
    })),
  );
  watch(
    selectedTriggerSummaries,
    (triggers) => {
      if (
        triggers.some((trigger) => trigger.nodeId === testTriggerNodeId.value)
      )
        return;
      testTriggerNodeId.value =
        triggers.find((trigger) => trigger.typeId === "manual")?.nodeId ??
        triggers[0]?.nodeId;
    },
    { immediate: true },
  );

  return {
    selectedTriggerSummaries,
    testTriggerItems,
  };
}

export type BuilderMount = ReturnType<typeof useBuilderMount>;
