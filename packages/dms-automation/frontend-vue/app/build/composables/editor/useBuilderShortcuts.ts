import { nextTick, onBeforeUnmount, onMounted } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { ProcedureGraph } from "../../../composables/useGraphConnect";
import { newId } from "../../../utils/automation";
import { cloneGraph } from "../../utils/editor/graphShape";
import {
  isActivatable,
  isEditableTarget,
  OVERLAY_SELECTOR,
} from "../../utils/editor/keyboard";
import type { GraphHistory } from "./useGraphHistory";
import type { SubgraphNavigation } from "./useSubgraphNavigation";
import type { GroupEditing } from "./useGroupEditing";
import type { UnsavedGuards } from "./useUnsavedGuards";
import type { BuilderSave } from "./useBuilderSave";
import type { SaveAsTemplate } from "./useSaveAsTemplate";
import type { ForkToLocal } from "./useForkToLocal";

/** The builder's keyboard shortcuts, and the clipboard they copy and paste through. */
export function useBuilderShortcuts(
  ctx: EditorContext,
  history: GraphHistory,
  nav: SubgraphNavigation,
  groups: GroupEditing,
  guards: UnsavedGuards,
  save: BuilderSave,
  saveTpl: SaveAsTemplate,
  fork: ForkToLocal,
  later: { onTestRun: () => Promise<void>; exitDebug: () => void },
) {
  const {
    currentGraph,
    editorMode,
    isCurrentGraphReadOnly,
    newProcedureOpen,
    overlayRun,
    runNowOpen,
    selectedNode,
    selectedNodeId,
    selectedNodeIds,
    subgraphPath,
    switcherOpen,
  } = ctx;
  const { isDirty, onRedo, onUndo } = history;
  const { canEnterGroup, enterSelectedGroup, exitSubgraph, onGraphUpdate } =
    nav;
  const { onDuplicateNode } = groups;
  const { browserNavigation, choiceDialog, onInertiaBefore, onNavigate } =
    guards;
  const { onSave } = save;
  const { saveAsTemplateOpen } = saveTpl;
  const { forkOpen } = fork;
  const { exitDebug, onTestRun } = later;

  // Keyboard. With Ctrl (⌘ on macOS): S saves, Enter runs a test, P opens the
  // switcher, Z / Shift+Z / Y undo and redo, D duplicates the selected step, C
  // and V copy and paste the selection. Enter enters the selected group, Escape
  // leaves the debug view, then the group, then the selection. Tab is left to
  // the focus. Keys typed in a field, or while a dialog or a menu is open,
  // belong to them.

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

  /**
   * Blurs the focused field so it commits what is typed in it (a JSON setting
   * or the step name only do on blur), and returns it to focus again after.
   */
  async function commitFocusedField(): Promise<HTMLElement | null> {
    const field = document.activeElement;
    if (!(field instanceof HTMLElement) || !isEditableTarget(field))
      return null;
    field.blur();
    await nextTick();
    return field;
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

  // Ctrl+C / Ctrl+V: the selected steps and the wires between them, pasted as
  // new steps beside the originals, in this graph or another one.
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
    const nodes = g.nodes.filter(
      (n) =>
        ids.has(n.id) && n.kind !== "groupInput" && n.kind !== "groupOutput",
    );
    if (nodes.length === 0) return false;
    const kept = new Set(nodes.map((n) => n.id));
    clipboard = cloneGraph({
      nodes,
      triggerEdges: g.triggerEdges.filter(
        (e) => kept.has(e.from.node) && kept.has(e.to.node),
      ),
      dataEdges: g.dataEdges.filter(
        (e) => kept.has(e.from.node) && kept.has(e.to.node),
      ),
    });
    return true;
  }

  function pasteClipboard(): boolean {
    const g = currentGraph.value;
    if (!g || !clipboard || isCurrentGraphReadOnly.value) return false;
    // Triggers only live at the top level of a procedure.
    const triggersAllowed =
      editorMode.value === "procedure" && subgraphPath.value.length <= 1;
    // Each paste lands one step further, like Duplicate.
    clipboard.nodes = clipboard.nodes.map((n) => ({
      ...n,
      position: { x: n.position.x + 40, y: n.position.y + 60 },
    }));
    const source = cloneGraph(clipboard);
    const nodes = source.nodes.filter(
      (n) => triggersAllowed || n.kind !== "trigger",
    );
    if (nodes.length === 0) return false;
    const ids = new Map(nodes.map((n) => [n.id, newId()]));
    const idOf = (id: string) => ids.get(id)!;
    const pasted = nodes.map((n) => ({ ...n, id: idOf(n.id) }));
    const triggerEdges = source.triggerEdges
      .filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
      .map((e) => ({
        ...e,
        id: newId(),
        from: { ...e.from, node: idOf(e.from.node) },
        to: { ...e.to, node: idOf(e.to.node) },
      }));
    const dataEdges = source.dataEdges
      .filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
      .map((e) => ({
        ...e,
        id: newId(),
        from: { ...e.from, node: idOf(e.from.node) },
        to: { ...e.to, node: idOf(e.to.node) },
      }));
    onGraphUpdate({
      ...g,
      nodes: [...g.nodes, ...pasted],
      triggerEdges: [...g.triggerEdges, ...triggerEdges],
      dataEdges: [...g.dataEdges, ...dataEdges],
    });
    selectedNodeId.value = pasted.at(-1)!.id;
    return true;
  }

  /** The editing shortcuts, on the canvas: whatever is not typed in a field. */
  function onEditShortcut(ev: KeyboardEvent, key: string): boolean {
    if (isEditableTarget(ev.target)) return false;
    if (key === "z" || key === "y") {
      if (key === "y" || ev.shiftKey) onRedo();
      else onUndo();
      return true;
    }
    if (key === "d") {
      const node = selectedNode.value;
      if (node && node.kind !== "groupInput" && node.kind !== "groupOutput")
        onDuplicateNode({ id: node.id });
      return true;
    }
    // A text selected on the page is copied as text.
    if (key === "c")
      return !window.getSelection()?.toString() && copySelection();
    if (key === "v") return pasteClipboard();
    return false;
  }

  // Listened to in the capture phase, so a focused field (a select opens on
  // Enter) never sees a shortcut meant for the builder.
  function onShortcut(ev: KeyboardEvent): boolean {
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return false;
    const key = ev.key.toLowerCase();
    // The browser's "Save page" is never what Ctrl+S means here.
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
