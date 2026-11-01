import type { Connection } from "@vue-flow/core";
import { computed, ref, type Ref } from "vue";
import type { GraphNode as AppGraphNode } from "../../../composables/useGraphConnect";
import type { ConnectionCheck } from "./connect";
import type { CanvasProps, CanvasText, LinkItem, NodeHandles } from "./types";

export function useLinkMenu({
  props,
  t,
  canvasSelection,
  check,
  handlesOf,
  menuName,
  onConnect,
}: {
  props: Readonly<CanvasProps>;
  t: CanvasText["t"];
  canvasSelection: Ref<string[]>;
  check: ConnectionCheck;
  handlesOf: (node: AppGraphNode) => NodeHandles;
  menuName: (id: string) => string;
  onConnect: (conn: Connection) => void;
}) {
  // Without a mouse: every link the selected step can make, from the canvas
  // toolbar (WCAG 2.5.7).

  const linkGroups = computed(() => {
    const id =
      canvasSelection.value.length === 1 ? canvasSelection.value[0] : undefined;
    const node = props.graph.nodes.find((n) => n.id === id);
    if (!node || props.readOnly) return [];
    const mine = handlesOf(node);
    const next: LinkItem[] = [];
    const send: LinkItem[] = [];
    const read: LinkItem[] = [];
    const wired = (target: string, field: string) =>
      props.graph.dataEdges.some(
        (e) => e.to.node === target && e.to.field === field,
      );
    const add = (into: LinkItem[], label: string, connection: Connection) => {
      if (check(props.graph, connection).ok) into.push({ label, connection });
    };
    for (const other of props.graph.nodes) {
      if (other.id === node.id) continue;
      const theirs = handlesOf(other);
      const name = menuName(other.id);
      for (const out of mine.triggerOuts) {
        const current = props.graph.triggerEdges.find(
          (e) =>
            e.from.node === node.id && (e.from.branch ?? "main") === out.name,
        );
        if (current?.to.node === other.id) continue;
        // The output already leads somewhere: the menu says what goes.
        const replaces = current
          ? ` (${t("dms_automation.editor.canvas.link.replaces", { name: menuName(current.to.node) })})`
          : "";
        for (const into of theirs.triggerIns) {
          const branch = out.name === "main" ? "" : `${out.name} `;
          const port =
            into.name && into.name !== "main" ? ` · ${into.name}` : "";
          add(next, `${branch}→ ${name}${port}${replaces}`, {
            source: node.id,
            sourceHandle: out.id,
            target: other.id,
            targetHandle: into.id,
          });
        }
      }
      for (const out of mine.dataOuts) {
        for (const into of theirs.dataIns) {
          if (wired(other.id, into.name)) continue;
          add(send, `${out.name} → ${name} · ${into.name}`, {
            source: node.id,
            sourceHandle: out.id,
            target: other.id,
            targetHandle: into.id,
          });
        }
      }
      for (const out of theirs.dataOuts) {
        for (const into of mine.dataIns) {
          if (wired(node.id, into.name)) continue;
          add(read, `${name} · ${out.name} → ${into.name}`, {
            source: other.id,
            sourceHandle: out.id,
            target: node.id,
            targetHandle: into.id,
          });
        }
      }
    }
    const group = (key: string, items: LinkItem[]) =>
      items.length
        ? [
            {
              type: "label" as const,
              label: t(`dms_automation.editor.canvas.link.${key}`),
            },
            ...items,
          ]
        : [];
    return [
      group("next", next),
      group("send", send),
      group("read", read),
    ].filter((g) => g.length > 0);
  });

  // The link menu is offered for a single selected step of an editable graph.
  const canLink = computed(
    () => !props.readOnly && canvasSelection.value.length === 1,
  );

  // The menu is an action, not a field: it never keeps a value.
  const linkChoice = ref<LinkItem | null>(null);

  function onLink(item: LinkItem | null) {
    if (item?.connection) onConnect(item.connection);
    linkChoice.value = null;
  }

  return { linkGroups, canLink, linkChoice, onLink };
}
