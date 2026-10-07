<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type RunDetail, type TraceStep, useAutomationRuns } from '../composables/useAutomationRuns'
import type { NodeRunState } from './Editor/nodes/GenericNode.vue'
import type { DockIssue, DockRun, DockTab } from './Editor/BottomDock.vue'
import type { ProcedureSummaryRow } from './Editor/ProcedureSwitcher.vue'
import { describeDuration, describeTime, describeTrigger, stepTitle, type TriggerSummary } from '../utils/describe'
import type { BreadcrumbItem } from '@nuxt/ui'
import type { NodeKindEntry } from '../composables/useAutomationNodeKinds'
import { type ListEnvelope, newId, unwrapList } from '../utils/automation'
import type { GroupPort } from '../composables/useGraphConnect'

// Editor mode.
//
// 'procedure' (default) — loads /api/automation/procedures,
//   manages the selected procedure list, saves via PUT /procedures/:id, exposes
//   the manual Run-now button.
// 'template'   — loads ONE template via GET /api/automation/templates/:id and
//   edits its `subgraph` directly. The template's `ports` are injected as the
//   root canvas's `parentGroupPorts` so the groupInput/groupOutput sentinels at
//   the root level render the template's outer-face handles. Save goes to
//   PUT /api/automation/templates/:id. Run, procedure list, and enabled toggle
//   are hidden.
//
// Mode is resolved from props first (so a host page can hard-wire it) and
// otherwise from the route query: `?template=<id>` switches into template mode.
// This keeps the route wiring trivial (the Templates catalog navigates
// to `/modules/automation/builder?template=<id>`) without needing a
// dedicated page.
const props = withDefaults(
	defineProps<{
		mode?: 'procedure' | 'template'
		entityId?: string
		apiUrl?: string
		runsUrl?: string
		traceUrl?: string
	}>(),
	{
		mode: undefined,
		entityId: undefined,
		apiUrl: '/api/automation',
		runsUrl: '/modules/automation/runs',
		traceUrl: '/modules/automation/trace',
	},
)

const route = useDmsRoute()
const router = useDmsRouter()
const { t, locale } = useI18n()
const { processI18n } = useTranslation()

/** The builder's own path, without the query its URL may carry. */
function builderPath(): string {
	return route.path.split('?')[0] ?? route.path
}

function queryValue(key: string): string | null {
	const q = route.query[key]
	if (typeof q === 'string' && q.length > 0) return q
	if (Array.isArray(q) && typeof q[0] === 'string' && q[0]!.length > 0) return q[0]!
	return null
}

const templateQueryId = computed<string | null>(() => {
	const q = route.query.template
	if (typeof q === 'string' && q.length > 0) return q
	if (Array.isArray(q) && typeof q[0] === 'string' && q[0]!.length > 0) return q[0]!
	return null
})

const editorMode = computed<'procedure' | 'template'>(() => {
	if (props.mode) return props.mode
	if (templateQueryId.value) return 'template'
	return 'procedure'
})

const editorTemplateId = computed<string | null>(() => {
	if (editorMode.value !== 'template') return null
	return props.entityId ?? templateQueryId.value
})

interface GraphNode {
	id: string
	// Node kind is a free-form string keyed off the backend kind registry
	// (`/api/automation/node-kinds`); the few kinds with bespoke Vue
	// components (group / groupInput / groupOutput) are compared as
	// literals where needed.
	kind: string
	typeId?: string
	config: Record<string, unknown>
	position: { x: number; y: number }
	// Group-only extras — present iff kind === 'group'.
	ports?: GroupPort[]
	templateId?: string
	subgraph?: ProcedureGraph
}

interface TriggerEdge {
	id: string
	from: { node: string; branch?: string }
	// `to.branch` carries the target's trigger-in port name when the target is
	// a group node or groupOutput sentinel — see src/types/graph.ts.
	to: { node: string; branch?: string }
}

interface DataEdge {
	id: string
	from: { node: string; port: string }
	to: { node: string; field: string }
}

interface ProcedureGraph {
	nodes: GraphNode[]
	triggerEdges: TriggerEdge[]
	dataEdges: DataEdge[]
}

interface ProcedureRecord {
	_id: string
	name: string
	description: string
	enabled: boolean
	graph: ProcedureGraph
}

interface ProcedureApiRecord {
	_id: string
	name: string
	description?: string
	enabled: boolean
	graph: string | ProcedureGraph
}

interface JsonSchemaProperty {
	type?: string
	[key: string]: unknown
}

interface JsonSchema {
	type?: string
	properties?: Record<string, JsonSchemaProperty>
	[key: string]: unknown
}

interface TriggerType {
	id: string
	name: string
	description?: string
	icon?: string
	configSchema?: JsonSchema
	outputSchema?: JsonSchema
}

interface ActionType {
	id: string
	name: string
	description?: string
	icon?: string
	inputSchema?: JsonSchema
	outputSchema?: JsonSchema
}

interface DataNodeType {
	id: string
	category: string
	name: string
	description: string
	icon: string
	inputSchema: JsonSchema
	outputSchema: JsonSchema
	// Kept in sync with the canonical DataNodeType (useGraphConnect.ts).
	configSchema?: JsonSchema
}

const { $authFetch } = useAuthFetch()
const toast = useToast()
// Composables are called before the first `await` of this setup: after it,
// the component instance they inject from is gone.
const { confirm } = useConfirm()
const runsApi = useAutomationRuns(props.apiUrl)
// Leaving the page with unsaved changes goes through the DMS leave guard.
const unsavedDraft = ref(false)
useUnsavedChanges({ dirty: unsavedDraft })

const procedures = ref<ProcedureRecord[]>([])
const selectedId = ref<string | null>(null)
const switcherOpen = ref(false)
const newProcedureOpen = ref(false)
const runNowOpen = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
const saving = ref(false)
const running = ref(false)

// Template-mode state. `templatePorts` holds the OUTER-face ports of the
// edited template — they're not part of the editable subgraph but they ARE
// the source of truth for the root-level groupInput/groupOutput sentinels'
// handle sets. We pipe them through `currentParentGroupPorts` so GraphCanvas
// renders them identically to how it renders a nested group's sentinels.
const templatePorts = ref<GroupPort[]>([])
// Kept as loaded: saving the template from the editor must not reset its icon.
const templateIcon = ref<string>('i-ph-package')
const templateLoadKey = ref<string | null>(null)

const triggerTypes = ref<TriggerType[]>([])
const actionTypes = ref<ActionType[]>([])
const dataNodeTypes = ref<DataNodeType[]>([])
// Per-NodeKind UI metadata served by the backend
// (`/api/automation/node-kinds`). Drives the editor's GenericNode renderer
// so the frontend doesn't need to know about specific kinds.
const nodeKinds = ref<NodeKindEntry[]>([])

// Workspace-global templates surfaced in the canvas's node palette.
// Fetched once on mount alongside the type catalogs. Empty list → palette
// section hidden (handled inside BuilderPalette).
//
// Only the fields the palette + template-instance creation need are kept on
// the client (id, name, icon, ports). The list endpoint still returns full
// rows (description, usageCount, hydrated subgraph); the `.map()` below
// simply discards the extra fields after the fetch.
interface TemplatePaletteRow {
	_id: string
	name: string
	icon?: string
	ports: GroupPort[]
}
interface TemplateListResponse {
	results?: TemplatePaletteRow[]
	items?: TemplatePaletteRow[]
}
const templates = ref<TemplatePaletteRow[]>([])
const templatesLoadError = ref<string | null>(null)

async function loadTemplates() {
	try {
		const data = await $authFetch<
			TemplatePaletteRow[] | TemplateListResponse
		>('/api/automation/templates')
		const list = unwrapList<TemplatePaletteRow>(data)
		templates.value = list.map((t) => ({
			_id: t._id,
			name: t.name,
			icon: t.icon,
			ports: Array.isArray(t.ports) ? t.ports : [],
		}))
		templatesLoadError.value = null
	} catch (e) {
		templatesLoadError.value = (e as Error).message ?? 'Failed to load templates'
		templates.value = []
	}
}

// Hide the palette section while editing a template (self-edit). The
// server's cycle check would still catch any reference cycle, but blocking
// it at the UI level keeps the UX cleaner — the user can't even attempt
// to drop a template (including the one currently open) into itself.
const palettesTemplates = computed<TemplatePaletteRow[] | undefined>(() =>
	editorMode.value === 'template' ? undefined : templates.value,
)

const selectedNodeId = ref<string | null>(null)
// Mirrors GraphCanvas's @selection-change — full set of currently selected
// node ids in the canvas, sentinel-filtered. Drives the "Group selection"
// toolbar button (see canGroupSelection / createGroupFromSelection).
const selectedNodeIds = ref<string[]>([])

function onSelectionChange(payload: { ids: string[] }) {
	selectedNodeIds.value = payload.ids
}

// Subgraph navigation stack. The first entry is always the procedure root;
// each subsequent entry is a group / template segment the user has entered.
// Cleared and re-seeded whenever the selected procedure changes (see the
// watch on selectedId below).
//
// kind === 'procedure' — id is the procedure _id, name is its display name.
// kind === 'group'     — id is the group node's id within its parent graph.
// kind === 'template'  — reserved for the dedicated template editor view.
//                        Navigation into local groups pushes as 'group';
//                        template instances likewise push as 'group' with
//                        the read-only signal taken from the node having a
//                        templateId, not from the path kind.
interface SubgraphPathSegment {
	kind: 'procedure' | 'group' | 'template'
	id: string
	name: string
}

const subgraphPath = ref<SubgraphPathSegment[]>([])

interface ProcedureSnapshot {
	name: string
	enabled: boolean
	graph: ProcedureGraph
}

const graphHistory = ref<ProcedureGraph[]>([])
const graphHistoryIndex = ref<number>(-1)
const savedSnapshot = ref<ProcedureSnapshot | null>(null)
const HISTORY_LIMIT = 100

function cloneGraph(g: ProcedureGraph): ProcedureGraph {
	return JSON.parse(JSON.stringify(g))
}

function takeSnapshot(p: ProcedureRecord): ProcedureSnapshot {
	return { name: p.name, enabled: p.enabled, graph: cloneGraph(p.graph) }
}

// Strip per-node position so pure drag-to-reposition doesn't add an undo
// step on every pixel. The drag's final position still gets saved by Apply
// and reverted by Cancel because savedSnapshot keeps the full graph.
function structuralKey(g: ProcedureGraph): string {
	return JSON.stringify({
		nodes: g.nodes.map(({ position: _pos, ...rest }) => rest),
		triggerEdges: g.triggerEdges,
		dataEdges: g.dataEdges,
	})
}

function pushHistory(g: ProcedureGraph) {
	const current = graphHistory.value[graphHistoryIndex.value]
	if (current && structuralKey(current) === structuralKey(g)) return
	graphHistory.value = graphHistory.value.slice(0, graphHistoryIndex.value + 1)
	graphHistory.value.push(cloneGraph(g))
	graphHistoryIndex.value = graphHistory.value.length - 1
	if (graphHistory.value.length > HISTORY_LIMIT) {
		graphHistory.value.shift()
		graphHistoryIndex.value--
	}
}

function initHistoryAndSaved() {
	if (selected.value) {
		graphHistory.value = [cloneGraph(selected.value.graph)]
		graphHistoryIndex.value = 0
		savedSnapshot.value = takeSnapshot(selected.value)
	} else {
		graphHistory.value = []
		graphHistoryIndex.value = -1
		savedSnapshot.value = null
	}
}

function emptyGraph(): ProcedureGraph {
	return {
		nodes: [
			{
				id: 'trigger-1',
				kind: 'trigger',
				typeId: 'manual',
				config: {},
				position: { x: 100, y: 100 },
			},
		],
		triggerEdges: [],
		dataEdges: [],
	}
}

function parseGraph(g: string | ProcedureGraph | undefined | null): ProcedureGraph {
	if (!g) return emptyGraph()
	if (typeof g === 'string') {
		try {
			const parsed = JSON.parse(g) as ProcedureGraph
			return parsed && Array.isArray(parsed.nodes) ? parsed : emptyGraph()
		} catch {
			return emptyGraph()
		}
	}
	return g
}

function normalize(r: ProcedureApiRecord): ProcedureRecord {
	return {
		_id: r._id,
		name: r.name,
		description: r.description ?? '',
		enabled: !!r.enabled,
		graph: parseGraph(r.graph),
	}
}

async function loadList() {
	loading.value = true
	loadError.value = null
	try {
		const data = await $authFetch<
			ProcedureApiRecord[] | ListEnvelope<ProcedureApiRecord>
		>('/api/automation/procedures?limit=100000')
		const list = unwrapList<ProcedureApiRecord>(data)
		procedures.value = list.map(normalize)
		if (
			selectedId.value &&
			!procedures.value.some((p) => p._id === selectedId.value)
		) {
			selectedId.value = null
		}
		const requested = queryValue('selected')
		if (requested && procedures.value.some((p) => p._id === requested)) {
			selectedId.value = requested
		}
		if (!selectedId.value && procedures.value.length > 0) {
			const first = procedures.value[0]
			selectedId.value = first ? first._id : null
		}
	} catch (e) {
		loadError.value = (e as Error).message ?? 'Failed to load procedures'
	} finally {
		loading.value = false
	}
}

async function loadTypeCatalogs() {
	try {
		triggerTypes.value = unwrapList<TriggerType>(
			await $authFetch<TriggerType[] | ListEnvelope<TriggerType>>(
				'/api/automation/trigger-types',
			),
		)
		actionTypes.value = unwrapList<ActionType>(
			await $authFetch<ActionType[] | ListEnvelope<ActionType>>(
				'/api/automation/action-types',
			),
		)
		dataNodeTypes.value = unwrapList<DataNodeType>(
			await $authFetch<DataNodeType[] | ListEnvelope<DataNodeType>>(
				'/api/automation/data-node-types',
			),
		)
		nodeKinds.value = await useAutomationNodeKinds().list()
	} catch {
		// Catalogs are optional for editing — silently ignore.
	}
}

interface AutomationTemplateApi {
	_id: string
	name: string
	description?: string
	icon?: string
	ports?: GroupPort[]
	subgraph?: string | ProcedureGraph
}

async function loadTemplate(id: string) {
	loading.value = true
	loadError.value = null
	try {
		const tpl = await $authFetch<AutomationTemplateApi>(
			`/api/automation/templates/${id}`,
		)
		const subgraph = parseGraph(tpl.subgraph)
		// Adapt the template into the ProcedureRecord shape so the rest of
		// the editor (history, dirty-tracking, sentinel sync, group toolbar)
		// keeps working unchanged. `enabled` is meaningless for templates;
		// pin it to true so the "disabled" warning banner never appears.
		const adapted: ProcedureRecord = {
			_id: tpl._id,
			name: tpl.name,
			description: tpl.description ?? '',
			enabled: true,
			graph: subgraph,
		}
		procedures.value = [adapted]
		selectedId.value = adapted._id
		templateIcon.value = tpl.icon || 'i-ph-package'
		templatePorts.value = Array.isArray(tpl.ports)
			? tpl.ports.map((p) => ({ ...p }))
			: []
		templateLoadKey.value = id
	} catch (e) {
		loadError.value = (e as Error).message ?? 'Failed to load template'
		procedures.value = []
		selectedId.value = null
		templatePorts.value = []
	} finally {
		loading.value = false
	}
}

if (editorMode.value === 'template') {
	const id = editorTemplateId.value
	if (id) {
		await loadTemplate(id)
	} else {
		loadError.value = 'No template id provided'
	}
} else {
	await loadList()
}
await loadTypeCatalogs()
await loadTemplates()

const selected = computed<ProcedureRecord | null>(
	() => procedures.value.find((p) => p._id === selectedId.value) ?? null,
)

// `watch(selectedId, …)` (declared below) doesn't fire for the value
// assigned during the awaits above, so seed history + savedSnapshot once
// for the auto-selected procedure. Must come after `selected` is declared
// — initHistoryAndSaved() reads selected.value.
initHistoryAndSaved()
seedSubgraphPath()

function seedSubgraphPath() {
	const p = selected.value
	if (!p) {
		subgraphPath.value = []
		return
	}
	// In template mode the root segment is the template itself (we reuse the
	// 'template' kind already declared on SubgraphPathSegment). The breadcrumb
	// renders it with the i-ph-link icon, which is exactly what we want for
	// "Templates ▸ <name>".
	if (editorMode.value === 'template') {
		subgraphPath.value = [
			{ kind: 'template', id: p._id, name: p.name || 'Template' },
		]
		return
	}
	subgraphPath.value = [
		{ kind: 'procedure', id: p._id, name: p.name || 'Procedure' },
	]
}

// Walk the procedure graph following subgraphPath. Returns the full chain
// of (segment, containerGraph, groupNode|null) so currentGraph and
// currentParentGroupPorts can be derived from one traversal without
// re-walking.
//
// If a path segment can't be resolved (e.g. the group node was deleted in
// the outer graph), traversal stops at the last valid level — the caller
// is expected to also watch the stale path and trim it (see the watch on
// `selected.graph`).
interface SubgraphFrame {
	segment: SubgraphPathSegment
	graph: ProcedureGraph
	// The group node that owns `graph` (i.e. graph === groupNode.subgraph).
	// Null for the procedure root.
	groupNode: GraphNode | null
}

const subgraphFrames = computed<SubgraphFrame[]>(() => {
	const p = selected.value
	if (!p) return []
	const path = subgraphPath.value
	if (path.length === 0) return []
	const frames: SubgraphFrame[] = [
		{ segment: path[0]!, graph: p.graph, groupNode: null },
	]
	for (let i = 1; i < path.length; i++) {
		const seg = path[i]!
		const parent = frames[i - 1]!
		const node = parent.graph.nodes.find(
			(n) => n.id === seg.id && n.kind === 'group',
		)
		if (!node) break
		// Local group → inline subgraph. Template instance → no inline
		// subgraph on the client, so we can't navigate in. The
		// double-click handler guards against pushing a template-instance
		// segment in the first place; this is a safety net.
		const sub = node.subgraph
		if (!sub) break
		frames.push({ segment: seg, graph: sub, groupNode: node })
	}
	return frames
})

const currentGraph = computed<ProcedureGraph | null>(() => {
	const frames = subgraphFrames.value
	if (frames.length === 0) return null
	return frames[frames.length - 1]!.graph
})

// The parent group node whose subgraph we're currently viewing — null at
// the procedure root.
const currentParentGroup = computed<GraphNode | null>(() => {
	const frames = subgraphFrames.value
	if (frames.length <= 1) return null
	return frames[frames.length - 1]!.groupNode
})

const currentParentGroupPorts = computed<GroupPort[] | undefined>(() => {
	const g = currentParentGroup.value
	if (g) return Array.isArray(g.ports) ? g.ports : []
	// Root level in template mode: the template's own `ports` are the
	// outer-face of the edited subgraph. Inject them so the root-level
	// groupInput / groupOutput sentinels render the right handles.
	if (editorMode.value === 'template') return templatePorts.value
	return undefined
})

// Read-only mode kicks in when viewing the inner subgraph of a template
// instance (a group node carrying `templateId`). The fork action lets
// the user promote it to a local group; until then we just show a
// banner and disable mutations.
const isCurrentGraphReadOnly = computed<boolean>(() => {
	const g = currentParentGroup.value
	if (!g) return false
	return Boolean(g.templateId)
})

const breadcrumbItems = computed<BreadcrumbItem[]>(() =>
	subgraphPath.value.map((seg, idx) => ({
		label: seg.name,
		icon:
			seg.kind === 'procedure'
				? 'i-ph-flow-arrow'
				: seg.kind === 'template'
					? 'i-ph-link'
					: 'i-ph-package',
		// onSelect fires for clicks; popping the path to `idx + 1` keeps
		// the clicked segment and discards everything deeper.
		onSelect: (ev: Event) => {
			ev.preventDefault()
			if (idx < subgraphPath.value.length - 1) {
				subgraphPath.value = subgraphPath.value.slice(0, idx + 1)
				// Clear node selection — the old selected node id may not
				// exist in the new current graph.
				selectedNodeId.value = null
			}
		},
	})),
)

// If the user deletes a group node from an outer graph while their path
// points into its subgraph, prune the path back to the deepest valid
// frame. Cheap because subgraphFrames already does the traversal.
watch(
	() => subgraphFrames.value.length,
	(framesLen) => {
		if (framesLen > 0 && framesLen < subgraphPath.value.length) {
			subgraphPath.value = subgraphPath.value.slice(0, framesLen)
			selectedNodeId.value = null
		}
	},
)

// Keep the procedure-root breadcrumb label in sync with renames.
watch(
	() => selected.value?.name,
	(name) => {
		const first = subgraphPath.value[0]
		if (first && first.kind === 'procedure' && name) first.name = name
	},
)

function exitSubgraph() {
	subgraphPath.value = subgraphPath.value.slice(0, -1)
	selectedNodeId.value = null
}

function onGraphUpdate(g: ProcedureGraph) {
	if (!selected.value) return
	const path = subgraphPath.value
	if (path.length <= 1) {
		// At procedure root — write straight through, same as before
		// subgraph navigation existed.
		selected.value.graph = g
		pushHistory(g)
		return
	}
	// At a deeper level — `g` is the subgraph of the deepest group node.
	// Walk the path from the outer procedure graph down, cloning the
	// chain so Vue's reactivity sees a fresh top-level graph (history
	// keys structuralKey() off node identity at every level).
	const rootGraph = cloneGraph(selected.value.graph)
	let containerNodes = rootGraph.nodes
	for (let i = 1; i < path.length; i++) {
		const seg = path[i]!
		const idx = containerNodes.findIndex(
			(n) => n.id === seg.id && n.kind === 'group',
		)
		if (idx === -1) {
			// Path was stale — bail out without mutating; the watch on
			// subgraphFrames.length will prune the path.
			return
		}
		// Replace the node at idx with a shallow clone so we can mutate
		// its `subgraph` without aliasing back into the original (the
		// outer graph already came from cloneGraph above, so its node
		// objects are fresh too — but the inner subgraph reference
		// chain needs explicit substitution).
		const cloned: GraphNode = { ...containerNodes[idx]! }
		containerNodes[idx] = cloned
		if (i === path.length - 1) {
			cloned.subgraph = g
		} else {
			// Mid-chain — keep walking, ensuring each intermediate
			// subgraph is also a fresh object for the next iteration's
			// nodes array.
			if (!cloned.subgraph) return
			cloned.subgraph = {
				...cloned.subgraph,
				nodes: [...cloned.subgraph.nodes],
			}
			containerNodes = cloned.subgraph.nodes
		}
	}
	selected.value.graph = rootGraph
	pushHistory(rootGraph)
}

const canUndo = computed<boolean>(
	() => graphHistoryIndex.value > 0,
)
const canRedo = computed<boolean>(
	() => graphHistoryIndex.value < graphHistory.value.length - 1,
)
const isDirty = computed<boolean>(() => {
	if (!selected.value || !savedSnapshot.value) return false
	return (
		JSON.stringify(takeSnapshot(selected.value)) !==
		JSON.stringify(savedSnapshot.value)
	)
})

function onUndo() {
	if (!canUndo.value || !selected.value) return
	graphHistoryIndex.value--
	const g = graphHistory.value[graphHistoryIndex.value]
	if (g) selected.value.graph = cloneGraph(g)
}

function onRedo() {
	if (!canRedo.value || !selected.value) return
	graphHistoryIndex.value++
	const g = graphHistory.value[graphHistoryIndex.value]
	if (g) selected.value.graph = cloneGraph(g)
}

function onCancel() {
	if (!selected.value || !savedSnapshot.value) return
	const snap = savedSnapshot.value
	selected.value.name = snap.name
	selected.value.enabled = snap.enabled
	selected.value.graph = cloneGraph(snap.graph)
	pushHistory(selected.value.graph)
}

const selectedNode = computed<GraphNode | null>(() => {
	const id = selectedNodeId.value
	if (!id) return null
	// Lookup is scoped to whichever graph the canvas is currently
	// bound to, not always the procedure root — otherwise selecting a
	// node inside a subgraph would resolve to null.
	const g = currentGraph.value
	if (!g) return null
	return g.nodes.find((n) => n.id === id) ?? null
})

const selectedNodeTriggerType = computed<TriggerType | null>(() => {
	const n = selectedNode.value
	if (!n || n.kind !== 'trigger') return null
	return triggerTypes.value.find((t) => t.id === n.typeId) ?? null
})

const selectedNodeActionType = computed<ActionType | null>(() => {
	const n = selectedNode.value
	if (!n || n.kind !== 'action') return null
	return actionTypes.value.find((a) => a.id === n.typeId) ?? null
})

function onSelectNode(id: string | null) {
	selectedNodeId.value = id
}

// The node palette lives in the left BuilderPalette sidebar; its add events are
// forwarded to the canvas' exposed helpers via this template ref.
const graphCanvasRef = ref<{
	addNode: (kind: string, typeId?: string) => void
	addTemplateInstance: (template: { _id: string; name: string; icon?: string; ports: GroupPort[] }) => void
} | null>(null)

function onPaletteAddNode(payload: { kind: string; typeId?: string }) {
	graphCanvasRef.value?.addNode(payload.kind, payload.typeId)
}
function onPaletteAddTemplate(template: { _id: string; name: string; icon?: string; ports: GroupPort[] }) {
	graphCanvasRef.value?.addTemplateInstance(template)
}

watch(selectedId, () => {
	selectedNodeId.value = null
	initHistoryAndSaved()
	seedSubgraphPath()
})

// Re-fetch when the route's `?template=<id>` changes between templates while
// the editor is mounted. Editor is mounted once per route navigation so this
// is mostly a guard for in-place query updates (e.g. catalog "Edit" buttons
// using router.push).
watch(templateQueryId, async (id) => {
	if (editorMode.value !== 'template') return
	if (!id || id === templateLoadKey.value) return
	await loadTemplate(id)
})

function onGroupEnter(payload: { id: string }) {
	const g = currentGraph.value
	if (!g) return
	const node = g.nodes.find((n) => n.id === payload.id && n.kind === 'group')
	if (!node) return
	// Template instances have no inline subgraph — the frame walker would
	// stop at this segment and the watcher would prune it back. Bail early so
	// the path doesn't briefly include a doomed segment.
	if (node.templateId && !node.subgraph) return
	const name =
		(node.config?.name as string | undefined) ?? 'Group'
	subgraphPath.value = [
		...subgraphPath.value,
		{ kind: 'group', id: node.id, name },
	]
	selectedNodeId.value = null
}

// "Enter group" affordance — true iff the currently selected node is a group
// (local, or a template instance with a resolved subgraph). Read-only state
// is not consulted: entering a group from a read-only view is allowed.
// Drives the toolbar button, the inspector button, and the Tab keybinding.
const canEnterGroup = computed<boolean>(() => {
	const n = selectedNode.value
	if (!n || n.kind !== 'group') return false
	// Template instances need a resolved subgraph to navigate into; without
	// one we can't render the inner view.
	if (n.templateId && !n.subgraph) return false
	return true
})

function enterSelectedGroup() {
	const n = selectedNode.value
	if (!n || n.kind !== 'group') return
	onGroupEnter({ id: n.id })
}

function onUpdateNode(updated: GraphNode) {
	const g = currentGraph.value
	if (!g) return
	const nextGraph: ProcedureGraph = {
		...g,
		nodes: g.nodes.map((n) => (n.id === updated.id ? updated : n)),
	}
	onGraphUpdate(nextGraph)
}

// Detect port renames between two port arrays of the same group node.
//
// Two-pass matching, scoped per (kind, direction):
//   1. Ports present in BOTH arrays under the same (kind, direction, name) are
//      considered identical — no rename.
//   2. Of the remaining old/new ports, pair them positionally within each
//      (kind, direction) bucket. Each pair is a rename (old.name → new.name).
//      Unpaired old-only ports are true deletions; unpaired new-only ports are
//      true additions.
//
// This is heuristic but the GroupPortEditor emits one mutation per UX action,
// so each ports:update typically carries a single delta and the positional
// pairing is unambiguous.
interface PortRename {
	kind: 'data' | 'trigger'
	direction: 'in' | 'out'
	oldName: string
	newName: string
}

function detectPortRenames(
	oldPorts: GroupPort[],
	newPorts: GroupPort[],
): PortRename[] {
	const renames: PortRename[] = []
	const buckets: Array<{ kind: 'data' | 'trigger'; direction: 'in' | 'out' }> = [
		{ kind: 'data', direction: 'in' },
		{ kind: 'data', direction: 'out' },
		{ kind: 'trigger', direction: 'in' },
		{ kind: 'trigger', direction: 'out' },
	]
	for (const b of buckets) {
		const oldInBucket = oldPorts.filter(
			(p) => p.kind === b.kind && p.direction === b.direction,
		)
		const newInBucket = newPorts.filter(
			(p) => p.kind === b.kind && p.direction === b.direction,
		)
		const newNames = new Set(newInBucket.map((p) => p.name))
		const oldNames = new Set(oldInBucket.map((p) => p.name))
		// Ports that exist in both arrays with the same name didn't change.
		const oldOnly = oldInBucket.filter((p) => !newNames.has(p.name))
		const newOnly = newInBucket.filter((p) => !oldNames.has(p.name))
		const pairCount = Math.min(oldOnly.length, newOnly.length)
		for (let i = 0; i < pairCount; i++) {
			renames.push({
				kind: b.kind,
				direction: b.direction,
				oldName: oldOnly[i]!.name,
				newName: newOnly[i]!.name,
			})
		}
	}
	return renames
}

// Rewrite edge endpoints that referenced the renamed port names. Mutates the
// provided edge arrays in place.
//
// `nodeId` is the node owning the renamed ports — either the outer group node
// (for the outer graph's edges) or a sentinel node id inside the subgraph (for
// the inner edges). The direction of the rename determines which edge end is
// affected:
//   • data/in     → edge.to.field   when edge.to.node === nodeId
//   • data/out    → edge.from.port  when edge.from.node === nodeId
//   • trigger/in  → edge.to.branch  when edge.to.node === nodeId
//   • trigger/out → edge.from.branch when edge.from.node === nodeId
//
// For the inner subgraph, the sentinels invert the direction (an inbound port
// on the group is an OUTBOUND handle on the groupInput sentinel and vice
// versa). Callers pass `invertDirection: true` so a group-level "in" rename is
// applied to the sentinel's "out" handles, etc.
function applyPortRenamesToEdges(
	triggerEdges: TriggerEdge[],
	dataEdges: DataEdge[],
	nodeId: string,
	renames: PortRename[],
	invertDirection: boolean,
): void {
	for (const r of renames) {
		const effectiveDirection = invertDirection
			? r.direction === 'in'
				? 'out'
				: 'in'
			: r.direction
		if (r.kind === 'data') {
			if (effectiveDirection === 'out') {
				for (const e of dataEdges) {
					if (e.from.node === nodeId && e.from.port === r.oldName) {
						e.from.port = r.newName
					}
				}
			} else {
				for (const e of dataEdges) {
					if (e.to.node === nodeId && e.to.field === r.oldName) {
						e.to.field = r.newName
					}
				}
			}
		} else {
			if (effectiveDirection === 'out') {
				for (const e of triggerEdges) {
					if (e.from.node === nodeId && e.from.branch === r.oldName) {
						e.from.branch = r.newName
					}
				}
			} else {
				for (const e of triggerEdges) {
					if (e.to.node === nodeId && e.to.branch === r.oldName) {
						e.to.branch = r.newName
					}
				}
			}
		}
	}
}

// Make sure the group node's local subgraph has the sentinels and that no
// inner edge references a port that was just removed. The sentinels are
// auto-managed (the user never creates them by hand); their handle set is
// derived at render time from the parent group's `ports` array (see
// GraphCanvas.vue `parent-group-ports` prop plumbing), so this
// function only owns four responsibilities:
//   1. Ensure a single groupInput and a single groupOutput exist.
//   2. Drop data edges whose source/target port no longer exists.
//   3. Drop trigger edges whose source branch (originating at groupInput)
//      no longer exists.
//   4. Drop trigger edges into groupOutput whose target port (`to.branch`)
//      no longer exists.
function syncSentinels(group: GraphNode): void {
	if (!group.subgraph) return

	let gi = group.subgraph.nodes.find((n) => n.kind === 'groupInput')
	let go = group.subgraph.nodes.find((n) => n.kind === 'groupOutput')

	if (!gi) {
		gi = {
			id: newId(),
			kind: 'groupInput',
			config: {},
			position: { x: 0, y: 0 },
		}
		group.subgraph.nodes.push(gi)
	}
	if (!go) {
		go = {
			id: newId(),
			kind: 'groupOutput',
			config: {},
			position: { x: 600, y: 0 },
		}
		group.subgraph.nodes.push(go)
	}

	const ports = Array.isArray(group.ports) ? group.ports : []
	const validDataIn = new Set(
		ports
			.filter((p) => p.kind === 'data' && p.direction === 'in')
			.map((p) => p.name),
	)
	const validDataOut = new Set(
		ports
			.filter((p) => p.kind === 'data' && p.direction === 'out')
			.map((p) => p.name),
	)
	const validTriggerIn = new Set(
		ports
			.filter((p) => p.kind === 'trigger' && p.direction === 'in')
			.map((p) => p.name),
	)
	const validTriggerOut = new Set(
		ports
			.filter((p) => p.kind === 'trigger' && p.direction === 'out')
			.map((p) => p.name),
	)

	const giId = gi.id
	const goId = go.id

	group.subgraph.dataEdges = group.subgraph.dataEdges.filter((e) => {
		if (e.from.node === giId && !validDataIn.has(e.from.port)) return false
		if (e.to.node === goId && !validDataOut.has(e.to.field)) return false
		return true
	})

	group.subgraph.triggerEdges = group.subgraph.triggerEdges.filter((e) => {
		// trigger edges OUT OF groupInput carry the port name as `from.branch`
		// (the same convention if/switch use for named branches).
		if (e.from.node === giId) {
			const branch = e.from.branch ?? 'main'
			if (!validTriggerIn.has(branch)) return false
		}
		// trigger edges INTO groupOutput carry the target port name on
		// `to.branch`. If the port has been removed from the group's
		// declarations, drop the edge.
		if (e.to.node === goId && e.to.branch !== undefined) {
			if (!validTriggerOut.has(e.to.branch)) return false
		}
		return true
	})
}

function onPortsUpdate(payload: { nodeId: string; ports: GroupPort[] }) {
	const g = currentGraph.value
	if (!g) return
	const idx = g.nodes.findIndex(
		(n) => n.id === payload.nodeId && n.kind === 'group',
	)
	if (idx === -1) return
	const existing = g.nodes[idx]!
	// Template instances don't own a local subgraph — their `ports` come from
	// the template definition and are read-only on the instance. Defensive:
	// silently no-op if someone managed to invoke the editor on one.
	if (existing.templateId) return

	// Detect renames against the PREVIOUS ports array BEFORE we replace it.
	// Pure additions and pure deletions yield no renames; syncSentinels still
	// handles deletions by dropping orphaned inner edges, and the outer graph
	// has no edges for added ports yet, so neither needs port-name rewrites.
	const oldPorts = Array.isArray(existing.ports) ? existing.ports : []
	const renames = detectPortRenames(oldPorts, payload.ports)

	// Build a deep-cloned group node so syncSentinels can mutate its subgraph
	// freely without aliasing into the current graph's state. The outer
	// onUpdateNode/onGraphUpdate path expects a fresh node reference.
	const clonedGroup: GraphNode = {
		...existing,
		ports: payload.ports.map((p) => ({ ...p })),
		subgraph: existing.subgraph
			? (JSON.parse(JSON.stringify(existing.subgraph)) as ProcedureGraph)
			: undefined,
	}

	// Cascade renames into the INNER subgraph before syncSentinels runs — if
	// we waited until after, syncSentinels would treat the old port names
	// still on inner edges as references to deleted ports and drop them.
	if (renames.length > 0 && clonedGroup.subgraph) {
		const gi = clonedGroup.subgraph.nodes.find((n) => n.kind === 'groupInput')
		const go = clonedGroup.subgraph.nodes.find((n) => n.kind === 'groupOutput')
		// Group-level "in" ports surface as groupInput's OUT handles, and
		// group-level "out" ports surface as groupOutput's IN handles. We pass
		// invertDirection=true and target the right sentinel per direction.
		const inRenames = renames.filter((r) => r.direction === 'in')
		const outRenames = renames.filter((r) => r.direction === 'out')
		if (gi && inRenames.length > 0) {
			applyPortRenamesToEdges(
				clonedGroup.subgraph.triggerEdges,
				clonedGroup.subgraph.dataEdges,
				gi.id,
				inRenames,
				true,
			)
		}
		if (go && outRenames.length > 0) {
			applyPortRenamesToEdges(
				clonedGroup.subgraph.triggerEdges,
				clonedGroup.subgraph.dataEdges,
				go.id,
				outRenames,
				true,
			)
		}
	}

	syncSentinels(clonedGroup)

	// Cascade renames into the OUTER graph's edges (where this group node is
	// an endpoint). We do this by walking the current graph, cloning the
	// triggerEdges / dataEdges arrays, applying the renames, then going
	// through onGraphUpdate so history + dirty tracking pick it up. We can't
	// rely on onUpdateNode for outer-edge changes because it only replaces
	// the node, not the edges.
	if (renames.length > 0) {
		const nextOuter: ProcedureGraph = {
			...g,
			nodes: g.nodes.map((n, i) => (i === idx ? clonedGroup : n)),
			triggerEdges: g.triggerEdges.map((e) => ({
				...e,
				from: { ...e.from },
				to: { ...e.to },
			})),
			dataEdges: g.dataEdges.map((e) => ({
				...e,
				from: { ...e.from },
				to: { ...e.to },
			})),
		}
		applyPortRenamesToEdges(
			nextOuter.triggerEdges,
			nextOuter.dataEdges,
			payload.nodeId,
			renames,
			false,
		)
		onGraphUpdate(nextOuter)
		return
	}

	onUpdateNode(clonedGroup)
}

function onUnwireField(payload: { field: string }) {
	const g = currentGraph.value
	if (!g || !selectedNode.value) return
	const nodeId = selectedNode.value.id
	const nextGraph: ProcedureGraph = {
		...g,
		dataEdges: g.dataEdges.filter(
			(e) => !(e.to.node === nodeId && e.to.field === payload.field),
		),
	}
	onGraphUpdate(nextGraph)
}

// Inspector "Delete node" button — same outcome as pressing Delete/Backspace
// on the canvas: drop the node plus every trigger/data edge that touches it.
function onDeleteNode(payload: { id: string }) {
	const g = currentGraph.value
	if (!g || isCurrentGraphReadOnly.value) return
	const id = payload.id
	const nextGraph: ProcedureGraph = {
		...g,
		nodes: g.nodes.filter((n) => n.id !== id),
		triggerEdges: g.triggerEdges.filter(
			(e) => e.from.node !== id && e.to.node !== id,
		),
		dataEdges: g.dataEdges.filter(
			(e) => e.from.node !== id && e.to.node !== id,
		),
	}
	if (selectedNodeId.value === id) selectedNodeId.value = null
	onGraphUpdate(nextGraph)
}

// ---------------------------------------------------------------------------
// Create-group-from-selection
// ---------------------------------------------------------------------------
// Visible when the user has selected one or more eligible nodes in the
// current canvas. "Eligible" rules out kinds that can't legally live inside
// a group's subgraph in v1:
//   • `trigger` — triggers must live at the top level of a procedure.
//   • `groupInput` / `groupOutput` — sentinels are auto-managed and only
//     valid inside their owning group.
// Selection containing multiple groups IS allowed: nesting an existing
// group inside a new one is just a regular subgraph node move; the v1
// validator doesn't forbid it, and the executor's depth cap catches
// runaway recursion.
//
// Also gated on:
//   • An editable graph (not the read-only template-instance view).
//   • A real procedure being open (selected.value).
const canGroupSelection = computed<boolean>(() => {
	if (!selected.value) return false
	if (isCurrentGraphReadOnly.value) return false
	const ids = selectedNodeIds.value
	if (ids.length === 0) return false
	const g = currentGraph.value
	if (!g) return false
	const idSet = new Set(ids)
	for (const n of g.nodes) {
		if (!idSet.has(n.id)) continue
		if (n.kind === 'trigger') return false
		if (n.kind === 'groupInput' || n.kind === 'groupOutput') return false
	}
	return true
})

// Friendly default port names. Each cut edge maps to a desired name based on
// the user-facing label on the cut side; if two edges land on the same name
// (e.g. two inside actions both have an `input` field), we suffix `-2`, `-3`
// per (kind, direction). The user can rename later in the GroupPortEditor.
//
// Port name picks:
//   data-in    → target node's input field name
//   data-out   → source node's output port name
//   trigger-in → source branch label if present, else 'main'
//   trigger-out → source branch label if present, else 'main'
//
// The "main" default for non-branching trigger cuts is intentional: the
// GroupNode / sentinel renderers place a trigger port named "main" on the
// title bar (mirroring ordinary trigger/action nodes), so a typical group
// wrapping linear flow looks just like a single action — title-bar in/out.
// Branch-labeled ports (if.then, switch.<case>, …) render in the body.
function desiredPortNameForTrigger(branch: string | undefined): string {
	return branch && branch.length > 0 ? branch : 'main'
}

// Dedup against an already-declared set scoped to (kind, direction). The set
// is mutated as new names are reserved.
function uniqueName(desired: string, taken: Set<string>): string {
	if (!taken.has(desired)) {
		taken.add(desired)
		return desired
	}
	let i = 2
	while (taken.has(`${desired}-${i}`)) i++
	const final = `${desired}-${i}`
	taken.add(final)
	return final
}

interface NewGroupPlan {
	groupId: string
	groupPorts: GroupPort[]
	// Sentinel node ids — the planner generates them up front so its inner
	// edges reference real ids; the caller installs the sentinel nodes
	// under these ids.
	groupInputId: string
	groupOutputId: string
	// Edges to add to the outer graph (replacements for cut edges).
	outerTriggerEdges: TriggerEdge[]
	outerDataEdges: DataEdge[]
	// Edges to add inside the new subgraph (connecting sentinels to the
	// inner endpoints of the cut edges).
	innerTriggerEdges: TriggerEdge[]
	innerDataEdges: DataEdge[]
}

// Build a JsonSchema property bag from a kind's declared static port
// list — used as the fallback when no type-registry schema applies.
function staticPortsToSchema(
	ports: ReadonlyArray<{ name: string; type?: string }>,
): JsonSchema {
	const properties: Record<string, JsonSchemaProperty> = {}
	for (const p of ports) {
		properties[p.name] = p.type ? { type: p.type } : {}
	}
	return { properties }
}

function findSchemaForDataSourcePort(nodeId: string, port: string): JsonSchema | undefined {
	const g = currentGraph.value
	if (!g) return undefined
	const node = g.nodes.find((n) => n.id === nodeId)
	if (!node) return undefined
	// `group` carries its ports on the node itself, not in the kind registry.
	if (node.kind === 'group') {
		const p = (node.ports ?? []).find(
			(pp) => pp.kind === 'data' && pp.direction === 'out' && pp.name === port,
		)
		return p?.schema as JsonSchema | undefined
	}
	const ui = nodeKinds.value.find((k) => k.kind === node.kind)?.meta.ui
	if (!ui) return undefined
	let outputSchema: JsonSchema | undefined
	if (ui.typeRegistry && ui.dataOutsFromTypeSchema) {
		const key = ui.dataOutsFromTypeSchema
		if (ui.typeRegistry === 'triggers') {
			const t = triggerTypes.value.find((tt) => tt.id === node.typeId) as
				| Record<string, JsonSchema | undefined>
				| undefined
			outputSchema = t?.[key]
		} else if (ui.typeRegistry === 'actions') {
			const a = actionTypes.value.find((aa) => aa.id === node.typeId) as
				| Record<string, JsonSchema | undefined>
				| undefined
			outputSchema = a?.[key]
		} else {
			const d = dataNodeTypes.value.find((dd) => dd.id === node.typeId) as
				| Record<string, JsonSchema | undefined>
				| undefined
			outputSchema = d?.[key]
		}
	}
	if (!outputSchema && ui.staticDataOuts.length > 0) {
		outputSchema = staticPortsToSchema(ui.staticDataOuts)
	}
	const prop = outputSchema?.properties?.[port]
	if (!prop) return undefined
	return prop as JsonSchema
}

function findSchemaForDataTargetField(nodeId: string, field: string): JsonSchema | undefined {
	const g = currentGraph.value
	if (!g) return undefined
	const node = g.nodes.find((n) => n.id === nodeId)
	if (!node) return undefined
	if (node.kind === 'group') {
		const p = (node.ports ?? []).find(
			(pp) => pp.kind === 'data' && pp.direction === 'in' && pp.name === field,
		)
		return p?.schema as JsonSchema | undefined
	}
	const ui = nodeKinds.value.find((k) => k.kind === node.kind)?.meta.ui
	if (!ui) return undefined
	let inputSchema: JsonSchema | undefined
	if (ui.typeRegistry && ui.dataInsFromTypeSchema) {
		const key = ui.dataInsFromTypeSchema
		if (ui.typeRegistry === 'actions') {
			const a = actionTypes.value.find((aa) => aa.id === node.typeId) as
				| Record<string, JsonSchema | undefined>
				| undefined
			inputSchema = a?.[key]
		} else if (ui.typeRegistry === 'dataNodes') {
			const d = dataNodeTypes.value.find((dd) => dd.id === node.typeId) as
				| Record<string, JsonSchema | undefined>
				| undefined
			inputSchema = d?.[key]
		} else {
			const t = triggerTypes.value.find((tt) => tt.id === node.typeId) as
				| Record<string, JsonSchema | undefined>
				| undefined
			inputSchema = t?.[key]
		}
	}
	if (!inputSchema && ui.staticDataIns.length > 0) {
		inputSchema = staticPortsToSchema(ui.staticDataIns)
	}
	const prop = inputSchema?.properties?.[field]
	if (!prop) return undefined
	return prop as JsonSchema
}

function planNewGroup(
	g: ProcedureGraph,
	selection: Set<string>,
	groupId: string,
): NewGroupPlan {
	const ports: GroupPort[] = []
	const outerTriggerEdges: TriggerEdge[] = []
	const outerDataEdges: DataEdge[] = []
	const innerTriggerEdges: TriggerEdge[] = []
	const innerDataEdges: DataEdge[] = []

	// Per (kind, direction) name reservations — keeps dedup scoped so a
	// data-in "input" and a data-out "output" can coexist even if a
	// hypothetical trigger-in shared the same desired label.
	const takenDataIn = new Set<string>()
	const takenDataOut = new Set<string>()
	const takenTriggerIn = new Set<string>()
	const takenTriggerOut = new Set<string>()

	// We need sentinel ids that match the ones syncSentinels will (re)use.
	// Generate them up front so the inner edges below can reference them;
	// then we splat them into the subgraph and let syncSentinels see them
	// already in place.
	const groupInputId = newId()
	const groupOutputId = newId()

	for (const e of g.triggerEdges) {
		const fromIn = selection.has(e.from.node)
		const toIn = selection.has(e.to.node)
		if (fromIn === toIn) continue // both inside or both outside → not cut
		if (fromIn && !toIn) {
			// Cut: source inside, target outside → declare trigger-out port.
			const name = uniqueName(
				desiredPortNameForTrigger(e.from.branch),
				takenTriggerOut,
			)
			ports.push({ kind: 'trigger', direction: 'out', name })
			// Outer: new edge from the OUTER group node's trigger-out handle
			// to the original target node. `from.branch` IS the port name —
			// matches how connect parses `group-trigger-out-<port>`.
			outerTriggerEdges.push({
				id: newId(),
				from: { node: groupId, branch: name },
				to: { node: e.to.node },
			})
			// Inner: original source node fires into groupOutput. Source-side
			// branch is preserved verbatim (for if/switch routing); target
			// port name lives on `to.branch` so the renderer can pick the
			// right `groupOutput-trigger-in-<port>` handle.
			innerTriggerEdges.push({
				id: newId(),
				from: { node: e.from.node, branch: e.from.branch },
				to: { node: groupOutputId, branch: name },
			})
		} else {
			// Cut: source outside, target inside → declare trigger-in port.
			const name = uniqueName(
				desiredPortNameForTrigger(e.from.branch),
				takenTriggerIn,
			)
			ports.push({ kind: 'trigger', direction: 'in', name })
			// Outer: original source node fires into OUTER group node's
			// trigger-in handle. Port name lives on `to.branch` (rendered as
			// `group-trigger-in-<port>` via the renderer).
			outerTriggerEdges.push({
				id: newId(),
				from: { node: e.from.node, branch: e.from.branch },
				to: { node: groupId, branch: name },
			})
			// Inner: groupInput fires into original target. Port name lives
			// on `from.branch` — matches the syncSentinels filter for
			// trigger edges out of groupInput.
			innerTriggerEdges.push({
				id: newId(),
				from: { node: groupInputId, branch: name },
				to: { node: e.to.node },
			})
		}
	}

	for (const e of g.dataEdges) {
		const fromIn = selection.has(e.from.node)
		const toIn = selection.has(e.to.node)
		if (fromIn === toIn) continue
		if (fromIn && !toIn) {
			// Cut: source inside, target outside → declare data-out port.
			const name = uniqueName(e.from.port, takenDataOut)
			ports.push({
				kind: 'data',
				direction: 'out',
				name,
				schema: findSchemaForDataSourcePort(e.from.node, e.from.port),
			})
			// Outer: group node's data-out → original target field.
			outerDataEdges.push({
				id: newId(),
				from: { node: groupId, port: name },
				to: { node: e.to.node, field: e.to.field },
			})
			// Inner: original source → groupOutput's data-in port (name).
			innerDataEdges.push({
				id: newId(),
				from: { node: e.from.node, port: e.from.port },
				to: { node: groupOutputId, field: name },
			})
		} else {
			// Cut: source outside, target inside → declare data-in port.
			const name = uniqueName(e.to.field, takenDataIn)
			ports.push({
				kind: 'data',
				direction: 'in',
				name,
				schema: findSchemaForDataTargetField(e.to.node, e.to.field),
			})
			// Outer: original source → group node's data-in port.
			outerDataEdges.push({
				id: newId(),
				from: { node: e.from.node, port: e.from.port },
				to: { node: groupId, field: name },
			})
			// Inner: groupInput's data-out → original target field.
			innerDataEdges.push({
				id: newId(),
				from: { node: groupInputId, port: name },
				to: { node: e.to.node, field: e.to.field },
			})
		}
	}

	return {
		groupId,
		groupPorts: ports,
		groupInputId,
		groupOutputId,
		outerTriggerEdges,
		outerDataEdges,
		innerTriggerEdges,
		innerDataEdges,
	}
}

function createGroupFromSelection() {
	if (!canGroupSelection.value) return
	const g = currentGraph.value
	if (!g) return
	const ids = selectedNodeIds.value.slice()
	if (ids.length === 0) return

	// Default name; window.prompt is intentionally lo-fi for v1. A modal
	// could replace this later, but it keeps the change scope tight.
	const inputName =
		typeof window !== 'undefined'
			? (window.prompt('Group name', 'Group') ?? '').trim() || 'Group'
			: 'Group'

	const selection = new Set(ids)
	const groupId = newId()

	const plan = planNewGroup(g, selection, groupId)

	// Position the new group at the centroid of the selection. We also
	// shift the selected nodes' positions into the subgraph's coordinate
	// space: subtract the selection min, then add a left-margin so the
	// groupInput sentinel can sit at x ≈ 0.
	const SUBGRAPH_LEFT_MARGIN = 220 // groupInput sits at x = 0 with room
	const SUBGRAPH_RIGHT_MARGIN = 220
	const selectedNodes = g.nodes.filter((n) => selection.has(n.id))
	const xs = selectedNodes.map((n) => n.position.x)
	const ys = selectedNodes.map((n) => n.position.y)
	const minX = xs.length ? Math.min(...xs) : 0
	const maxX = xs.length ? Math.max(...xs) : 0
	const minY = ys.length ? Math.min(...ys) : 0
	const maxY = ys.length ? Math.max(...ys) : 0
	const centerX = xs.length ? (minX + maxX) / 2 : 200
	const centerY = ys.length ? (minY + maxY) / 2 : 200

	const innerNodes: GraphNode[] = selectedNodes.map((n) => ({
		...JSON.parse(JSON.stringify(n)),
		position: {
			x: n.position.x - minX + SUBGRAPH_LEFT_MARGIN,
			y: n.position.y - minY,
		},
	}))

	const innerHeight = Math.max(maxY - minY, 0)
	const innerWidth = Math.max(maxX - minX, 0)

	const groupInputNode: GraphNode = {
		id: plan.groupInputId,
		kind: 'groupInput',
		config: {},
		position: { x: 0, y: innerHeight / 2 },
	}
	const groupOutputNode: GraphNode = {
		id: plan.groupOutputId,
		kind: 'groupOutput',
		config: {},
		position: {
			x: innerWidth + SUBGRAPH_LEFT_MARGIN + SUBGRAPH_RIGHT_MARGIN,
			y: innerHeight / 2,
		},
	}

	// Inner edges fully inside the selection — keep them verbatim (re-id
	// not required since we keep node ids stable; ids only need to be
	// unique within their containing graph and these are all from the
	// outer graph we just stripped them from).
	const innerOriginalTriggerEdges = g.triggerEdges.filter(
		(e) => selection.has(e.from.node) && selection.has(e.to.node),
	)
	const innerOriginalDataEdges = g.dataEdges.filter(
		(e) => selection.has(e.from.node) && selection.has(e.to.node),
	)

	const newGroupNode: GraphNode = {
		id: groupId,
		kind: 'group',
		config: { name: inputName },
		position: { x: centerX, y: centerY },
		ports: plan.groupPorts,
		subgraph: {
			nodes: [...innerNodes, groupInputNode, groupOutputNode],
			triggerEdges: [...innerOriginalTriggerEdges, ...plan.innerTriggerEdges],
			dataEdges: [...innerOriginalDataEdges, ...plan.innerDataEdges],
		},
	}

	// Build the new outer graph: drop the selected nodes + every edge that
	// touches them (cut OR fully-inside), then add the new group + the
	// replacement outer edges.
	const remainingOuterNodes = g.nodes.filter((n) => !selection.has(n.id))
	const remainingOuterTriggerEdges = g.triggerEdges.filter(
		(e) => !selection.has(e.from.node) && !selection.has(e.to.node),
	)
	const remainingOuterDataEdges = g.dataEdges.filter(
		(e) => !selection.has(e.from.node) && !selection.has(e.to.node),
	)

	const nextGraph: ProcedureGraph = {
		nodes: [...remainingOuterNodes, newGroupNode],
		triggerEdges: [...remainingOuterTriggerEdges, ...plan.outerTriggerEdges],
		dataEdges: [...remainingOuterDataEdges, ...plan.outerDataEdges],
	}

	// Clear stale selection — the original ids no longer exist in the
	// outer graph. Select the newly-created group.
	selectedNodeIds.value = []
	selectedNodeId.value = groupId

	onGraphUpdate(nextGraph)
}

const procedureName = computed<string>({
	get: () => selected.value?.name ?? '',
	set: (v: string) => {
		if (selected.value) selected.value.name = v
	},
})

const procedureEnabled = computed<boolean>({
	get: () => selected.value?.enabled ?? false,
	set: (v: boolean) => {
		if (selected.value) selected.value.enabled = v
	},
})

// ---------------------------------------------------------------------------
// The builder's bar: state, saving, problems (AU-03, AU-04, AU-16)
// ---------------------------------------------------------------------------

const summaries = ref<ProcedureSummaryRow[]>([])

async function loadSummaries() {
	try {
		const res = await $authFetch<{ results: ProcedureSummaryRow[] }>(`${props.apiUrl}/procedures/summary`)
		summaries.value = res.results ?? []
	} catch {
		summaries.value = []
	}
}

const currentSummary = computed(() => summaries.value.find((s) => s.procedureId === selectedId.value) ?? null)

const STATE_TONES = {
	failing: 'error',
	degraded: 'warning',
	healthy: 'success',
	paused: 'neutral',
	draft: 'info',
} as const

/** How many things changed since the last save, for "2 unsaved changes". */
const changeCount = computed<number>(() => {
	const current = selected.value
	const saved = savedSnapshot.value
	if (!current || !saved) return 0
	let count = 0
	if (current.name !== saved.name) count++
	if (current.enabled !== saved.enabled) count++
	const before = new Map(saved.graph.nodes.map((n) => [n.id, JSON.stringify(n)]))
	const after = new Map(current.graph.nodes.map((n) => [n.id, JSON.stringify(n)]))
	for (const [id, value] of after) if (before.get(id) !== value) count++
	for (const id of before.keys()) if (!after.has(id)) count++
	const edges = (g: ProcedureGraph) => JSON.stringify([g.triggerEdges, g.dataEdges])
	if (edges(current.graph) !== edges(saved.graph)) count++
	return count
})

// Problems of the draft, asked of the server (the same validator a save
// runs) a moment after each change.
const issues = ref<Array<{ severity: 'error' | 'warning'; message: string; nodeId?: string }>>([])
let validateTimer: ReturnType<typeof setTimeout> | undefined
const VALIDATE_DELAY_MS = 500

async function validateDraft() {
	const current = selected.value
	if (!current || editorMode.value !== 'procedure') {
		issues.value = []
		return
	}
	try {
		const res = await $authFetch<{ issues: typeof issues.value }>(`${props.apiUrl}/procedures/validate`, {
			method: 'POST',
			body: { graph: current.graph },
		})
		issues.value = res.issues ?? []
	} catch {
		// A graph the schema refuses is reported on save.
	}
}

watch(
	() => (selected.value ? structuralKey(selected.value.graph) : ''),
	() => {
		clearTimeout(validateTimer)
		validateTimer = setTimeout(() => void validateDraft(), VALIDATE_DELAY_MS)
	},
	{ immediate: true },
)

const blockingIssues = computed(() => issues.value.filter((i) => i.severity === 'error'))

/** How the builder names a node: its label, else its type's name. */
function nodeDisplayName(id: string): string {
	const node = walkAll(selected.value?.graph).find((n) => n.id === id)
	if (!node) return id
	const label = (node as GraphNode & { label?: string }).label
	if (label) return label
	const typeName =
		node.kind === 'trigger'
			? triggerTypes.value.find((x) => x.id === node.typeId)?.name
			: node.kind === 'action'
				? actionTypes.value.find((x) => x.id === node.typeId)?.name
				: node.kind === 'data'
					? dataNodeTypes.value.find((x) => x.id === node.typeId)?.name
					: nodeKinds.value.find((k) => k.kind === node.kind)?.meta.ui?.label
	return typeName ? processI18n(typeName) : (node.config?.name as string | undefined) ?? node.kind
}

function walkAll(graph: ProcedureGraph | undefined): GraphNode[] {
	if (!graph) return []
	return graph.nodes.flatMap((n) => [n, ...walkAll(n.subgraph)])
}

const dockIssues = computed<DockIssue[]>(() =>
	issues.value.map((issue) => ({
		...issue,
		nodeName: issue.nodeId ? nodeDisplayName(issue.nodeId) : undefined,
	})),
)

const issuesByNode = computed<Record<string, { severity: 'error' | 'warning'; message: string }>>(() => {
	const out: Record<string, { severity: 'error' | 'warning'; message: string }> = {}
	for (const issue of issues.value) {
		if (!issue.nodeId) continue
		if (!out[issue.nodeId] || issue.severity === 'error') out[issue.nodeId] = { severity: issue.severity, message: issue.message }
	}
	return out
})

const dockTab = ref<DockTab>('problems')
// The dock stays out of the canvas's way until it has something to say.
const dockCollapsed = ref(true)
watch(
	() => issues.value.length,
	(count, before) => {
		if (count > 0 && !before) {
			dockTab.value = 'problems'
			dockCollapsed.value = false
		}
	},
)

function selectNode(id: string) {
	// A node inside a group is named by its top-level group in the issues.
	subgraphPath.value = subgraphPath.value.slice(0, 1)
	selectedNodeId.value = id
}

interface ProcedureTriggers {
	triggers: Array<TriggerSummary & { nextAt: string | null }>
}
const savedTriggers = ref<ProcedureTriggers['triggers']>([])

async function loadSavedTriggers() {
	if (!selectedId.value || editorMode.value !== 'procedure') return
	try {
		const res = await $authFetch<ProcedureTriggers>(`${props.apiUrl}/procedures/${selectedId.value}/triggers`)
		savedTriggers.value = res.triggers
	} catch {
		savedTriggers.value = []
	}
}

/** The banner of a disabled procedure names what will not fire (AU-16). */
const pausedBanner = computed(() => {
	const current = selected.value
	if (!current || current.enabled || editorMode.value !== 'procedure') return null
	const triggers = savedTriggers.value.filter((tr) => tr.typeId !== 'manual')
	if (triggers.length === 0) return null
	const first = triggers[0]!
	const what = describeTrigger(first, processI18n)
	const isDraft = currentSummary.value?.status === 'draft'
	return {
		title: t(isDraft ? 'dms_automation.editor.paused.draftTitle' : 'dms_automation.editor.paused.title', { name: current.name }),
		description: first.nextAt
			? t('dms_automation.editor.paused.schedule', {
					what,
					next: new Intl.DateTimeFormat(locale.value, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(first.nextAt)),
				})
			: t('dms_automation.editor.paused.other', { what }),
	}
})

async function enableNow() {
	if (!selected.value) return
	selected.value.enabled = true
	await onSave()
}

const saveState = computed(() => {
	if (saving.value) return t('dms_automation.editor.saving')
	if (changeCount.value > 0) return t('dms_automation.editor.unsaved', { count: changeCount.value })
	return t('dms_automation.editor.saved')
})

// ---------------------------------------------------------------------------
// Create, delete, export
// ---------------------------------------------------------------------------

async function onCreated(id: string) {
	await loadList()
	await loadSummaries()
	selectedId.value = id
	void router.replace(`${builderPath()}?selected=${id}`)
}

async function onCreate() {
	if (!(await confirmDiscard())) return
	newProcedureOpen.value = true
}

async function onDelete() {
	const current = selected.value
	if (!current) return
	await confirm({
		title: t('dms_automation.editor.deleteTitle', { name: current.name }),
		description: current.enabled ? t('dms_automation.editor.deleteEnabled') : t('dms_automation.editor.deleteDisabled'),
		color: 'error',
		icon: 'i-ph-trash',
		confirmLabel: t('dms_automation.editor.delete'),
		confirmText: current.enabled ? current.name : undefined,
		onConfirm: async () => {
			await $authFetch(`${props.apiUrl}/procedures/${current._id}`, { method: 'DELETE' })
			procedures.value = procedures.value.filter((p) => p._id !== current._id)
			selectedId.value = procedures.value[0]?._id ?? null
			toast.add({ title: t('dms_automation.editor.deleted', { name: current.name }), color: 'success', icon: 'i-ph-check-circle' })
			void loadSummaries()
		},
	})
}

async function onExport() {
	const current = selected.value
	if (!current) return
	const data = await $authFetch<unknown>(`${props.apiUrl}/procedures/${current._id}/export`)
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = `${current.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'procedure'}.json`
	link.click()
	URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Switching procedure with unsaved changes (AU-04)
// ---------------------------------------------------------------------------

const leaveDialog = ref<{ open: boolean; resolve?: (choice: 'save' | 'discard' | 'stay') => void }>({ open: false })

function askLeave(): Promise<'save' | 'discard' | 'stay'> {
	return new Promise((resolve) => {
		leaveDialog.value = { open: true, resolve }
	})
}

function answerLeave(choice: 'save' | 'discard' | 'stay') {
	leaveDialog.value.resolve?.(choice)
	leaveDialog.value = { open: false }
}

/** Resolves `true` when the draft may be left: saved, discarded or clean. */
async function confirmDiscard(): Promise<boolean> {
	if (!isDirty.value) return true
	const choice = await askLeave()
	if (choice === 'stay') return false
	if (choice === 'save') return await onSave()
	onCancel()
	return true
}

async function onPickProcedure(id: string) {
	if (!(await confirmDiscard())) return
	selectedId.value = id
	void router.replace(`${builderPath()}?selected=${id}`)
}

watch(isDirty, (dirty) => (unsavedDraft.value = dirty && editorMode.value === 'procedure'), { immediate: true })

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

interface SaveRefusal {
	data?: { issues?: Array<{ severity?: string; message?: string; nodeId?: string } | string> }
}

function issuesOf(error: unknown) {
	const raw = (error as SaveRefusal)?.data?.issues
	if (!Array.isArray(raw)) return null
	return raw.map((issue) =>
		typeof issue === 'string'
			? { severity: 'error' as const, message: issue }
			: { severity: (issue.severity === 'warning' ? 'warning' : 'error') as 'error' | 'warning', message: issue.message ?? '', nodeId: issue.nodeId },
	)
}

/** Save the open procedure (or template). Resolves whether it was saved. */
async function onSave(): Promise<boolean> {
	if (!selected.value) return false
	saving.value = true
	const current = selected.value
	try {
		if (editorMode.value === 'template') {
			await $authFetch(`${props.apiUrl}/templates/${current._id}`, {
				method: 'PUT',
				body: {
					name: current.name,
					description: current.description,
					icon: templateIcon.value,
					ports: templatePorts.value.map((p) => ({ ...p })),
					subgraph: current.graph,
				},
			})
			savedSnapshot.value = takeSnapshot(current)
			toast.add({ title: t('dms_automation.templates.saved', { name: current.name }), color: 'success', icon: 'i-ph-check-circle' })
			return true
		}
		const res = await $authFetch<{ version: number; issues?: typeof issues.value }>(`${props.apiUrl}/procedures/${current._id}`, {
			method: 'PUT',
			body: {
				name: current.name,
				description: current.description,
				enabled: current.enabled,
				graph: current.graph,
			},
		})
		savedSnapshot.value = takeSnapshot(current)
		if (res.issues) issues.value = res.issues
		toast.add({
			title: t('dms_automation.editor.savedToast', { name: current.name }),
			description: res.issues?.length ? t('dms_automation.editor.savedWithProblems', { count: res.issues.length }) : undefined,
			color: 'success',
			icon: 'i-ph-check-circle',
			actions: [{ label: t('dms_automation.editor.testRun'), onClick: () => void onTestRun() }],
		})
		void loadSummaries()
		void loadSavedTriggers()
		return true
	} catch (e) {
		const refused = issuesOf(e)
		if (refused) {
			issues.value = refused
			saveBlocked.value = true
			dockTab.value = 'problems'
			dockCollapsed.value = false
		} else {
			toast.add({
				title: editorMode.value === 'template' ? t('dms_automation.templates.saveError') : t('dms_automation.editor.saveError'),
				description: (e as Error).message,
				color: 'error',
				icon: 'i-ph-warning',
			})
		}
		return false
	} finally {
		saving.value = false
	}
}

/** Set when a save was refused for problems: the banner offers the way out. */
const saveBlocked = ref(false)
watch(blockingIssues, (list) => {
	if (list.length === 0) saveBlocked.value = false
})

async function saveAsDraft() {
	if (!selected.value) return
	selected.value.enabled = false
	if (await onSave()) saveBlocked.value = false
}

function goToFirstProblem() {
	const first = blockingIssues.value.find((i) => i.nodeId) ?? issues.value.find((i) => i.nodeId)
	if (first?.nodeId) selectNode(first.nodeId)
}


// ---------------------------------------------------------------------------
// Save-as-template
// ---------------------------------------------------------------------------
// Visible when the user has selected a single local group (kind === 'group',
// no templateId). On submit:
//   1. POST /api/automation/templates with { name, description, icon, ports,
//      subgraph } from the local group.
//   2. On success: mutate the in-graph node — set templateId = res._id, drop
//      subgraph. The save flow (onGraphUpdate → onSave by user) propagates.
//   3. On failure (Zod or template cycle): render the error body inline in
//      the modal; the graph is NOT touched.
const selectedLocalGroupNode = computed<GraphNode | null>(() => {
	const n = selectedNode.value
	if (!n || n.kind !== 'group') return null
	if (n.templateId) return null
	return n
})

const canSaveAsTemplate = computed<boolean>(() => {
	if (!selected.value) return false
	if (isCurrentGraphReadOnly.value) return false
	return selectedLocalGroupNode.value !== null
})

const saveAsTemplateOpen = ref<boolean>(false)
const saveAsTemplateName = ref<string>('')
const saveAsTemplateDescription = ref<string>('')
const saveAsTemplateIcon = ref<string>('i-ph-package')
const saveAsTemplateSubmitting = ref<boolean>(false)
const saveAsTemplateError = ref<string | null>(null)

function openSaveAsTemplate() {
	const n = selectedLocalGroupNode.value
	if (!n) return
	saveAsTemplateName.value =
		(n.config?.name as string | undefined) ?? 'Template'
	saveAsTemplateDescription.value = ''
	saveAsTemplateIcon.value = 'i-ph-package'
	saveAsTemplateError.value = null
	saveAsTemplateSubmitting.value = false
	saveAsTemplateOpen.value = true
}

// Render the 400 body from src/routes/templates.ts:
//   - Zod failure → { error: 'invalid body', issues: ZodIssue[] }
//   - validateGraph failure → { error: 'invalid graph', issues: string[] }
//   - cycle → { error: 'template reference cycle', cycle: string[] }
// Other errors (network, 401, 500) fall back to the message string.
function formatTemplateError(err: unknown): string {
	const data = (err as { data?: unknown; message?: string } | undefined)?.data as
		| {
				error?: string
				issues?: Array<{ path?: Array<string | number>; message?: string } | string>
				cycle?: string[]
		  }
		| undefined
	if (data && typeof data === 'object') {
		const head = data.error ?? 'Request failed'
		if (Array.isArray(data.issues) && data.issues.length > 0) {
			const lines = data.issues.map((iss) => {
				if (typeof iss === 'string') return iss
				const path = Array.isArray(iss.path) ? iss.path.join('.') : ''
				const msg = iss.message ?? 'invalid'
				return path ? `${path}: ${msg}` : msg
			})
			return `${head}\n${lines.join('\n')}`
		}
		if (Array.isArray(data.cycle) && data.cycle.length > 0) {
			return `${head}: ${data.cycle.join(' → ')}`
		}
		return head
	}
	return (err as Error).message ?? 'Failed to save template'
}

function convertLocalGroupToTemplateInstance(
	nodeId: string,
	templateId: string,
): void {
	const g = currentGraph.value
	if (!g) return
	const existing = g.nodes.find((n) => n.id === nodeId && n.kind === 'group')
	if (!existing) return
	const updated: GraphNode = { ...existing, templateId }
	delete updated.subgraph
	onUpdateNode(updated)
}

async function submitSaveAsTemplate() {
	const n = selectedLocalGroupNode.value
	if (!n) return
	const name = saveAsTemplateName.value.trim()
	if (!name) {
		saveAsTemplateError.value = 'Name is required'
		return
	}
	if (!n.subgraph) {
		saveAsTemplateError.value = 'Group has no subgraph to save'
		return
	}
	saveAsTemplateSubmitting.value = true
	saveAsTemplateError.value = null
	try {
		const body = {
			name,
			description: saveAsTemplateDescription.value.trim(),
			icon: saveAsTemplateIcon.value.trim() || 'i-ph-package',
			ports: Array.isArray(n.ports) ? n.ports : [],
			subgraph: n.subgraph,
		}
		const created = await $authFetch<{ _id: string }>(
			'/api/automation/templates',
			{ method: 'POST', body },
		)
		convertLocalGroupToTemplateInstance(n.id, created._id)
		saveAsTemplateOpen.value = false
		toast.add({
			title: t('dms_automation.templates.saved', { name }),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
	} catch (e) {
		saveAsTemplateError.value = formatTemplateError(e)
	} finally {
		saveAsTemplateSubmitting.value = false
	}
}

// ---------------------------------------------------------------------------
// Fork-to-local-group
// ---------------------------------------------------------------------------
// Visible when a template-instance group node is selected — i.e. kind === 'group'
// AND templateId is set. The fork is the escape hatch from the live-link
// model: it converts the instance back to a local group by deep-cloning the
// template's current subgraph into the node and dropping templateId.
//
// Selection rules:
//   • Allowed even from the read-only inner-subgraph view of a template
//     instance — this is the "Fork to edit" CTA flow. The action mutates
//     the OUTER graph (the procedure root or whichever container holds
//     the template instance), not the inner subgraph being viewed.
//   • To make that work, the selection target for the fork is the deepest
//     currentParentGroup when we're inside a template-instance subgraph,
//     OR the selectedNode otherwise.
//
// The deep-clone uses a JSON parse/stringify round-trip: structuredClone
// throws on Vue's reactive proxies (see the inline note at the clone site).
//
// Edge case: if the template was deleted between selection and confirm,
// GET /:id returns 404 → we surface that as an error in the modal so the
// user can dismiss and stop trying.
interface ForkTarget {
	// The group node to convert (the template instance).
	node: GraphNode
	// The graph in which that node lives. May be the procedure root or any
	// outer subgraph (when the user is viewing the inner read-only graph of
	// an instance, the instance node lives one frame up).
	containerGraph: ProcedureGraph
}

const forkTarget = computed<ForkTarget | null>(() => {
	if (!selected.value) return null
	const frames = subgraphFrames.value
	// Case A: user is INSIDE a template-instance subgraph (read-only view).
	// The instance node is the parent group; its container is the previous
	// frame's graph.
	if (isCurrentGraphReadOnly.value && frames.length >= 2) {
		const parent = frames[frames.length - 1]!.groupNode
		const container = frames[frames.length - 2]!.graph
		if (parent && parent.kind === 'group' && parent.templateId) {
			return { node: parent, containerGraph: container }
		}
	}
	// Case B: user has a template-instance node selected in the current
	// (editable) graph.
	const sel = selectedNode.value
	const g = currentGraph.value
	if (sel && g && sel.kind === 'group' && sel.templateId) {
		return { node: sel, containerGraph: g }
	}
	return null
})

const canForkToLocal = computed<boolean>(() => forkTarget.value !== null)

const forkOpen = ref<boolean>(false)
const forkSubmitting = ref<boolean>(false)
const forkError = ref<string | null>(null)

function openFork() {
	if (!canForkToLocal.value) return
	forkError.value = null
	forkSubmitting.value = false
	forkOpen.value = true
}

interface FetchedTemplate {
	_id: string
	name: string
	description: string
	icon: string
	ports: GroupPort[]
	subgraph: ProcedureGraph
}

// Replace the template instance node with a forked local copy. Mirrors the
// shape of convertLocalGroupToTemplateInstance but in reverse: drops
// templateId, installs subgraph from the fetched template, and writes back
// through onUpdateNode / onGraphUpdate (so history + dirty-snapshot stay
// consistent). The replacement uses a fresh node object so Vue reactivity
// sees a real change.
function convertTemplateInstanceToLocal(
	target: ForkTarget,
	template: FetchedTemplate,
): void {
	const { node, containerGraph } = target
	const idx = containerGraph.nodes.findIndex(
		(n) => n.id === node.id && n.kind === 'group',
	)
	if (idx === -1) return
	const updated: GraphNode = {
		...node,
		// Deep-clone the template's subgraph so subsequent edits to the
		// template (or to this fork) don't alias each other. JSON round-trip
		// strips Vue's reactive proxy — structuredClone throws on proxies.
		subgraph: JSON.parse(JSON.stringify(template.subgraph)) as ProcedureGraph,
		// Preserve the local ports if the instance carries them (it should
		// — palette drops clone template.ports onto the instance); fall back
		// to the template's port list otherwise.
		ports: Array.isArray(node.ports) && node.ports.length > 0
			? node.ports.map((p) => ({ ...p }))
			: template.ports.map((p) => ({ ...p })),
	}
	delete updated.templateId

	// If the user was inside the template instance's subgraph (Case A in
	// forkTarget), pop the read-only path segment first so the canvas
	// re-binds to the (now editable) outer graph. The user can re-enter
	// the local subgraph fresh via dblclick if they want.
	if (isCurrentGraphReadOnly.value && subgraphPath.value.length > 1) {
		subgraphPath.value = subgraphPath.value.slice(0, -1)
		selectedNodeId.value = updated.id
	}

	// Use onUpdateNode — it walks subgraphPath and rewrites the correct
	// container graph (root or any depth). Because we just popped above
	// when needed, currentGraph now points at containerGraph.
	onUpdateNode(updated)
}

function formatForkError(err: unknown): string {
	const status = (err as { statusCode?: number; status?: number } | undefined)
	const code = status?.statusCode ?? status?.status
	if (code === 404) {
		return 'This template no longer exists. It may have been deleted by another user.'
	}
	const data = (err as { data?: { error?: string } } | undefined)?.data
	if (data?.error) return data.error
	return (err as Error).message ?? 'Failed to fork template instance'
}

async function submitFork() {
	const target = forkTarget.value
	if (!target) return
	const templateId = target.node.templateId
	if (!templateId) return
	forkSubmitting.value = true
	forkError.value = null
	try {
		const tpl = await $authFetch<FetchedTemplate>(
			`/api/automation/templates/${templateId}`,
		)
		convertTemplateInstanceToLocal(target, tpl)
		forkOpen.value = false
		toast.add({
			title: t('dms_automation.editor.forked', {
				name: (target.node.config?.name as string | undefined) ?? tpl.name,
			}),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
	} catch (e) {
		forkError.value = formatForkError(e)
	} finally {
		forkSubmitting.value = false
	}
}

// Tab / Shift+Tab / Escape keybindings for subgraph navigation. Tab enters
// the selected group (if eligible); Shift+Tab and Escape pop one level out.
// We ignore the key when focus is in an editable field (input, textarea,
// contenteditable, USelect popovers) so typing a literal Tab in the
// inspector still works.
function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	const tag = target.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
	if (target.isContentEditable) return true
	return false
}

// Listened to in the capture phase, so a focused field (a select opens on
// Enter) never sees a shortcut meant for the builder.
function onShortcut(ev: KeyboardEvent): boolean {
	if (!(ev.metaKey || ev.ctrlKey)) return false
	const key = ev.key.toLowerCase()
	if (['s', 'enter', 'p'].includes(key)) ev.stopPropagation()
	if (key === 's') {
		ev.preventDefault()
		if (isDirty.value) void onSave()
		return true
	}
	if (key === 'enter' && editorMode.value === 'procedure') {
		ev.preventDefault()
		void onTestRun()
		return true
	}
	if (key === 'p' && editorMode.value === 'procedure') {
		ev.preventDefault()
		switcherOpen.value = true
		return true
	}
	return false
}

function onKeyDown(ev: KeyboardEvent) {
	if (onShortcut(ev)) return
	if (isEditableTarget(ev.target)) return
	// Modal / drawer open → don't hijack keys.
	if (saveAsTemplateOpen.value || forkOpen.value || switcherOpen.value || runNowOpen.value) return
	if (ev.key === 'Escape' && overlayRun.value && subgraphPath.value.length <= 1) {
		ev.preventDefault()
		exitDebug()
		return
	}
	if (ev.key === 'Tab' && !ev.shiftKey) {
		if (!canEnterGroup.value) return
		ev.preventDefault()
		enterSelectedGroup()
		return
	}
	if ((ev.key === 'Tab' && ev.shiftKey) || ev.key === 'Escape') {
		if (subgraphPath.value.length <= 1) return
		ev.preventDefault()
		exitSubgraph()
	}
}

onMounted(() => {
	if (typeof window === 'undefined') return
	window.addEventListener('keydown', onKeyDown, { capture: true })
})
onBeforeUnmount(() => {
	if (typeof window === 'undefined') return
	window.removeEventListener('keydown', onKeyDown, { capture: true })
})

// ---------------------------------------------------------------------------
// Runs over the canvas: Test run of the draft, debugging a stored run (AU-05)
// ---------------------------------------------------------------------------

const recentRuns = ref<DockRun[]>([])

async function loadRecentRuns() {
	if (!selectedId.value || editorMode.value !== 'procedure') return
	try {
		const list = await $authFetch<DockRun[]>(`${props.apiUrl}/procedures/${selectedId.value}/runs?limit=8`)
		recentRuns.value = Array.isArray(list) ? list.slice(0, 8) : []
	} catch {
		recentRuns.value = []
	}
}

/** The run shown over the canvas, and whether it is a test of the draft. */
const overlayRun = ref<RunDetail | null>(null)
const overlayIsTest = ref(false)
const testing = ref(false)
const testPayload = ref('{}')
const testPayloadSource = ref<string | null>(null)

async function loadTestPayload() {
	if (!selectedId.value || editorMode.value !== 'procedure') return
	try {
		const res = await $authFetch<{ last: { runId: string; payload: unknown } | null }>(
			`${props.apiUrl}/procedures/${selectedId.value}/last-payload`,
		)
		testPayload.value = JSON.stringify(res.last?.payload ?? {}, null, 2)
		testPayloadSource.value = res.last?.runId ?? null
	} catch {
		testPayload.value = '{}'
		testPayloadSource.value = null
	}
}

const runStates = computed<Record<string, NodeRunState> | undefined>(() => {
	const run = overlayRun.value
	if (!run || subgraphPath.value.length > 1) return undefined
	const out: Record<string, NodeRunState> = {}
	for (const step of run.trace.steps) {
		const id = step.nodeId.split('__')[0]!
		const previous = out[id]
		const status = step.status === 'failed' ? 'failed' : 'ok'
		if (!previous || status === 'failed') {
			out[id] = { status, durationMs: (previous?.durationMs ?? 0) + (step.durationMs ?? 0) }
		}
	}
	for (const skipped of run.trace.skipped) out[skipped.nodeId] = { status: 'skipped' }
	return out
})

const overlaySteps = computed<TraceStep[] | null>(() => (overlayIsTest.value ? (overlayRun.value?.trace.steps ?? null) : null))

// The dock's "Test run" tab only exists while a test run is on screen.
watch(overlaySteps, (steps) => {
	if (!steps && dockTab.value === 'test') dockTab.value = 'problems'
})

/** The step of the selected node in the run on screen, for the inspector. */
const selectedRunStep = computed<TraceStep | null>(() => {
	const id = selectedNodeId.value
	const steps = overlayRun.value?.trace.steps ?? []
	if (!id) return null
	const own = steps.filter((s) => s.nodeId === id || s.nodeId.startsWith(`${id}__`))
	return own.find((s) => s.status === 'failed') ?? own.at(-1) ?? null
})

const overlayLabel = computed(() => {
	const run = overlayRun.value
	if (!run) return ''
	const when = describeTime(run.startedAt, locale.value)
	return overlayIsTest.value
		? t('dms_automation.editor.debug.testLabel', { when })
		: t('dms_automation.editor.debug.runLabel', { run: run._id.slice(-6), when })
})

const overlaySummary = computed(() => {
	const run = overlayRun.value
	if (!run) return ''
	const duration = describeDuration(run.durationMs, locale.value)
	if (run.status === 'failed') {
		const step = stepTitle(run.failedStep, processI18n)
		return step
			? t('dms_automation.editor.debug.failedAt', { step, duration })
			: t('dms_automation.editor.debug.failed', { duration })
	}
	return t('dms_automation.editor.debug.passed', { duration })
})

async function showRun(runId: string, isTest: boolean) {
	const run = await runsApi.getRun(runId)
	overlayRun.value = run
	overlayIsTest.value = isTest
	if (run.failedNodeId) selectNode(run.failedNodeId.split('__')[0]!)
}

function exitDebug() {
	overlayRun.value = null
	overlayIsTest.value = false
	if (queryValue('run')) void router.replace(`${builderPath()}?selected=${selectedId.value}`)
}

async function onTestRun() {
	const current = selected.value
	if (!current || editorMode.value !== 'procedure') return
	let payload: unknown
	try {
		payload = JSON.parse(testPayload.value || 'null')
	} catch {
		dockTab.value = 'payload'
		dockCollapsed.value = false
		toast.add({ title: t('dms_automation.editor.dock.invalidJson'), color: 'error', icon: 'i-ph-warning' })
		return
	}
	testing.value = true
	try {
		const res = await $authFetch<{ runId: string }>(`${props.apiUrl}/procedures/${current._id}/test`, {
			method: 'POST',
			body: { graph: current.graph, payload },
		})
		await showRun(res.runId, true)
		dockTab.value = 'test'
		dockCollapsed.value = false
		void loadRecentRuns()
	} catch (e) {
		const refused = issuesOf(e)
		if (refused) {
			issues.value = refused
			dockTab.value = 'problems'
		}
		toast.add({ title: t('dms_automation.editor.testRunError'), description: (e as Error).message, color: 'error', icon: 'i-ph-warning' })
	} finally {
		testing.value = false
	}
}

/** Run now runs the saved graph: with unsaved changes, say so first. */
async function openRunNow() {
	if (!selected.value) return
	if (isDirty.value) {
		let choice: 'saved' | 'test' | null = null
		await confirm({
			title: t('dms_automation.editor.runSaved.title'),
			description: t('dms_automation.editor.runSaved.description', { count: changeCount.value }),
			color: 'warning',
			confirmLabel: t('dms_automation.editor.runSaved.runSaved'),
			cancelLabel: t('dms_automation.editor.runSaved.testDraft'),
			onConfirm: async () => {
				choice = 'saved'
			},
		}).then((ok) => {
			if (!ok) choice = 'test'
		})
		if (choice === 'test') {
			await onTestRun()
			return
		}
	}
	runNowOpen.value = true
}

function onRunStarted(runId: string) {
	toast.add({
		title: t('dms_automation.editor.runStarted', { name: selected.value?.name ?? '' }),
		color: 'success',
		icon: 'i-ph-play-circle',
		actions: [{ label: t('dms_automation.runs.trace'), onClick: () => void router.push(`${props.traceUrl}?run=${runId}`) }],
	})
	void showRun(runId, false)
	void loadRecentRuns()
	void loadSummaries()
}

function openTrace(runId: string) {
	void router.push(`${props.traceUrl}?run=${runId}`)
}

// ---------------------------------------------------------------------------
// Node actions from the inspector
// ---------------------------------------------------------------------------

function onDuplicateNode(payload: { id: string }) {
	const g = currentGraph.value
	if (!g || isCurrentGraphReadOnly.value) return
	const node = g.nodes.find((n) => n.id === payload.id)
	if (!node) return
	const copy: GraphNode = {
		...cloneGraph({ nodes: [node], triggerEdges: [], dataEdges: [] }).nodes[0]!,
		id: newId(),
		position: { x: node.position.x + 40, y: node.position.y + 60 },
	}
	onGraphUpdate({ ...g, nodes: [...g.nodes, copy] })
	selectedNodeId.value = copy.id
}

/** Put a Retry in front of a step: it now runs inside the Retry's body. */
function onWrapInRetry(payload: { id: string }) {
	const g = currentGraph.value
	if (!g || isCurrentGraphReadOnly.value) return
	const node = g.nodes.find((n) => n.id === payload.id)
	if (!node) return
	const retry: GraphNode = {
		id: newId(),
		kind: 'retry',
		config: { maxAttempts: 3 },
		position: { x: node.position.x - 40, y: node.position.y - 140 },
	}
	const triggerEdges = g.triggerEdges.map((e) => {
		if (e.to.node === node.id) return { ...e, to: { ...e.to, node: retry.id } }
		if (e.from.node === node.id && (!e.from.branch || e.from.branch === 'main')) {
			return { ...e, from: { node: retry.id, branch: 'main' } }
		}
		return e
	})
	triggerEdges.push({ id: newId(), from: { node: retry.id, branch: 'body' }, to: { node: node.id } })
	onGraphUpdate({ ...g, nodes: [...g.nodes, retry], triggerEdges })
	selectedNodeId.value = retry.id
}

// ---------------------------------------------------------------------------
// Loading what the bar and the dock show, per procedure
// ---------------------------------------------------------------------------

watch(
	selectedId,
	() => {
		overlayRun.value = null
		void loadSavedTriggers()
		void loadRecentRuns()
		void loadTestPayload()
	},
	{ immediate: true },
)

onMounted(async () => {
	await loadSummaries()
	const runId = queryValue('run')
	if (runId) await showRun(runId, false).catch(() => undefined)
	const nodeId = queryValue('node')
	if (nodeId) selectNode(nodeId)
})

const selectedTriggerSummaries = computed<TriggerSummary[]>(() =>
	(selected.value?.graph.nodes ?? [])
		.filter((n) => n.kind === 'trigger' && n.typeId)
		.map((n) => ({
			nodeId: n.id,
			typeId: n.typeId!,
			typeName: triggerTypes.value.find((x) => x.id === n.typeId)?.name ?? n.typeId!,
			path: typeof n.config?.path === 'string' ? n.config.path : undefined,
			method: typeof n.config?.method === 'string' ? n.config.method : undefined,
			cron: typeof n.config?.cron === 'string' ? n.config.cron : undefined,
		})),
)


</script>

<template>
	<!--
		The builder is one tool: the page hides its header (src/pages/builder.ts)
		and the editor fills the panel. One bar holds the procedure's identity,
		state and actions; the palette, the canvas and the inspector share the
		height; the dock under them lists problems, runs and the test payload.
	-->
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-default bg-default">
		<header class="flex min-h-13 flex-wrap items-center gap-2 border-b border-default px-3 py-2">
			<template v-if="editorMode === 'procedure'">
				<UTooltip :text="$t('dms_automation.editor.switcher.title') + ' (⌘P)'">
					<UButton
						icon="i-ph-flow-arrow"
						variant="ghost"
						color="neutral"
						:aria-label="$t('dms_automation.editor.switcher.title')"
						@click="switcherOpen = true"
					/>
				</UTooltip>
			</template>
			<template v-else>
				<UButton icon="i-ph-arrow-left" variant="ghost" color="neutral" to="/modules/automation/library">
					{{ $t('dms_automation.library.title') }}
				</UButton>
				<UBadge color="info" variant="subtle">{{ $t('dms_automation.editor.templateBadge') }}</UBadge>
			</template>
			<UInput
				v-if="selected"
				v-model="procedureName"
				variant="ghost"
				:placeholder="editorMode === 'template' ? $t('dms_automation.editor.templateName') : $t('dms_automation.editor.procedureName')"
				:aria-label="editorMode === 'template' ? $t('dms_automation.editor.templateName') : $t('dms_automation.editor.procedureName')"
				class="min-w-[12rem] max-w-sm flex-1 font-medium"
			/>
			<DmsStatusPill
				v-if="currentSummary && editorMode === 'procedure'"
				:tone="STATE_TONES[currentSummary.status]"
				:label="$t(`dms_automation.procedures.status.${currentSummary.status}`)"
				size="sm"
			/>
			<label v-if="selected && editorMode === 'procedure'" class="flex items-center gap-2 text-sm text-muted">
				<USwitch v-model="procedureEnabled" size="sm" />
				{{ procedureEnabled ? $t('dms_automation.editor.enabled') : $t('dms_automation.editor.disabled') }}
			</label>
			<span v-if="selected" class="ml-1 text-xs" :class="changeCount > 0 ? 'text-warning' : 'text-dimmed'">
				<UIcon :name="changeCount > 0 ? 'i-ph-circle-fill' : 'i-ph-check'" class="size-2.5 align-middle" />
				{{ saveState }}
			</span>
			<div class="ml-auto flex flex-wrap items-center gap-2">
				<UButton
					v-if="selected"
					variant="ghost"
					color="neutral"
					:disabled="!isDirty || saving"
					@click="onCancel"
				>
					{{ $t('dms_automation.editor.discard') }}
				</UButton>
				<template v-if="selected && editorMode === 'procedure'">
					<UButton variant="outline" color="neutral" icon="i-ph-play" @click="openRunNow">
						{{ $t('dms_automation.editor.runNowButton') }}
					</UButton>
					<UButton variant="outline" color="neutral" icon="i-ph-flask" :loading="testing" @click="onTestRun">
						{{ $t('dms_automation.editor.testRun') }}
						<UKbd value="⌘↵" size="sm" class="ml-1" />
					</UButton>
				</template>
				<UButton v-if="selected" color="primary" icon="i-ph-floppy-disk" :disabled="!isDirty" :loading="saving" @click="onSave">
					{{ $t('dms_automation.common.save') }}
					<UKbd value="⌘S" size="sm" class="ml-1" />
				</UButton>
				<UDropdownMenu
					v-if="selected && editorMode === 'procedure'"
					:items="[
						[
							{ label: $t('dms_automation.newProcedure.title'), icon: 'i-ph-plus', onSelect: onCreate },
							{ label: $t('dms_automation.editor.exportJson'), icon: 'i-ph-download-simple', onSelect: onExport },
							{ label: $t('dms_automation.editor.viewRuns'), icon: 'i-ph-list-bullets', to: `${runsUrl}?filter_procedureId=is:${selectedId}` },
						],
						[{ label: $t('dms_automation.editor.delete'), icon: 'i-ph-trash', color: 'error', onSelect: onDelete }],
					]"
				>
					<UButton icon="i-ph-dots-three" variant="ghost" color="neutral" :aria-label="$t('dms_automation.editor.more')" />
				</UDropdownMenu>
			</div>
		</header>

		<div class="flex flex-col gap-2 empty:hidden" :class="loadError || saveBlocked || pausedBanner || overlayRun || isCurrentGraphReadOnly ? 'border-b border-default p-2' : ''">
			<DmsBanner
				v-if="loadError"
				size="sm"
				tone="error"
				icon="i-ph-warning"
				:title="editorMode === 'template' ? $t('dms_automation.editor.loadTemplateError') : $t('dms_automation.editor.loadProceduresError')"
				:description="loadError"
			/>
			<DmsBanner
				v-if="saveBlocked && blockingIssues.length"
				size="sm"
				tone="error"
				icon="i-ph-warning-octagon"
				:title="$t('dms_automation.editor.problems.title', { count: blockingIssues.length })"
				:description="$t('dms_automation.editor.problems.description')"
			>
				<template #actions>
					<UButton size="xs" color="error" variant="soft" @click="goToFirstProblem">{{ $t('dms_automation.editor.problems.first') }}</UButton>
					<UButton size="xs" color="neutral" variant="outline" :loading="saving" @click="saveAsDraft">{{ $t('dms_automation.editor.problems.saveDraft') }}</UButton>
				</template>
			</DmsBanner>
			<DmsBanner v-if="pausedBanner && !saveBlocked" size="sm" tone="warning" icon="i-ph-pause-circle" :title="pausedBanner.title" :description="pausedBanner.description">
				<template #actions>
					<UButton size="xs" color="warning" variant="soft" :loading="saving" :disabled="blockingIssues.length > 0" @click="enableNow">
						{{ $t('dms_automation.editor.paused.enable') }}
					</UButton>
				</template>
			</DmsBanner>
			<DmsBanner
				v-if="overlayRun"
				size="sm"
				:tone="overlayRun.status === 'failed' ? 'error' : 'success'"
				:icon="overlayRun.status === 'failed' ? 'i-ph-bug' : 'i-ph-check-circle'"
				:title="overlaySummary"
				:description="overlayLabel"
			>
				<template #actions>
					<UButton v-if="overlayIsTest" size="xs" variant="soft" color="neutral" icon="i-ph-arrow-clockwise" :loading="testing" @click="onTestRun">
						{{ $t('dms_automation.editor.debug.again') }}
					</UButton>
					<UButton size="xs" variant="ghost" color="neutral" icon="i-ph-path" @click="openTrace(overlayRun._id)">
						{{ $t('dms_automation.runs.trace') }}
					</UButton>
					<UButton size="xs" variant="ghost" color="neutral" @click="exitDebug">
						{{ $t('dms_automation.editor.debug.exit') }}
						<UKbd value="Esc" size="sm" class="ml-1" />
					</UButton>
				</template>
			</DmsBanner>
			<DmsBanner
				v-if="isCurrentGraphReadOnly"
				size="sm"
				tone="info"
				icon="i-ph-link"
				:title="$t('dms_automation.editor.linkedTitle')"
				:description="$t('dms_automation.editor.linkedDescription')"
			>
				<template v-if="canForkToLocal" #actions>
					<UButton size="xs" color="info" variant="soft" icon="i-ph-git-fork" @click="openFork">
						{{ $t('dms_automation.editor.forkToEdit') }}
					</UButton>
				</template>
			</DmsBanner>
		</div>

		<DmsEmptyState
			v-if="!selected && !loading && editorMode === 'procedure'"
			class="m-auto"
			size="lg"
			icon="i-ph-flow-arrow"
			:title="$t('dms_automation.editor.noProcedureTitle')"
			:description="$t('dms_automation.editor.noProcedure')"
			:actions="[{ label: $t('dms_automation.newProcedure.title'), icon: 'i-ph-plus', onClick: () => (newProcedureOpen = true) }]"
		/>

		<div v-if="selected" class="flex min-h-0 flex-1">
			<DmsAutomationBuilderPalette
				v-if="currentGraph && !isCurrentGraphReadOnly"
				:node-kinds="nodeKinds"
				:trigger-types="triggerTypes"
				:action-types="actionTypes"
				:data-node-types="dataNodeTypes"
				:templates="palettesTemplates"
				class="w-60 shrink-0 border-r border-default"
				@add-node="onPaletteAddNode"
				@add-template="onPaletteAddTemplate"
			/>
			<div class="h-full min-w-0 flex-1">
				<DmsClientOnly>
					<DmsAutomationGraphCanvas
						v-if="currentGraph"
						ref="graphCanvasRef"
						:graph="currentGraph"
						:trigger-types="triggerTypes"
						:action-types="actionTypes"
						:data-node-types="dataNodeTypes"
						:node-kinds="nodeKinds"
						:can-undo="canUndo"
						:can-redo="canRedo"
						:parent-group-ports="currentParentGroupPorts"
						:read-only="isCurrentGraphReadOnly"
						:run-states="runStates"
						:issues="subgraphPath.length <= 1 ? issuesByNode : undefined"
						class="[&_.graph-canvas-wrap]:rounded-none [&_.graph-canvas-wrap]:border-0"
						@update:graph="onGraphUpdate"
						@select:node="onSelectNode"
						@selection-change="onSelectionChange"
						@undo="onUndo"
						@redo="onRedo"
						@group:enter="onGroupEnter"
					>
						<template #breadcrumb>
							<div class="flex items-center gap-2 rounded-lg border border-default bg-elevated/90 px-2 py-1 shadow-sm">
								<UBreadcrumb :items="breadcrumbItems" :ui="{ linkLabel: 'first-letter:uppercase' }" />
								<UButton
									v-if="subgraphPath.length > 1"
									size="xs"
									variant="ghost"
									color="neutral"
									icon="i-ph-arrow-up-left"
									@click="exitSubgraph"
								>
									{{ $t('dms_automation.editor.exitSubgraph') }}
								</UButton>
							</div>
						</template>
						<template
							v-if="canGroupSelection || canSaveAsTemplate || canForkToLocal || canEnterGroup"
							#groupActions
						>
							<span v-if="selectedNodeIds.length > 1" class="px-1 text-xs text-muted">
								{{ $t('dms_automation.editor.selected', { count: selectedNodeIds.length }) }}
							</span>
							<UButton v-if="canEnterGroup" size="sm" color="primary" icon="i-ph-arrow-square-in" variant="ghost" @click="enterSelectedGroup">
								{{ $t('dms_automation.editor.enterGroup') }}
							</UButton>
							<UButton v-if="canGroupSelection" size="sm" color="primary" icon="i-ph-stack" variant="ghost" @click="createGroupFromSelection">
								{{ $t('dms_automation.editor.groupSelection', { n: selectedNodeIds.length }) }}
							</UButton>
							<UButton v-if="canSaveAsTemplate" size="sm" color="primary" icon="i-ph-floppy-disk" variant="ghost" @click="openSaveAsTemplate">
								{{ $t('dms_automation.editor.saveAsTemplate') }}
							</UButton>
							<UButton v-if="canForkToLocal" size="sm" color="primary" icon="i-ph-git-fork" variant="ghost" @click="openFork">
								{{ $t('dms_automation.editor.forkToLocal') }}
							</UButton>
						</template>
					</DmsAutomationGraphCanvas>
					<template #fallback>
						<div class="flex h-full items-center justify-center text-sm text-dimmed">
							{{ $t('dms_automation.editor.loading') }}
						</div>
					</template>
				</DmsClientOnly>
			</div>
			<aside v-if="selectedNode" class="flex w-80 shrink-0 flex-col border-l border-default">
				<DmsAutomationNodeInspector
					:node="selectedNode"
					:data-edges="currentGraph?.dataEdges ?? []"
					:trigger-type="selectedNodeTriggerType"
					:action-type="selectedNodeActionType"
					:trigger-types="triggerTypes"
					:action-types="actionTypes"
					:data-node-types="dataNodeTypes"
					:node-kinds="nodeKinds"
					:read-only="isCurrentGraphReadOnly"
					:run-step="subgraphPath.length <= 1 ? selectedRunStep : null"
					:run-label="overlayLabel"
					:run-trace-url="overlayRun ? `${traceUrl}?run=${overlayRun._id}` : undefined"
					:issue="issuesByNode[selectedNode.id] ?? null"
					:node-name="nodeDisplayName"
					@update:node="onUpdateNode"
					@unwire="onUnwireField"
					@ports:update="onPortsUpdate"
					@group:enter="onGroupEnter"
					@delete:node="onDeleteNode"
					@duplicate:node="onDuplicateNode"
					@wrap:retry="onWrapInRetry"
				/>
			</aside>
		</div>

		<DmsAutomationBottomDock
			v-if="selected && editorMode === 'procedure'"
			v-model:tab="dockTab"
			v-model:payload="testPayload"
			v-model:collapsed="dockCollapsed"
			:issues="dockIssues"
			:runs="recentRuns"
			:test-steps="overlaySteps"
			:payload-source="testPayloadSource"
			:runs-url="`${runsUrl}?filter_procedureId=is:${selectedId}`"
			@select-node="selectNode"
			@open-trace="openTrace"
		/>

		<DmsAutomationProcedureSwitcher
			v-if="editorMode === 'procedure'"
			v-model:open="switcherOpen"
			:procedures="summaries"
			:current-id="selectedId"
			proceduresUrl="/modules/automation/procedures"
			@pick="onPickProcedure"
			@create="onCreate"
		/>
		<DmsAutomationNewProcedureDialog v-model:open="newProcedureOpen" :api-url="apiUrl" @created="onCreated" />
		<DmsAutomationRunNowDialog
			v-if="selected && editorMode === 'procedure'"
			v-model:open="runNowOpen"
			:api-url="apiUrl"
			:procedure-id="selected._id"
			:procedure-name="selected.name"
			:triggers="selectedTriggerSummaries"
			@started="onRunStarted"
		/>

		<UModal v-model:open="leaveDialog.open" :title="$t('dms_automation.editor.leave.title', { name: selected?.name ?? '' })" :dismissible="false">
			<template #body>
				<p class="text-sm text-toned">{{ $t('dms_automation.editor.leave.description', { count: changeCount }) }}</p>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton variant="ghost" color="error" @click="answerLeave('discard')">{{ $t('dms_automation.editor.discard') }}</UButton>
					<UButton variant="outline" color="neutral" @click="answerLeave('stay')">{{ $t('dms_automation.editor.leave.keep') }}</UButton>
					<UButton color="primary" @click="answerLeave('save')">{{ $t('dms_automation.editor.leave.save') }}</UButton>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="saveAsTemplateOpen"
			:title="$t('dms_automation.editor.saveTemplateModal.title')"
		>
			<template #body>
				<div class="flex flex-col gap-3">
					<UFormField
						:label="$t('dms_automation.editor.saveTemplateModal.name')"
						required
					>
						<UInput
							v-model="saveAsTemplateName"
							:placeholder="$t('dms_automation.editor.saveTemplateModal.namePlaceholder')"
							class="w-full"
							:disabled="saveAsTemplateSubmitting"
						/>
					</UFormField>
					<UFormField
						:label="$t('dms_automation.editor.saveTemplateModal.description')"
					>
						<UTextarea
							v-model="saveAsTemplateDescription"
							:placeholder="$t('dms_automation.editor.saveTemplateModal.descriptionPlaceholder')"
							class="w-full"
							:rows="3"
							:disabled="saveAsTemplateSubmitting"
						/>
					</UFormField>
					<UFormField :label="$t('dms_automation.editor.saveTemplateModal.icon')">
						<DmsAutomationIconPicker v-model="saveAsTemplateIcon" />
					</UFormField>
					<div v-if="selectedLocalGroupNode?.ports?.length" class="flex flex-col gap-1">
						<span class="text-xs font-medium text-highlighted">{{ $t('dms_automation.editor.saveTemplateModal.ports') }}</span>
						<div class="overflow-hidden rounded-md border border-default">
							<div
								v-for="port in selectedLocalGroupNode.ports"
								:key="`${port.direction}-${port.kind}-${port.name}`"
								class="flex items-center gap-2 border-b border-default px-2 py-1 font-mono text-xs last:border-0"
							>
								<UBadge size="sm" variant="subtle" :color="port.kind === 'trigger' ? 'info' : 'success'">{{ $t(`dms_automation.templates.ports.kind.${port.kind}`) }}</UBadge>
								<span class="text-muted">{{ $t(`dms_automation.templates.ports.direction.${port.direction}`) }}</span>
								<span class="text-highlighted">{{ port.name }}</span>
							</div>
						</div>
					</div>
					<UAlert
						v-if="saveAsTemplateError"
						color="error"
						variant="subtle"
						icon="i-ph-warning"
						:title="$t('dms_automation.editor.saveTemplateModal.error')"
						:description="saveAsTemplateError"
					/>
				</div>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						:label="$t('dms_automation.editor.saveTemplateModal.cancel')"
						variant="outline"
						color="neutral"
						:disabled="saveAsTemplateSubmitting"
						@click="saveAsTemplateOpen = false"
					/>
					<UButton
						:label="$t('dms_automation.editor.saveTemplateModal.submit')"
						color="primary"
						:loading="saveAsTemplateSubmitting"
						@click="submitSaveAsTemplate"
					/>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="forkOpen"
			:title="$t('dms_automation.editor.forkModal.title')"
		>
			<template #body>
				<div class="flex flex-col gap-3">
					<p class="text-sm text-toned">
						{{ $t('dms_automation.editor.forkModal.body') }}
					</p>
					<UAlert
						v-if="forkError"
						color="error"
						variant="subtle"
						icon="i-ph-warning"
						:title="$t('dms_automation.editor.forkModal.error')"
						:description="forkError"
					/>
				</div>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						:label="$t('dms_automation.editor.forkModal.cancel')"
						variant="outline"
						color="neutral"
						:disabled="forkSubmitting"
						@click="forkOpen = false"
					/>
					<UButton
						:label="$t('dms_automation.editor.forkModal.submit')"
						color="primary"
						icon="i-ph-git-fork"
						:loading="forkSubmitting"
						@click="submitFork"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>
