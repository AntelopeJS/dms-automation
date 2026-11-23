import { computed, nextTick, watch, type Ref } from "vue";
import { FIT_MAX_ZOOM, FIT_PADDING, MIN_ZOOM } from "./types";
import type {
  CanvasProps,
  FlowController,
  FlowNodeState,
  Reveal,
  XY,
} from "./types";

function fitViewport(
  nodes: FlowNodeState[],
  flow: FlowController,
  visible: number,
): XY & { zoom: number } {
  const left = Math.min(...nodes.map((n) => n.computedPosition.x));
  const top = Math.min(...nodes.map((n) => n.computedPosition.y));
  const width =
    Math.max(...nodes.map((n) => n.computedPosition.x + n.dimensions.width)) -
    left;
  const height =
    Math.max(...nodes.map((n) => n.computedPosition.y + n.dimensions.height)) -
    top;
  const room = 1 + FIT_PADDING;
  const fit = Math.min(
    visible / (width * room),
    flow.dimensions.height / (height * room),
  );
  const zoom = Math.min(Math.max(fit, MIN_ZOOM), FIT_MAX_ZOOM);
  return {
    x: (visible - width * zoom) / 2 - left * zoom,
    y: (flow.dimensions.height - height * zoom) / 2 - top * zoom,
    zoom,
  };
}

function isInSight(
  node: FlowNodeState,
  flow: FlowController,
  visible: number,
  zoom: number,
): boolean {
  const left = node.computedPosition.x * zoom + flow.viewport.x;
  const top = node.computedPosition.y * zoom + flow.viewport.y;
  return (
    left >= 0 &&
    top >= 0 &&
    left + node.dimensions.width * zoom <= visible &&
    top + node.dimensions.height * zoom <= flow.dimensions.height
  );
}

/**
 * Vue Flow caches each node's handle bounding boxes and only re-measures on
 * `updateNodeInternals(id)`. A port renamed or moved between the title bar and
 * the body leaves the cached box stale, and connected edges keep drawing to
 * the old coordinates. The signature changes only when the port shape does, so
 * it can drive a re-measure: watching `props.graph` would fire on every drag.
 * The sentinels draw their handles from `parentGroupPorts`, which `props.graph`
 * does not show, so they are part of it.
 */
function portsSignatureOf(props: Readonly<CanvasProps>): string {
  const own = props.graph.nodes
    .map((n) => {
      const portsKey = Array.isArray(n.ports) ? JSON.stringify(n.ports) : "";
      return `${n.id}:${n.kind}:${portsKey}`;
    })
    .join("|");
  const parent = Array.isArray(props.parentGroupPorts)
    ? JSON.stringify(props.parentGroupPorts)
    : "";
  return `${own}#${parent}`;
}

function centredViewport(
  node: FlowNodeState,
  flow: FlowController,
  visible: number,
  zoom: number,
): XY & { zoom: number } {
  return {
    x:
      visible / 2 -
      (node.computedPosition.x + node.dimensions.width / 2) * zoom,
    y:
      flow.dimensions.height / 2 -
      (node.computedPosition.y + node.dimensions.height / 2) * zoom,
    zoom,
  };
}

function coveredWidth(
  cover: DOMRect | undefined,
  own: DOMRect | undefined,
): number {
  if (!cover?.width || !own) return 0;
  return Math.max(
    0,
    Math.min(own.right, cover.right) - Math.max(own.left, cover.left),
  );
}

function useRemeasureOnPortChange(
  props: Readonly<CanvasProps>,
  flowRef: Ref<FlowController | null>,
) {
  const portsSignature = computed(() => portsSignatureOf(props));
  watch(portsSignature, () => {
    void nextTick(() => {
      for (const node of props.graph.nodes) {
        flowRef.value?.updateNodeInternals(node.id);
      }
    });
  });
}

/**
 * Fits a new graph on the canvas (first load, another procedure, a group
 * entered or left) into view and shows a node just added or pointed at by the
 * editor, at a readable zoom for the latter. Both wait until every node is
 * measured and the panels around the canvas have settled (two frames): Vue Flow
 * keeps the measures of nodes whose id the previous graph shared, so it does
 * not always report them again. The inspector can cover the canvas's right
 * edge, so the nodes are kept out from under it.
 *
 * The editor closing its inspector lets the canvas go of the node too. The
 * editor may name a node (a `?node=` link) before the canvas exists, so the
 * watch on it is immediate.
 */
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
  function coveredRight(): number {
    return coveredWidth(
      props.coveredBy?.getBoundingClientRect(),
      wrapRef.value?.getBoundingClientRect(),
    );
  }

  function fitView() {
    const flow = flowRef.value;
    if (!flow) return;
    const nodes = props.graph.nodes
      .map((n) => flow.findNode(n.id))
      .filter((n): n is FlowNodeState => !!n?.dimensions.width);
    if (nodes.length === 0) return;
    void flow.setViewport(
      fitViewport(nodes, flow, flow.dimensions.width - coveredRight()),
    );
  }

  function focusNode(id: string, readable = false) {
    const flow = flowRef.value;
    const node = flow?.findNode(id);
    if (!flow || !node) return;
    if (!node.selected) flow.addSelectedNodes([node]);
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
    if (isInSight(node, flow, visible, zoom) && zoom === flow.viewport.zoom)
      return;
    void flow.setViewport(centredViewport(node, flow, visible, zoom), {
      duration: readable ? 0 : 200,
    });
  }

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

  function onNodesInitialized() {
    settleView();
  }

  watch(
    () => props.viewKey,
    () => {
      fitPending = true;
      void nextTick(settleView);
    },
  );

  watch(
    () => props.selectedNodeId,
    (id) => {
      const flow = flowRef.value;
      if (!id) {
        if (flow?.getSelectedNodes.length)
          flow.removeSelectedNodes(flow.getSelectedNodes);
        return;
      }
      if (flow?.findNode(id)?.selected) return;
      reveal.pending = { id, readable: true };
      void nextTick(settleView);
    },
    { immediate: true },
  );

  useRemeasureOnPortChange(props, flowRef);

  const zoomPercent = computed(() => {
    const zoom = flowRef.value?.viewport.zoom ?? 1;
    return `${Math.round(zoom * 100)}%`;
  });

  function resetZoom() {
    flowRef.value?.zoomTo(1);
  }

  return { fitView, onNodesInitialized, zoomPercent, resetZoom };
}
