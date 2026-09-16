<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import { newId } from '../../utils/automation'
// The canvas chrome (dotted DMS background, zoom controls, themed
// node/handle/edge styling, pan/zoom + fit-view) now comes from the shared
// DmsFlowCanvas wrapper (dms ≥0.0.25). We only keep the @vue-flow/core bits
// our business renderers need: `Position` for node source/target anchors and
// the connection / change / edge types for our wiring handlers. The imperative
// flow controller (zoom/fit/updateNodeInternals/viewport) is reached through
// DmsFlowCanvas's exposed store via a template ref (see `flowRef`).
import { Position } from '@vue-flow/core'
import type {
	Connection,
	NodeChange,
	EdgeChange,
	Edge as VfEdge,
} from '@vue-flow/core'
// Most node kinds share a single port-spec-driven renderer. Group and the
// two group sentinels stay custom because they have cross-graph port
// declarations and special handle naming.
import GenericNode from './nodes/GenericNode.vue'
import GroupNode from './nodes/GroupNode.vue'
import GroupInputNode from './nodes/GroupInputNode.vue'
import GroupOutputNode from './nodes/GroupOutputNode.vue'
import {
	canConnect,
	connectionKind,
	parseSourceBranch,
	parseTargetBranch,
	parseDataPort,
	parseDataField,
} from '../../composables/useGraphConnect'
import type {
	ProcedureGraph,
	GraphNode as AppGraphNode,
	TriggerEdge,
	DataEdge,
	NodeKind,
	TriggerType,
	ActionType,
	DataNodeType,
	JsonSchema,
	GroupPort,
} from '../../composables/useGraphConnect'
import type {
	NodeKindEntry,
	NodeKindUI,
} from '../../composables/useAutomationNodeKinds'

// Minimal shape of a workspace template surfaced in the palette. Mirrors the
// `TemplateRow` interface in Templates.vue but only the fields the palette
// actually needs (id, name, icon, ports). `ports` is deep-cloned (JSON
// round-trip) onto each new template-instance group node so future template
// edits don't retroactively mutate the instance's port list (the resolved
// subgraph still updates live — that's the live-link model).
interface TemplateSummary {
	_id: string
	name: string
	icon?: string
	ports: GroupPort[]
}

const props = defineProps<{
	graph: ProcedureGraph
	triggerTypes: TriggerType[]
	actionTypes: ActionType[]
	dataNodeTypes: DataNodeType[]
	/**
	 * Per-NodeKind metadata served by `/api/automation/node-kinds`. The
	 * `ui` block on each entry tells `dataFor` how to render the node —
	 * label, icon, port lists, type-registry / dynamic-config hooks. The
	 * frontend has zero kind-specific code beyond group + sentinels.
	 */
	nodeKinds: NodeKindEntry[]
	canUndo?: boolean
	canRedo?: boolean
	isDirty?: boolean
	applying?: boolean
	// When the canvas is showing a group's inner subgraph, these are the
	// parent group's declared ports — the sentinel nodes (groupInput /
	// groupOutput) render handles derived from this list rather than
	// reading from their own node data. (Sentinel nodes themselves don't
	// carry ports; their parent group does.) Undefined at the procedure
	// root.
	parentGroupPorts?: GroupPort[]
	// When true, the canvas suppresses graph mutations from user input —
	// used for the read-only view of template-instance inner subgraphs.
	// User can still pan / zoom / select / inspect, just not connect,
	// move, delete, or edit. The "Apply / Cancel" buttons are hidden too.
	readOnly?: boolean
}>()

const emit = defineEmits<{
	(e: 'update:graph', g: ProcedureGraph): void
	(e: 'select:node', id: string | null): void
	// Fires whenever the selection set changes (single or multi). `ids` is
	// the full set of currently selected node ids in this canvas — used by
	// Editor.vue to drive the "Group selection" toolbar action. Sentinel
	// nodes (groupInput / groupOutput) are filtered out before emitting.
	(e: 'selection-change', payload: { ids: string[] }): void
	(e: 'undo'): void
	(e: 'redo'): void
	(e: 'cancel'): void
	(e: 'apply'): void
	// Bubbles up GroupNode's @dblclick — Editor.vue uses this to push the
	// group onto the subgraph navigation path. Filtered by kind here so
	// the parent doesn't need to look the node up itself.
	(e: 'group:enter', payload: { id: string }): void
}>()

const toast = useToast()

const nodeTypes = markRaw({
	genericNode: GenericNode,
	group: GroupNode,
	groupInput: GroupInputNode,
	groupOutput: GroupOutputNode,
})

// Sentinel node kinds — only valid inside a group's subgraph and never
// user-deletable. We filter them out of keyboard/right-click delete in
// onNodesChange below.
const SENTINEL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
	'groupInput',
	'groupOutput',
])

function vfTypeFor(kind: NodeKind): string {
	if (kind === 'group') return 'group'
	if (kind === 'groupInput') return 'groupInput'
	if (kind === 'groupOutput') return 'groupOutput'
	return 'genericNode'
}

function propsOf(schema: JsonSchema | undefined) {
	if (!schema?.properties) return []
	return Object.entries(schema.properties).map(([name, p]) => ({
		name,
		type: Array.isArray(p?.type) ? p?.type[0] : p?.type,
	}))
}

// Index node-kind metadata by kind for O(1) lookup.
const nodeKindUiByKind = computed<Map<string, NodeKindUI>>(() => {
	const m = new Map<string, NodeKindUI>()
	for (const entry of props.nodeKinds ?? []) {
		if (entry.meta?.ui) m.set(entry.kind, entry.meta.ui)
	}
	return m
})

// Pull a registered TriggerType / ActionType / DataNodeType from the
// type-registry prop indicated by a NodeKindUI.typeRegistry hint.
function lookupTypeBySpec(spec: NodeKindUI, typeId: string | undefined) {
	if (!spec.typeRegistry || !typeId) return null
	if (spec.typeRegistry === 'triggers')
		return props.triggerTypes.find((t) => t.id === typeId) ?? null
	if (spec.typeRegistry === 'actions')
		return props.actionTypes.find((a) => a.id === typeId) ?? null
	if (spec.typeRegistry === 'dataNodes')
		return props.dataNodeTypes.find((d) => d.id === typeId) ?? null
	return null
}

// Build the GenericNode `data` payload from a graph node. For every kind
// with `ui` metadata (every kind except group + sentinels), one
// data-driven resolver applies: combine `spec` from the backend with the
// node's `typeId` (for type-registered kinds) and `config` (for dynamic
// trigger-out ports).
function dataFor(node: AppGraphNode) {
	const spec = nodeKindUiByKind.value.get(node.kind)
	if (spec) {
		let label = spec.label
		let icon = spec.icon
		let category: string | undefined
		let dataIns = [...spec.staticDataIns]
		let dataOuts = [...spec.staticDataOuts]

		const type = lookupTypeBySpec(spec, node.typeId) as
			| {
					name?: string
					icon?: string
					category?: string
					inputSchema?: JsonSchema
					outputSchema?: JsonSchema
					configSchema?: JsonSchema
			  }
			| null
		if (type) {
			if (spec.labelFromType) label = type.name ?? label
			if (spec.iconFromType) icon = type.icon ?? icon
			if (spec.categoryFromType) category = type.category
			if (spec.dataInsFromTypeSchema)
				dataIns = propsOf(type[spec.dataInsFromTypeSchema])
			if (spec.dataOutsFromTypeSchema)
				dataOuts = propsOf(type[spec.dataOutsFromTypeSchema])
		}

		const dynPorts = spec.dynamicTriggerOutsFromConfig
			? ((node.config?.[spec.dynamicTriggerOutsFromConfig] as
					| string[]
					| undefined) ?? [])
			: []
		const triggerOuts = [...dynPorts, ...spec.staticTriggerOuts]

		return {
			label,
			icon,
			category,
			typeId: node.typeId,
			config: node.config,
			hasTriggerIn: spec.hasTriggerIn,
			hasMainTriggerOut: spec.hasMainTriggerOut,
			triggerOuts,
			dataIns,
			dataOuts,
		}
	}

	if (node.kind === 'group') {
		// Group node carries its own port list + (optional) inline subgraph
		// or templateId. The fields live on the node itself (per backend
		// GroupNode interface) — surface them so the renderer can display
		// handles, linked badges, etc.
		const g = node as AppGraphNode & {
			ports?: unknown
			templateId?: string
			subgraph?: unknown
		}
		return {
			label: node.config?.name ?? 'Group',
			ports: Array.isArray(g.ports) ? g.ports : [],
			templateId: g.templateId,
			subgraph: g.subgraph,
			config: node.config,
		}
	}
	if (node.kind === 'groupInput' || node.kind === 'groupOutput') {
		// Sentinels render the parent group's ports. In subgraph-editor
		// mode (C5.3) Editor.vue passes `parentGroupPorts` so both
		// sentinels share one source of truth — the outer group node.
		// At the procedure-graph root there's no parent group, so we
		// fall back to whatever ports the sentinel carries (which
		// should normally be none — a stray sentinel renders empty).
		if (Array.isArray(props.parentGroupPorts)) {
			return { ports: props.parentGroupPorts }
		}
		const s = node as AppGraphNode & { ports?: unknown }
		return { ports: Array.isArray(s.ports) ? s.ports : [] }
	}
	return {}
}

const vfNodes = computed(() =>
	props.graph.nodes.map((n) => ({
		id: n.id,
		type: vfTypeFor(n.kind),
		position: n.position,
		data: dataFor(n),
		sourcePosition: Position.Bottom,
		targetPosition: Position.Top,
	})),
)

// Look up the kind of an edge endpoint by node id — needed for the group
// handle-id derivation below. Sentinels and groups have richer handle
// naming than regular nodes (`group-trigger-in-<port>` vs `trigger-in`),
// so the edge mapping needs to know which target/source it's wiring to.
const nodeKindById = computed<Map<string, NodeKind>>(() => {
	const m = new Map<string, NodeKind>()
	for (const n of props.graph.nodes) m.set(n.id, n.kind)
	return m
})

// Trigger edges into a group node or groupOutput sentinel target a specific
// trigger-in port — the port name lives on `e.to.branch`. Ordinary target
// nodes have a single fixed `trigger-in` handle.
function triggerTargetHandle(e: TriggerEdge, targetKind: NodeKind | undefined): string {
	if (targetKind === 'group') {
		return `group-trigger-in-${e.to.branch}`
	}
	if (targetKind === 'groupOutput') {
		// Trigger edge from an inner node into the groupOutput sentinel —
		// the sentinel exposes a `groupOutput-trigger-in-<port>` handle per
		// declared trigger-OUT port (since trigger-OUT on the OUTER group is
		// trigger-IN on the sentinel side).
		return `groupOutput-trigger-in-${e.to.branch}`
	}
	return 'trigger-in'
}

function triggerSourceHandle(e: TriggerEdge, sourceKind: NodeKind | undefined): string {
	if (sourceKind === 'group') {
		// Source is the OUTER group node firing into an outer downstream
		// node — the branch name IS the port name (see planNewGroup's
		// outerTriggerEdges where `from.branch = portName`).
		return `group-trigger-out-${e.from.branch ?? 'main'}`
	}
	if (sourceKind === 'groupInput') {
		// Inner edge out of groupInput into an inner node — handle id is
		// `groupInput-trigger-out-<port>` and the port name lives on
		// `from.branch` (per planNewGroup's innerTriggerEdges).
		return `groupInput-trigger-out-${e.from.branch ?? 'main'}`
	}
	return `trigger-out-${e.from.branch ?? 'main'}`
}

function dataSourceHandle(e: DataEdge, sourceKind: NodeKind | undefined): string {
	if (sourceKind === 'group') return `group-data-out-${e.from.port}`
	if (sourceKind === 'groupInput') return `groupInput-data-out-${e.from.port}`
	return `data-out-${e.from.port}`
}

function dataTargetHandle(e: DataEdge, targetKind: NodeKind | undefined): string {
	if (targetKind === 'group') return `group-data-in-${e.to.field}`
	if (targetKind === 'groupOutput') return `groupOutput-data-in-${e.to.field}`
	return `data-in-${e.to.field}`
}

// Edge styling lives in <style> (.edge-trigger / .edge-data) so the
// `.selected` highlight can win without `!important`. Inline `style`
// on a vue-flow edge defeats the .selected rule — documented gotcha.
const vfEdges = computed(() => {
	const kinds = nodeKindById.value
	const triggerEdges = props.graph.triggerEdges.map((e) => ({
		id: e.id,
		source: e.from.node,
		target: e.to.node,
		sourceHandle: triggerSourceHandle(e, kinds.get(e.from.node)),
		targetHandle: triggerTargetHandle(e, kinds.get(e.to.node)),
		data: { kind: 'trigger' as const },
		class: 'edge-trigger',
	}))
	const dataEdges = props.graph.dataEdges.map((e) => ({
		id: e.id,
		source: e.from.node,
		target: e.to.node,
		sourceHandle: dataSourceHandle(e, kinds.get(e.from.node)),
		targetHandle: dataTargetHandle(e, kinds.get(e.to.node)),
		data: { kind: 'data' as const },
		class: 'edge-data',
	}))
	return [...triggerEdges, ...dataEdges]
})


function emitGraph(g: ProcedureGraph) {
	emit('update:graph', g)
}

function defaultPos() {
	// Stagger new nodes a bit so they don't all stack.
	const n = props.graph.nodes.length
	return { x: 120 + (n % 5) * 40, y: 120 + n * 40 }
}

function defaultsFromSchema(schema: JsonSchema | undefined): Record<string, unknown> {
	if (!schema?.properties) return {}
	const out: Record<string, unknown> = {}
	for (const [name, prop] of Object.entries(schema.properties)) {
		if (prop && prop.default !== undefined) out[name] = prop.default
	}
	return out
}

function defaultConfigFor(kind: NodeKind, typeId?: string): Record<string, unknown> {
	const ui = nodeKindUiByKind.value.get(kind)
	if (ui?.typeRegistry === 'triggers') {
		const t = props.triggerTypes.find((tt) => tt.id === typeId)
		return defaultsFromSchema(t?.configSchema)
	}
	if (ui?.typeRegistry === 'actions') {
		const a = props.actionTypes.find((aa) => aa.id === typeId)
		return defaultsFromSchema(a?.inputSchema)
	}
	if (ui?.typeRegistry === 'dataNodes') {
		const d = props.dataNodeTypes.find((dd) => dd.id === typeId)
		// Constant nodes seed from `configSchema` (their value lives there);
		// wired-port data nodes seed any `inputSchema` field defaults.
		return { ...defaultsFromSchema(d?.inputSchema), ...defaultsFromSchema(d?.configSchema) }
	}
	// Static-config kinds carry their seed config in metadata; deep-clone
	// so each instance gets its own mutable copy. JSON round-trip strips
	// the Vue reactive proxy that wraps `props.nodeKinds` — structuredClone
	// would throw on the proxy.
	return ui?.defaultConfig
		? (JSON.parse(JSON.stringify(ui.defaultConfig)) as Record<string, unknown>)
		: {}
}

function addNode(kind: NodeKind, typeId?: string) {
	const node: AppGraphNode = {
		id: newId(),
		kind,
		typeId,
		config: defaultConfigFor(kind, typeId),
		position: defaultPos(),
	}
	emitGraph({
		...props.graph,
		nodes: [...props.graph.nodes, node],
	})
}

// Drop a template-instance group node into the current graph. The instance
// carries `templateId` and a deep clone (JSON round-trip) of the template's
// port list;
// it has NO inline `subgraph` — the executor resolves the live subgraph
// from the template cache at run time (C3.2 / C4.4). Editing the source
// template later will retroactively change what this instance executes
// (the "live link" model); the port list is cloned so a port rename on
// the template doesn't silently invalidate the outer wiring on this
// instance (the user can manually re-sync by forking + re-saving).
function addTemplateInstance(template: TemplateSummary) {
	const node: AppGraphNode & {
		ports: GroupPort[]
		templateId: string
	} = {
		id: newId(),
		kind: 'group',
		config: { name: template.name },
		position: defaultPos(),
		templateId: template._id,
		// JSON round-trip strips Vue's reactive proxy that wraps the template
		// passed from the palette; structuredClone throws on proxies.
		ports: JSON.parse(JSON.stringify(template.ports ?? [])) as GroupPort[],
	}
	emitGraph({
		...props.graph,
		nodes: [...props.graph.nodes, node],
	})
}

// Node creation is driven from the left BuilderPalette (in Editor.vue) — expose
// the two add helpers so the palette's events can reach the graph mutation.
defineExpose({ addNode, addTemplateInstance })

// DmsFlowCanvas owns the VueFlow store (it calls `useVueFlow(flowId)` with a
// private id and `defineExpose`s the resulting controller). We grab that
// controller through a template ref instead of calling `useVueFlow()` here —
// a bare `useVueFlow()` would resolve to the DEFAULT store, which is NOT the
// one DmsFlowCanvas drives, so zoom/fit/updateNodeInternals would silently
// no-op. Only the handful of imperative methods we actually use are typed.
interface FlowController {
	zoomIn: () => void
	zoomOut: () => void
	fitView: () => void
	zoomTo: (zoom: number) => void
	updateNodeInternals: (ids?: string | string[]) => void
	// DmsFlowCanvas `defineExpose`s the VueFlow controller; Vue's expose proxy
	// unwraps the `viewport` ref, so consumers read `.viewport.zoom` directly
	// (NOT `.viewport.value.zoom` — that extra `.value` is undefined and pinned
	// the zoom readout at 100%).
	viewport: { zoom: number }
}
const flowRef = ref<FlowController | null>(null)

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
			const ports = (n as AppGraphNode & { ports?: unknown }).ports
			const portsKey = Array.isArray(ports) ? JSON.stringify(ports) : ''
			return `${n.id}:${n.kind}:${portsKey}`
		})
		.join('|')
	// Sentinel nodes (groupInput / groupOutput) inside this canvas render
	// handles derived from `parentGroupPorts`, not from their own node data.
	// A rename on the outer group's port list re-renders the sentinel but
	// doesn't show up in `props.graph.nodes` above, so we must also fold
	// the parent ports into the signature.
	const parent = Array.isArray(props.parentGroupPorts)
		? JSON.stringify(props.parentGroupPorts)
		: ''
	return `${own}#${parent}`
})
watch(portsSignature, () => {
	nextTick(() => {
		for (const node of props.graph.nodes) {
			flowRef.value?.updateNodeInternals(node.id)
		}
	})
})

const zoomPercent = computed(() => {
	const zoom = flowRef.value?.viewport.zoom ?? 1
	return `${Math.round(zoom * 100)}%`
})

function resetZoom() {
	flowRef.value?.zoomTo(1)
}

function onConnect(conn: Connection) {
	if (props.readOnly) return
	const kind = connectionKind(conn.sourceHandle)
	const result = canConnect(
		props.graph,
		props.nodeKinds,
		props.triggerTypes,
		props.actionTypes,
		props.dataNodeTypes,
		conn,
		{ parentGroupPorts: props.parentGroupPorts },
	)
	if (!result.ok) {
		toast.add({
			title: 'Cannot connect',
			description: result.reason,
			color: 'warning',
			icon: 'i-ph-warning',
		})
		return
	}
	if (kind === 'trigger') {
		const branch = parseSourceBranch(conn.sourceHandle)
		const toBranch = parseTargetBranch(conn.targetHandle)
		const newEdge: TriggerEdge = {
			id: newId(),
			from: { node: conn.source, branch },
			to: toBranch !== undefined
				? { node: conn.target, branch: toBranch }
				: { node: conn.target },
		}
		// Each source/branch carries exactly one outgoing trigger edge.
		// Connecting again replaces any existing edge from that source/branch.
		// (Branching across if/switch named branches still works because each
		// branch has its own `from.branch` and only conflicts with itself.)
		const remaining = props.graph.triggerEdges.filter(
			(e) =>
				!(
					e.from.node === conn.source &&
					(e.from.branch ?? 'main') === branch
				),
		)
		emitGraph({
			...props.graph,
			triggerEdges: [...remaining, newEdge],
		})
	} else if (kind === 'data') {
		const port = parseDataPort(conn.sourceHandle)
		const field = parseDataField(conn.targetHandle)
		if (!port || !field) return
		const newEdge: DataEdge = {
			id: newId(),
			from: { node: conn.source, port },
			to: { node: conn.target, field },
		}
		// Overwrite: if the target field is already wired, drop the existing
		// data edge before adding the new one.
		const remaining = props.graph.dataEdges.filter(
			(e) => !(e.to.node === conn.target && e.to.field === field),
		)
		emitGraph({
			...props.graph,
			dataEdges: [...remaining, newEdge],
		})
	}
}

function isValidConnection(conn: Connection): boolean {
	return canConnect(
		props.graph,
		props.nodeKinds,
		props.triggerTypes,
		props.actionTypes,
		props.dataNodeTypes,
		conn,
		{ parentGroupPorts: props.parentGroupPorts },
	).ok
}

// Multi-selection tracking — Vue Flow emits one NodeSelectionChange per
// affected node when the user box-selects or shift-clicks. We accumulate
// the current set here and emit a single `selection-change` event with
// the full list (sentinels filtered out — the user shouldn't be able to
// fold a sentinel into a new group). The single-node `select:node` event
// is preserved for the inspector (it expects exactly one node id).
const selectedNodeIds = new Set<string>()

// Drop any tracked ids that no longer exist in the current graph (e.g.
// after navigating to a different procedure / subgraph, or after the
// "Group selection" action removes the selected nodes). Re-emit if the
// set shrank. We can't `watch(() => props.graph, ...)` because that
// fires on every node drag (each emitGraph returns a fresh object).
watch(
	() => props.graph.nodes,
	(nodes) => {
		if (selectedNodeIds.size === 0) return
		const valid = new Set(nodes.map((n) => n.id))
		let pruned = false
		for (const id of [...selectedNodeIds]) {
			if (!valid.has(id)) {
				selectedNodeIds.delete(id)
				pruned = true
			}
		}
		if (pruned) {
			const ids = [...selectedNodeIds].filter((id) => {
				const n = nodes.find((nn) => nn.id === id)
				return n ? !SENTINEL_KINDS.has(n.kind) : false
			})
			emit('selection-change', { ids })
		}
	},
)

function onNodesChange(changes: NodeChange[]) {
	let nextNodes = props.graph.nodes
	let nextTrigger = props.graph.triggerEdges
	let nextData = props.graph.dataEdges
	let changed = false
	let selectionChanged = false

	for (const c of changes) {
		// In read-only mode, still surface selection so the inspector
		// can show node details; suppress position drag and delete.
		if (props.readOnly && c.type !== 'select') continue
		if (c.type === 'position' && c.position) {
			const pos = c.position
			nextNodes = nextNodes.map((n) =>
				n.id === c.id ? { ...n, position: { x: pos.x, y: pos.y } } : n,
			)
			changed = true
		} else if (c.type === 'remove') {
			// Sentinel nodes (groupInput / groupOutput) are auto-managed by
			// the editor and never user-deletable. Drop the change silently
			// so keyboard delete + right-click delete both no-op on them.
			const victim = nextNodes.find((n) => n.id === c.id)
			if (victim && SENTINEL_KINDS.has(victim.kind)) continue
			nextNodes = nextNodes.filter((n) => n.id !== c.id)
			nextTrigger = nextTrigger.filter(
				(e) => e.from.node !== c.id && e.to.node !== c.id,
			)
			nextData = nextData.filter(
				(e) => e.from.node !== c.id && e.to.node !== c.id,
			)
			if (selectedNodeIds.delete(c.id)) selectionChanged = true
			changed = true
		} else if (c.type === 'select') {
			if (c.selected) {
				if (!selectedNodeIds.has(c.id)) {
					selectedNodeIds.add(c.id)
					selectionChanged = true
				}
				emit('select:node', c.id)
			} else {
				if (selectedNodeIds.delete(c.id)) selectionChanged = true
				// Re-point the single-node inspector on deselect: fall back to a
				// still-selected node (most-recent), or clear it once the
				// selection is empty. A click-swap fires `select: true` above in
				// the same batch, which then overrides this.
				const remaining = [...selectedNodeIds]
				emit('select:node', remaining[remaining.length - 1] ?? null)
			}
		}
	}

	if (selectionChanged) {
		// Filter out sentinels — folding them into a new group makes no
		// sense and the toolbar gating depends on a clean set.
		const ids = [...selectedNodeIds].filter((id) => {
			const n = props.graph.nodes.find((nn) => nn.id === id)
			return n ? !SENTINEL_KINDS.has(n.kind) : false
		})
		emit('selection-change', { ids })
	}

	if (changed) {
		emitGraph({
			...props.graph,
			nodes: nextNodes,
			triggerEdges: nextTrigger,
			dataEdges: nextData,
		})
	}
}

// DmsFlowCanvas's delete affordance (trash badge on the selected node + the
// Delete/Backspace key path it now owns) is emit-only: it hands us the ids and
// we perform the mutation. Route them through onNodesChange's `remove` path so
// sentinel filtering, edge cleanup, selection sync and emitGraph stay in one
// place.
function onDeleteNodes(ids: string[]) {
	if (props.readOnly) return
	onNodesChange(ids.map((id) => ({ type: 'remove', id }) as NodeChange))
}

function onEdgesChange(changes: EdgeChange[]) {
	if (props.readOnly) return
	let nextTrigger = props.graph.triggerEdges
	let nextData = props.graph.dataEdges
	let changed = false

	for (const c of changes) {
		if (c.type === 'remove') {
			const beforeT = nextTrigger.length
			nextTrigger = nextTrigger.filter((e) => e.id !== c.id)
			if (nextTrigger.length !== beforeT) {
				changed = true
				continue
			}
			const beforeD = nextData.length
			nextData = nextData.filter((e) => e.id !== c.id)
			if (nextData.length !== beforeD) changed = true
		}
	}

	if (changed) {
		emitGraph({
			...props.graph,
			triggerEdges: nextTrigger,
			dataEdges: nextData,
		})
	}
}

// Edge-update flow (drag an existing edge's endpoint to reattach or delete):
//   1. @edge-update-start clears the success flag.
//   2. @edge-update fires only if the user drops on a valid target — mark
//      successful and rewrite the edge with the new connection.
//   3. @edge-update-end fires unconditionally; if no successful update
//      happened, the user dropped in empty space → delete the edge.
let edgeUpdateSuccessful = false

function onEdgeUpdateStart() {
	edgeUpdateSuccessful = false
}

function onEdgeUpdate(payload: {
	event: MouseEvent
	edge: VfEdge
	connection: Connection
}) {
	edgeUpdateSuccessful = true
	const { edge, connection } = payload
	const kind = (edge.data as { kind?: 'trigger' | 'data' } | undefined)?.kind
	if (kind === 'trigger') {
		const branch = parseSourceBranch(connection.sourceHandle)
		const toBranch = parseTargetBranch(connection.targetHandle)
		const nextTrigger = props.graph.triggerEdges.map((e) =>
			e.id === edge.id
				? {
						...e,
						from: { node: connection.source, branch },
						to: toBranch !== undefined
							? { node: connection.target, branch: toBranch }
							: { node: connection.target },
					}
				: e,
		)
		emitGraph({ ...props.graph, triggerEdges: nextTrigger })
	} else if (kind === 'data') {
		const port = parseDataPort(connection.sourceHandle)
		const field = parseDataField(connection.targetHandle)
		if (!port || !field) return
		const nextData = props.graph.dataEdges.map((e) =>
			e.id === edge.id
				? {
						...e,
						from: { node: connection.source, port },
						to: { node: connection.target, field },
					}
				: e,
		)
		emitGraph({ ...props.graph, dataEdges: nextData })
	}
}

// Vue Flow fires @node-double-click with a single `{ event, node }` payload.
// Filter to group nodes so Editor.vue receives a clean group:enter signal —
// double-clicking any other node kind is reserved for future inline edit
// affordances.
function onNodeDoubleClick(payload: {
	event: MouseEvent
	node: { id: string; type?: string }
}) {
	if (payload.node?.type !== 'group') return
	emit('group:enter', { id: payload.node.id })
}

function onEdgeUpdateEnd(payload: { event: MouseEvent; edge: VfEdge }) {
	if (edgeUpdateSuccessful) return
	const { edge } = payload
	if (!edge) return
	const nextTrigger = props.graph.triggerEdges.filter((e) => e.id !== edge.id)
	const nextData = props.graph.dataEdges.filter((e) => e.id !== edge.id)
	if (
		nextTrigger.length === props.graph.triggerEdges.length &&
		nextData.length === props.graph.dataEdges.length
	) {
		return
	}
	emitGraph({
		...props.graph,
		triggerEdges: nextTrigger,
		dataEdges: nextData,
	})
}
</script>

<template>
	<div
		class="graph-canvas-wrap relative w-full h-full border border-default rounded-lg overflow-hidden"
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
			@connect="onConnect"
			@nodes-change="onNodesChange"
			@delete-nodes="onDeleteNodes"
			@edges-change="onEdgesChange"
			@edge-update-start="onEdgeUpdateStart"
			@edge-update="onEdgeUpdate"
			@edge-update-end="onEdgeUpdateEnd"
			@node-double-click="onNodeDoubleClick"
		>
			<!-- Toolbar. While editable: Add Node / Undo / Redo / group
			     actions / Cancel / Apply. Read-only template-instance view:
			     only the group actions (Fork) survive, in a bare card. The two
			     branches share DmsFlowCanvas's single `top-right` Panel slot. -->
			<template v-if="!readOnly || $slots.groupActions" #top-right>
				<div
					v-if="!readOnly"
					class="flex items-center gap-1 rounded-lg border border-default bg-elevated p-1 shadow-md flex-wrap"
				>
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						icon="i-ph-arrow-counter-clockwise"
						:aria-label="$t('dms_automation.editor.canvas.undo')"
						:disabled="!canUndo"
						@click="emit('undo')"
					/>
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						icon="i-ph-arrow-clockwise"
						:aria-label="$t('dms_automation.editor.canvas.redo')"
						:disabled="!canRedo"
						@click="emit('redo')"
					/>
					<!-- Group-related actions slotted in by Editor.vue: Group
					     selection, Save as template, Fork to local group, Enter
					     group. Kept inside the canvas toolbar so they sit next
					     to Add Node / Undo / Redo instead of in a separate card. -->
					<template v-if="$slots.groupActions">
						<div class="w-px h-5 bg-default mx-1" />
						<slot name="groupActions" />
					</template>
					<div class="mx-1 h-5 w-px bg-default" />
					<UButton
						size="sm"
						variant="ghost"
						color="neutral"
						:label="$t('dms_automation.editor.canvas.cancel')"
						:disabled="!isDirty || applying"
						@click="emit('cancel')"
					/>
					<UButton
						size="sm"
						color="primary"
						:label="$t('dms_automation.editor.canvas.apply')"
						:disabled="!isDirty"
						:loading="applying"
						@click="emit('apply')"
					/>
				</div>
				<!-- Read-only fallback: Fork stays reachable from the
				     template-instance inner-subgraph view. -->
				<div
					v-else-if="$slots.groupActions"
					class="flex items-center gap-1 rounded-lg border border-default bg-elevated p-1 shadow-md flex-wrap"
				>
					<slot name="groupActions" />
				</div>
			</template>

			<!-- The #top-left slot is provided UNCONDITIONALLY (inner v-if gates
			     the content). DmsFlowCanvas computes its active panel positions
			     once from a non-reactive useSlots() snapshot, so a panel slot
			     added later (e.g. when a node is first selected) would never
			     render. Providing it from first render keeps the inspector panel
			     alive; it just shows nothing until a node is selected. The real
			     fix belongs upstream in DmsFlowCanvas (make panel detection
			     reactive); this is a consumer workaround. -->
			<template #top-left>
				<div
					v-if="$slots.inspector"
					class="w-[320px] max-h-[calc(100vh-16rem)] overflow-y-auto shadow-md rounded-lg"
				>
					<slot name="inspector" />
				</div>
			</template>

			<template #bottom-center>
				<div
					class="flex items-center gap-1 rounded-lg border border-default bg-elevated p-1 shadow-md"
				>
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
						@click="flowRef?.fitView()"
					/>
				</div>
			</template>
		</DmsFlowCanvas>
	</div>
</template>

<style>
/* DmsFlowCanvas imports the @vue-flow core/theme/controls/minimap CSS itself,
   so we only ship the editor's business edge palette here: trigger edges
   (control flow) read cyan, data edges (data flow) read green-dashed. The
   `.edge-*` class out-specifies DmsFlowCanvas's generic `.vue-flow__edge-path`
   rule, so these win without `!important`. */
.vue-flow__edge.edge-trigger .vue-flow__edge-path {
	stroke: #2dc1cf;
	stroke-width: 2;
}

.vue-flow__edge.edge-data .vue-flow__edge-path {
	stroke: #10b981;
	stroke-width: 2;
	stroke-dasharray: 4 4;
}

/* Selected / focused edge highlight (amber). The doubled `.edge-*` class lifts
   specificity above DmsFlowCanvas's own `.dms-flow-canvas .vue-flow__edge.selected`
   rule, which would otherwise repaint the edge in the DMS accent and erase the
   trigger-vs-data distinction. */
.vue-flow__edge.edge-trigger.selected .vue-flow__edge-path,
.vue-flow__edge.edge-data.selected .vue-flow__edge-path,
.vue-flow__edge.edge-trigger:focus .vue-flow__edge-path,
.vue-flow__edge.edge-data:focus .vue-flow__edge-path,
.vue-flow__edge.edge-trigger:focus-visible .vue-flow__edge-path,
.vue-flow__edge.edge-data:focus-visible .vue-flow__edge-path {
	stroke: #f59e0b;
	stroke-width: 3;
}
</style>
