import { computed, nextTick, watch, type Ref } from "vue";
import type { GraphNode as AppGraphNode } from "../../../composables/useGraphConnect";
import { FIT_MAX_ZOOM, FIT_PADDING, MIN_ZOOM } from "./types";
import type {
  CanvasProps,
  FlowController,
  FlowNodeState,
  Reveal,
} from "./types";

export function useCanvasView({
  props,
  flowRef,
  wrapRef,
  reveal,
}: {
  props: Readonly<CanvasProps>;
  flowRef: Ref<FlowController | null>;
  wrapRef: Ref<HTMLElement | null>;
  reveal: Reveal;
}) {
  // The width of the canvas the inspector covers when it is drawn over it.
  function coveredRight(): number {
    const cover = props.coveredBy?.getBoundingClientRect();
    const own = wrapRef.value?.getBoundingClientRect();
    if (!cover?.width || !own) return 0;
    return Math.max(
      0,
      Math.min(own.right, cover.right) - Math.max(own.left, cover.left),
    );
  }

  // Fit every node into the part of the canvas left visible.
  function fitView() {
    const flow = flowRef.value;
    if (!flow) return;
    const nodes = props.graph.nodes
      .map((n) => flow.findNode(n.id))
      .filter((n): n is FlowNodeState => !!n?.dimensions.width);
    if (nodes.length === 0) return;
    const left = Math.min(...nodes.map((n) => n.computedPosition.x));
    const top = Math.min(...nodes.map((n) => n.computedPosition.y));
    const width =
      Math.max(...nodes.map((n) => n.computedPosition.x + n.dimensions.width)) -
      left;
    const height =
      Math.max(
        ...nodes.map((n) => n.computedPosition.y + n.dimensions.height),
      ) - top;
    const visible = flow.dimensions.width - coveredRight();
    const room = 1 + FIT_PADDING;
    const fit = Math.min(
      visible / (width * room),
      flow.dimensions.height / (height * room),
    );
    const zoom = Math.min(Math.max(fit, MIN_ZOOM), FIT_MAX_ZOOM);
    flow.setViewport({
      x: (visible - width * zoom) / 2 - left * zoom,
      y: (flow.dimensions.height - height * zoom) / 2 - top * zoom,
      zoom,
    });
  }

  // Select a node and bring it into the visible part of the canvas. A node the
  // editor points at (a link, a problem) is also shown at a readable zoom; a
  // new node keeps the zoom.
  function focusNode(id: string, readable = false) {
    const flow = flowRef.value;
    const node = flow?.findNode(id);
    if (!flow || !node) return;
    if (!node.selected) flow.addSelectedNodes([node]);
    // Selecting opens the inspector, which narrows or covers the canvas:
    // look once it is drawn (two frames).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => panTo(id, readable)),
    );
  }

  function panTo(id: string, readable: boolean) {
    const flow = flowRef.value;
    const node = flow?.findNode(id);
    if (!flow || !node) return;
    const visible = flow.dimensions.width - coveredRight();
    const zoom = readable
      ? Math.max(flow.viewport.zoom, 1)
      : flow.viewport.zoom;
    const left = node.computedPosition.x * zoom + flow.viewport.x;
    const top = node.computedPosition.y * zoom + flow.viewport.y;
    const inSight =
      left >= 0 &&
      top >= 0 &&
      left + node.dimensions.width * zoom <= visible &&
      top + node.dimensions.height * zoom <= flow.dimensions.height;
    if (inSight && zoom === flow.viewport.zoom) return;
    flow.setViewport(
      {
        x:
          visible / 2 -
          (node.computedPosition.x + node.dimensions.width / 2) * zoom,
        y:
          flow.dimensions.height / 2 -
          (node.computedPosition.y + node.dimensions.height / 2) * zoom,
        zoom,
      },
      // A node pointed at is shown at once; a new one slides into view.
      { duration: readable ? 0 : 200 },
    );
  }

  // A new graph on the canvas (first load, another procedure, a group entered
  // or left) is fitted into view; a node just added or pointed at is shown.
  // Both wait until every node is measured and the panels around the canvas
  // have settled (two frames): Vue Flow keeps the measures of nodes whose id
  // the previous graph shared, so it does not always report them again.
  let fitPending = true;
  let settleQueued = false;

  function settleView() {
    if (settleQueued) return;
    settleQueued = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        settleQueued = false;
        const flow = flowRef.value;
        if (
          !flow ||
          !props.graph.nodes.every((n) => flow.findNode(n.id)?.dimensions.width)
        )
          return;
        if (fitPending) {
          fitPending = false;
          fitView();
          // The node the editor points at stays the one shown.
          if (props.selectedNodeId)
            reveal.pending ??= { id: props.selectedNodeId, readable: true };
        }
        if (reveal.pending) {
          const { id, readable } = reveal.pending;
          reveal.pending = null;
          focusNode(id, readable);
        }
      }),
    );
  }

  // Vue Flow emits this once every node on the canvas has been measured.
  function onNodesInitialized() {
    settleView();
  }

  watch(
    () => props.viewKey,
    () => {
      fitPending = true;
      nextTick(settleView);
    },
  );

  watch(
    () => props.selectedNodeId,
    (id) => {
      const flow = flowRef.value;
      // The editor closed its inspector: the canvas lets go of the node too.
      if (!id) {
        if (flow?.getSelectedNodes.length)
          flow.removeSelectedNodes(flow.getSelectedNodes);
        return;
      }
      // A node selected on the canvas itself is already where the user looks.
      if (flow?.findNode(id)?.selected) return;
      reveal.pending = { id, readable: true };
      nextTick(settleView);
    },
    // The editor may name a node (a `?node=` link) before the canvas exists.
    { immediate: true },
  );

  // Vue Flow caches each node's handle bounding boxes in its internal store and
  // only re-measures when `updateNodeInternals(id)` is called. When a port is
  // renamed or moved between the title bar and body (e.g. renaming a port to
  // "main" moves the handle from a body row into the header), the Handle DOM
  // element ends up in a different on-screen position but the cached bbox stays
  // stale — connected edges keep drawing to the OLD coordinates until the next
  // re-measure.
  //
  // To keep edges glued to handles, watch a signature derived from the per-node
  // port lists / kinds and force a re-measure of every node after the DOM has
  // applied the new template. Watching the full `props.graph` would fire on
  // every drag (each emitGraph returns a fresh object) — costly and pointless,
  // since node positions trigger their own internal updates already. The
  // signature only changes when port shape changes, which is exactly when we
  // need to re-measure.
  const portsSignature = computed(() => {
    const own = props.graph.nodes
      .map((n) => {
        const ports = (n as AppGraphNode & { ports?: unknown }).ports;
        const portsKey = Array.isArray(ports) ? JSON.stringify(ports) : "";
        return `${n.id}:${n.kind}:${portsKey}`;
      })
      .join("|");
    // Sentinel nodes (groupInput / groupOutput) inside this canvas render
    // handles derived from `parentGroupPorts`, not from their own node data.
    // A rename on the outer group's port list re-renders the sentinel but
    // doesn't show up in `props.graph.nodes` above, so we must also fold
    // the parent ports into the signature.
    const parent = Array.isArray(props.parentGroupPorts)
      ? JSON.stringify(props.parentGroupPorts)
      : "";
    return `${own}#${parent}`;
  });

  watch(portsSignature, () => {
    nextTick(() => {
      for (const node of props.graph.nodes) {
        flowRef.value?.updateNodeInternals(node.id);
      }
    });
  });

  const zoomPercent = computed(() => {
    const zoom = flowRef.value?.viewport.zoom ?? 1;
    return `${Math.round(zoom * 100)}%`;
  });

  function resetZoom() {
    flowRef.value?.zoomTo(1);
  }

  return { fitView, onNodesInitialized, zoomPercent, resetZoom };
}
