import { nextTick, onBeforeUnmount, onMounted } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { ProcedureGraph } from "../../../composables/useGraphConnect";
import {
  isActivatable,
  isEditableTarget,
  OVERLAY_SELECTOR,
} from "../../utils/editor/keyboard";
import {
  copiedGraph,
  isGroupBoundary,
  pastedInto,
  shiftedNodes,
} from "./graphClipboard";
import type { GraphHistory } from "./useGraphHistory";
import type { SubgraphNavigation } from "./useSubgraphNavigation";
import type { GroupEditing } from "./useGroupEditing";
import type { UnsavedGuards } from "./useUnsavedGuards";
import type { BuilderSave } from "./useBuilderSave";
import type { SaveAsTemplate } from "./useSaveAsTemplate";
import type { ForkToLocal } from "./useForkToLocal";

/** The composables the shortcuts act through. */
interface ShortcutDependencies {
  history: GraphHistory;
  nav: SubgraphNavigation;
  groups: GroupEditing;
  guards: UnsavedGuards;
  save: BuilderSave;
  saveTpl: SaveAsTemplate;
  fork: ForkToLocal;
  later: { onTestRun: () => Promise<void>; exitDebug: () => void };
}

/**
 * Blurs the focused field so it commits what is typed in it (a JSON setting
 * or the step name only do on blur), and returns it to focus again after.
 */
async function commitFocusedField(): Promise<HTMLElement | null> {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !isEditableTarget(field)) return null;
  field.blur();
  await nextTick();
  return field;
}

/** Ctrl+C / Ctrl+V: the selected steps and the wires between them, pasted as new steps beside the originals, in this graph or another one. */
function useSelectionClipboard(ctx: EditorContext, nav: SubgraphNavigation) {
  const {
    currentGraph,
    editorMode,
    isCurrentGraphReadOnly,
    selectedNodeId,
    selectedNodeIds,
    subgraphPath,
  } = ctx;
  let clipboard: ProcedureGraph | null = null;

  function copySelection(): boolean {
    const g = currentGraph.value;
    const ids = new Set(
      selectedNodeIds.value.length > 0
        ? selectedNodeIds.value
        : selectedNodeId.value
          ? [selectedNodeId.value]
          : [],
    );
    if (!g || ids.size === 0) return false;
    const copy = copiedGraph(g, ids);
    if (!copy) return false;
    clipboard = copy;
    return true;
  }

  function pasteClipboard(): boolean {
    const g = currentGraph.value;
    if (!g || !clipboard || isCurrentGraphReadOnly.value) return false;
    const triggersAllowed =
      editorMode.value === "procedure" && subgraphPath.value.length <= 1;
    clipboard.nodes = shiftedNodes(clipboard.nodes);
    const pasted = pastedInto(g, clipboard, triggersAllowed);
    if (!pasted) return false;
    nav.onGraphUpdate(pasted.graph);
    selectedNodeId.value = pasted.lastId;
    return true;
  }

  return { copySelection, pasteClipboard };
}

/** The editing shortcuts, on the canvas: whatever is not typed in a field. */
function useEditShortcuts(
  ctx: EditorContext,
  history: GraphHistory,
  groups: GroupEditing,
  nav: SubgraphNavigation,
) {
  const { selectedNode } = ctx;
  const { onRedo, onUndo } = history;
  const { copySelection, pasteClipboard } = useSelectionClipboard(ctx, nav);

  return function onEditShortcut(ev: KeyboardEvent, key: string): boolean {
    if (isEditableTarget(ev.target)) return false;
    if (key === "z" || key === "y") {
      if (key === "y" || ev.shiftKey) onRedo();
      else onUndo();
      return true;
    }
    if (key === "d") {
      const node = selectedNode.value;
      if (node && !isGroupBoundary(node))
        groups.onDuplicateNode({ id: node.id });
      return true;
    }
    if (key === "c")
      return !window.getSelection()?.toString() && copySelection();
    if (key === "v") return pasteClipboard();
    return false;
  };
}

/**
 * The builder's keyboard shortcuts, and the clipboard they copy and paste through. With Ctrl (⌘ on macOS): S saves, Enter runs a test, P opens the switcher, Z / Shift+Z / Y undo and redo, D duplicates the selected step, C and V copy and paste the selection. Enter enters the selected group, Escape leaves the debug view, then the group, then the selection. Tab is left to the focus. Keys typed in a field, or while a dialog or a menu is open, belong to them. Listened to in the capture phase, so a focused field (a select opens on Enter) never sees a shortcut meant for the builder.
 */
export function useBuilderShortcuts(
  ctx: EditorContext,
  {
    history,
    nav,
    groups,
    guards,
    save,
    saveTpl,
    fork,
    later,
  }: ShortcutDependencies,
) {
  const {
    editorMode,
    newProcedureOpen,
    overlayRun,
    runNowOpen,
    selectedNodeId,
    subgraphPath,
    switcherOpen,
  } = ctx;
  const { isDirty } = history;
  const { canEnterGroup, enterSelectedGroup, exitSubgraph } = nav;
  const { browserNavigation, choiceDialog, onInertiaBefore, onNavigate } =
    guards;
  const { onSave } = save;
  const { saveAsTemplateOpen } = saveTpl;
  const { forkOpen } = fork;
  const { exitDebug, onTestRun } = later;
  const onEditShortcut = useEditShortcuts(ctx, history, groups, nav);

  function isOverlayOpen(): boolean {
    return (
      saveAsTemplateOpen.value ||
      forkOpen.value ||
      switcherOpen.value ||
      runNowOpen.value ||
      newProcedureOpen.value ||
      choiceDialog.value.open ||
      document.querySelector(OVERLAY_SELECTOR) !== null
    );
  }

  async function saveFromKeyboard() {
    const field = await commitFocusedField();
    if (isDirty.value) await onSave();
    field?.focus();
  }

  async function testRunFromKeyboard() {
    const field = await commitFocusedField();
    await onTestRun();
    field?.focus();
  }

  function onShortcut(ev: KeyboardEvent): boolean {
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return false;
    const key = ev.key.toLowerCase();
    if (key === "s") ev.preventDefault();
    if (isOverlayOpen()) return false;
    if (["s", "enter", "p"].includes(key)) ev.stopPropagation();
    if (key === "s") {
      void saveFromKeyboard();
      return true;
    }
    if (key === "enter" && editorMode.value === "procedure") {
      ev.preventDefault();
      void testRunFromKeyboard();
      return true;
    }
    if (key === "p" && editorMode.value === "procedure") {
      ev.preventDefault();
      switcherOpen.value = true;
      return true;
    }
    if (onEditShortcut(ev, key)) {
      ev.preventDefault();
      ev.stopPropagation();
      return true;
    }
    return false;
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (onShortcut(ev)) return;
    if (isEditableTarget(ev.target) || isOverlayOpen()) return;
    if (
      ev.key === "Enter" &&
      !ev.shiftKey &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey
    ) {
      if (!canEnterGroup.value || isActivatable(ev.target)) return;
      ev.preventDefault();
      enterSelectedGroup();
      return;
    }
    if (ev.key !== "Escape") return;
    if (overlayRun.value && subgraphPath.value.length <= 1) {
      ev.preventDefault();
      exitDebug();
    } else if (subgraphPath.value.length > 1) {
      ev.preventDefault();
      exitSubgraph();
    } else if (selectedNodeId.value) {
      ev.preventDefault();
      selectedNodeId.value = null;
    }
  }

  onMounted(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("inertia:before", onInertiaBefore);
    browserNavigation()?.addEventListener("navigate", onNavigate);
  });
  onBeforeUnmount(() => {
    if (typeof window === "undefined") return;
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    document.removeEventListener("inertia:before", onInertiaBefore);
    browserNavigation()?.removeEventListener("navigate", onNavigate);
  });
}

export type BuilderShortcuts = ReturnType<typeof useBuilderShortcuts>;
