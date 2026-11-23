import { computed, ref } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { ProcedureGraph } from "../../../composables/useGraphConnect";
import { cloneGraph, repeatableChangeKey } from "../../utils/editor/graphShape";
import type { ProcedureRecord, ProcedureSnapshot } from "../../types/editor";

interface ChangeBurst {
  key: string | null;
  at: number;
}

/** The draft's undo history, and the snapshot a save is compared against. */
export function useGraphHistory(ctx: EditorContext) {
  const { editorMode, savedSnapshot, selected, templatePorts } = ctx;

  const graphHistory = ref<ProcedureGraph[]>([]);
  const graphHistoryIndex = ref<number>(-1);

  const HISTORY_LIMIT = 100;

  function takeSnapshot(p: ProcedureRecord): ProcedureSnapshot {
    const snapshot: ProcedureSnapshot = {
      name: p.name,
      enabled: p.enabled,
      graph: cloneGraph(p.graph),
    };
    if (editorMode.value === "template") {
      snapshot.ports = templatePorts.value.map((port) => ({ ...port }));
    }
    return snapshot;
  }

  const HISTORY_MERGE_MS = 1000;
  let lastChange: ChangeBurst = { key: null, at: 0 };

  function pushHistory(g: ProcedureGraph, merge = false) {
    const current = graphHistory.value[graphHistoryIndex.value];
    if (current && JSON.stringify(current) === JSON.stringify(g)) return;
    const key = merge && current ? repeatableChangeKey(current, g) : null;
    const now = Date.now();
    const sameBurst =
      key !== null &&
      key === lastChange.key &&
      now - lastChange.at < HISTORY_MERGE_MS;
    lastChange = { key, at: now };
    graphHistory.value = graphHistory.value.slice(
      0,
      graphHistoryIndex.value + 1,
    );
    if (sameBurst) {
      graphHistory.value[graphHistoryIndex.value] = cloneGraph(g);
      return;
    }
    graphHistory.value.push(cloneGraph(g));
    graphHistoryIndex.value = graphHistory.value.length - 1;
    if (graphHistory.value.length > HISTORY_LIMIT) {
      graphHistory.value.shift();
      graphHistoryIndex.value--;
    }
  }

  function initHistoryAndSaved() {
    lastChange = { key: null, at: 0 };
    if (selected.value) {
      graphHistory.value = [cloneGraph(selected.value.graph)];
      graphHistoryIndex.value = 0;
      savedSnapshot.value = takeSnapshot(selected.value);
    } else {
      graphHistory.value = [];
      graphHistoryIndex.value = -1;
      savedSnapshot.value = null;
    }
  }

  const canUndo = computed<boolean>(() => graphHistoryIndex.value > 0);
  const canRedo = computed<boolean>(
    () => graphHistoryIndex.value < graphHistory.value.length - 1,
  );
  const isDirty = computed<boolean>(() => {
    if (!selected.value || !savedSnapshot.value) return false;
    return (
      JSON.stringify(takeSnapshot(selected.value)) !==
      JSON.stringify(savedSnapshot.value)
    );
  });

  function onUndo() {
    if (!canUndo.value || !selected.value) return;
    lastChange = { key: null, at: 0 };
    graphHistoryIndex.value--;
    const g = graphHistory.value[graphHistoryIndex.value];
    if (g) selected.value.graph = cloneGraph(g);
  }

  function onRedo() {
    if (!canRedo.value || !selected.value) return;
    lastChange = { key: null, at: 0 };
    graphHistoryIndex.value++;
    const g = graphHistory.value[graphHistoryIndex.value];
    if (g) selected.value.graph = cloneGraph(g);
  }

  return {
    takeSnapshot,
    pushHistory,
    initHistoryAndSaved,
    canUndo,
    canRedo,
    isDirty,
    onUndo,
    onRedo,
  };
}

export type GraphHistory = ReturnType<typeof useGraphHistory>;
