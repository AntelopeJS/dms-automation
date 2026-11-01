<script setup lang="ts">
import { markRaw, ref } from 'vue'
// The canvas chrome (dotted DMS background, zoom controls, themed
// node/handle/edge styling, pan/zoom + fit-view) now comes from the shared
// DmsFlowCanvas wrapper (dms ≥0.0.25). We only keep the @vue-flow/core bits
// our business renderers need: `Position` for node source/target anchors and
// the connection / change / edge types for our wiring handlers. The imperative
// flow controller (zoom/fit/updateNodeInternals/viewport) is reached through
// DmsFlowCanvas's exposed store via a template ref (see `flowRef`).
// Most node kinds share a single port-spec-driven renderer. Group and the
// two group sentinels stay custom because they have cross-graph port
// declarations and special handle naming.
import GenericNode from './nodes/GenericNode.vue'
import GroupNode from './nodes/GroupNode.vue'
import GroupInputNode from './nodes/GroupInputNode.vue'
import GroupOutputNode from './nodes/GroupOutputNode.vue'
import { useCanvasEdges } from '../../build/composables/graphCanvas/edges'
import { connectionCheck, useConnections } from '../../build/composables/graphCanvas/connect'
import { useEdgeEvents } from '../../build/composables/graphCanvas/edgeEvents'
import { useLinkMenu } from '../../build/composables/graphCanvas/linkMenu'
import { useCanvasNodes } from '../../build/composables/graphCanvas/nodeData'
import { useNodePlacement } from '../../build/composables/graphCanvas/placement'
import { useCanvasSelection } from '../../build/composables/graphCanvas/selection'
import { MAX_ZOOM, MIN_ZOOM } from '../../build/composables/graphCanvas/types'
import type {
	CanvasEmits,
	CanvasProps,
	FlowController,
	Reveal,
} from '../../build/composables/graphCanvas/types'
import { useCanvasView } from '../../build/composables/graphCanvas/view'
import type { ProcedureGraph } from '../../composables/useGraphConnect'

const props = defineProps<CanvasProps>()

const emit = defineEmits<CanvasEmits>()

const toast = useToast()
const { processI18n } = useTranslation()
const { processText } = useComposedText()
const { t, te } = useI18n()

const nodeTypes = markRaw({
	genericNode: GenericNode,
	group: GroupNode,
	groupInput: GroupInputNode,
	groupOutput: GroupOutputNode,
})

function emitGraph(g: ProcedureGraph) {
	emit('update:graph', g)
}

// The node to select and bring into view once drawn: one just added, or one
// the editor points at (`readable`).
const reveal: Reveal = { pending: null }

const flowRef = ref<FlowController | null>(null)
const wrapRef = ref<HTMLElement | null>(null)

// The same set, reactive (sentinels included), for the toolbar's link menu
// and the placement of new nodes.
const canvasSelection = ref<string[]>([])

const { nodeKindUiByKind, handlesOf, vfNodes, menuName } = useCanvasNodes(props, {
	t,
	te,
	processI18n,
	processText,
})
const vfEdges = useCanvasEdges(props, menuName)
const check = connectionCheck(props)

const { addNode, addTemplateInstance, onDragOver, onDrop } = useNodePlacement({
	props,
	flowRef,
	canvasSelection,
	nodeKindUiByKind,
	emitGraph,
	reveal,
	check,
	handlesOf,
})

// Node creation is driven from the left BuilderPalette (in Editor.vue) — expose
// the two add helpers so the palette's events can reach the graph mutation.
defineExpose({ addNode, addTemplateInstance })

const { fitView, onNodesInitialized, zoomPercent, resetZoom } = useCanvasView({
	props,
	flowRef,
	wrapRef,
	reveal,
})

const { onConnect, refusal, refusalShown, isValidConnection, onConnectEnd } = useConnections({
	props,
	t,
	toast,
	emitGraph,
	menuName,
	check,
	flowRef,
})

const { linkGroups, canLink, linkChoice, onLink } = useLinkMenu({
	props,
	t,
	canvasSelection,
	check,
	handlesOf,
	menuName,
	onConnect,
})

const { onNodesChange, onDeleteNodes } = useCanvasSelection({
	props,
	emit,
	canvasSelection,
	emitGraph,
})

const {
	onEdgesChange,
	onKeydown,
	onEdgeUpdateStart,
	onEdgeUpdate,
	onNodeDoubleClick,
	onEdgeUpdateEnd,
} = useEdgeEvents({ props, emit, flowRef, emitGraph })
</script>

<template>
	<div
		ref="wrapRef"
		class="graph-canvas-wrap @container relative w-full h-full border border-default rounded-lg overflow-hidden"
		@keydown="onKeydown"
		@dragover="onDragOver"
		@drop="onDrop"
	>
		<DmsFlowCanvas
			ref="flowRef"
			:nodes="vfNodes"
			:edges="vfEdges"
			:node-types="nodeTypes"
			:controls="false"
			:is-valid-connection="isValidConnection"
			:nodes-draggable="!readOnly"
			:nodes-connectable="!readOnly"
			:elements-selectable="true"
			:edges-updatable="!readOnly"
			:deletable-nodes="!readOnly"
			:fit-view-on-init="false"
			:min-zoom="MIN_ZOOM"
			:max-zoom="MAX_ZOOM"
			@nodes-initialized="onNodesInitialized"
			@connect="onConnect"
			@connect-end="onConnectEnd"
			@nodes-change="onNodesChange"
			@delete-nodes="onDeleteNodes"
			@edges-change="onEdgesChange"
			@edge-update-start="onEdgeUpdateStart"
			@edge-update="onEdgeUpdate"
			@edge-update-end="onEdgeUpdateEnd"
			@node-double-click="onNodeDoubleClick"
		>
			<!-- One row along the top edge: the breadcrumb (shrinks, truncated by
			     its owner) and the toolbar (Undo / Redo, the link menu and the
			     selection's group actions; saving lives in the editor's bar). A
			     read-only template-instance view keeps only the group actions
			     (Fork). The row lets pointer events through between the two.
			     Provided unconditionally: DmsFlowCanvas reads its panel slots
			     once, so a slot added later would never render. -->
			<template #top-left>
				<div class="pointer-events-none flex w-[calc(100cqw-1.5rem)] items-start justify-between gap-2">
					<!-- The breadcrumb takes what the toolbar leaves (6rem at least),
					     the toolbar wraps only past that. -->
					<div class="min-w-24 flex-1 basis-0">
						<div class="pointer-events-auto w-fit max-w-full">
							<slot name="breadcrumb" />
						</div>
					</div>
					<div
						v-if="canLink || $slots.groupActions"
						class="pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-1 rounded-lg border border-default bg-elevated p-1 shadow-md"
					>
						<template v-if="canLink">
							<!-- Links the selected step can make, for keyboard users: an
							     icon, so the row stays on one line. -->
							<UTooltip :text="$t('dms_automation.editor.canvas.link.label')">
								<USelectMenu
									:model-value="linkChoice"
									:items="linkGroups"
									size="sm"
									variant="ghost"
									icon="i-ph-flow-arrow"
									:aria-label="$t('dms_automation.editor.canvas.link.label')"
									:search-input="{ placeholder: $t('dms_automation.editor.canvas.link.search') }"
									:content="{ align: 'end' }"
									:ui="{ content: 'min-w-72', base: 'ps-1.5 pe-1.5', leading: 'static p-0', placeholder: 'hidden', trailing: 'hidden' }"
									@update:model-value="onLink"
								>
									<template #empty>
										{{ $t('dms_automation.editor.canvas.link.empty') }}
									</template>
								</USelectMenu>
							</UTooltip>
							<div v-if="$slots.groupActions" class="mx-1 h-5 w-px bg-default" />
						</template>
						<!-- Group-related actions slotted in by Editor.vue: Group
						     selection, Save as template, Fork to local group, Enter
						     group. -->
						<slot name="groupActions" />
					</div>
				</div>
			</template>

			<template #bottom-center>
				<p
					v-if="refusalShown"
					role="status"
					class="mx-auto mb-2 flex w-fit max-w-sm items-center gap-1.5 rounded-md border border-warning/40 bg-elevated px-2 py-1 text-xs text-warning shadow-md"
				>
					<UIcon name="i-ph-prohibit" class="size-3.5 shrink-0" />
					{{ refusal }}
				</p>
				<div
					class="mx-auto flex w-fit items-center gap-1 rounded-lg border border-default bg-elevated p-1 shadow-md"
				>
					<!-- Undo / Redo sit with the view controls, leaving the top row
					     to the selection's actions. -->
					<template v-if="!readOnly">
						<UTooltip :text="$t('dms_automation.editor.canvas.undo')" :kbds="['meta', 'z']">
							<UButton
								size="sm"
								variant="ghost"
								color="neutral"
								icon="i-ph-arrow-counter-clockwise"
								:aria-label="$t('dms_automation.editor.canvas.undo')"
								:disabled="!canUndo"
								@click="emit('undo')"
							/>
						</UTooltip>
						<UTooltip :text="$t('dms_automation.editor.canvas.redo')" :kbds="['meta', 'shift', 'z']">
							<UButton
								size="sm"
								variant="ghost"
								color="neutral"
								icon="i-ph-arrow-clockwise"
								:aria-label="$t('dms_automation.editor.canvas.redo')"
								:disabled="!canRedo"
								@click="emit('redo')"
							/>
						</UTooltip>
						<div class="mx-1 h-5 w-px bg-default" />
					</template>
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						icon="i-ph-magnifying-glass-minus"
						:aria-label="$t('dms_automation.editor.canvas.zoomOut')"
						@click="flowRef?.zoomOut()"
					/>
					<button
						type="button"
						class="px-2 text-sm tabular-nums text-muted transition-colors hover:text-highlighted"
						:aria-label="$t('dms_automation.editor.canvas.resetZoom')"
						@click="resetZoom"
					>
						{{ zoomPercent }}
					</button>
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						icon="i-ph-magnifying-glass-plus"
						:aria-label="$t('dms_automation.editor.canvas.zoomIn')"
						@click="flowRef?.zoomIn()"
					/>
					<div class="mx-1 h-5 w-px bg-default" />
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						icon="i-ph-arrows-out"
						:aria-label="$t('dms_automation.editor.canvas.fitView')"
						@click="fitView"
					/>
				</div>
			</template>
		</DmsFlowCanvas>
	</div>
</template>

<style>
/* The top row spans the canvas: between the breadcrumb and the toolbar, the
   pane under it stays draggable. Vue Flow sets the panel's pointer-events
   inline, hence the !important. */
.graph-canvas-wrap .vue-flow__panel.top.left {
	pointer-events: none !important;
}

/* Ports keep their small dot but take a 24px target (WCAG 2.5.8). */
.dms-automation-node .vue-flow__handle::before {
	content: '';
	position: absolute;
	inset: -8px;
	border-radius: 9999px;
}

/* Trigger edges (control flow) take the info role, data edges the success
   role, dashed; theme tokens only (AU-15). The `.edge-*` class out-specifies
   DmsFlowCanvas's generic `.vue-flow__edge-path` rule. */
.vue-flow__edge.edge-trigger .vue-flow__edge-path {
	stroke: var(--ui-info);
	stroke-width: 2;
}

.vue-flow__edge.edge-data .vue-flow__edge-path {
	stroke: var(--ui-success);
	stroke-width: 2;
	stroke-dasharray: 4 4;
}

.vue-flow__edge.edge-trigger.edge-taken .vue-flow__edge-path {
	stroke: var(--ui-success);
	stroke-width: 2.5;
}

.vue-flow__edge.edge-trigger.edge-failed .vue-flow__edge-path {
	stroke: var(--ui-error);
	stroke-width: 2.5;
}

.vue-flow__edge.edge-trigger.edge-idle .vue-flow__edge-path {
	opacity: 0.35;
}

/* Selected / focused edge highlight. The doubled `.edge-*` class lifts
   specificity above DmsFlowCanvas's own selected rule, which would repaint the
   edge in the accent and erase the trigger-vs-data distinction. */
.vue-flow__edge.edge-trigger.selected .vue-flow__edge-path,
.vue-flow__edge.edge-data.selected .vue-flow__edge-path,
.vue-flow__edge.edge-trigger:focus .vue-flow__edge-path,
.vue-flow__edge.edge-data:focus .vue-flow__edge-path,
.vue-flow__edge.edge-trigger:focus-visible .vue-flow__edge-path,
.vue-flow__edge.edge-data:focus-visible .vue-flow__edge-path {
	stroke: var(--ui-warning);
	stroke-width: 3;
}
</style>
