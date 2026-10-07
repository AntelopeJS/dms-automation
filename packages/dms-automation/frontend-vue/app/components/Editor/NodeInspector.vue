<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TraceStep } from '../../composables/useAutomationRuns'
import { describeDuration, prettyJson } from '../../utils/describe'
import JsonField from './JsonField.vue'
import type { NodeKindEntry } from '../../composables/useAutomationNodeKinds'
import type {
	ActionType,
	DataEdge,
	DataNodeType,
	GraphNode,
	GroupPort,
	JsonSchema,
	JsonSchemaProperty,
	TriggerType,
} from '../../composables/useGraphConnect'
import { isGroupNode } from '../../composables/useGraphConnect'

const props = defineProps<{
	node: GraphNode | null
	dataEdges: DataEdge[]
	triggerType: TriggerType | null
	actionType: ActionType | null
	triggerTypes: TriggerType[]
	actionTypes: ActionType[]
	dataNodeTypes: DataNodeType[]
	// Per-NodeKind metadata served by `/api/automation/node-kinds`. The
	// inspector reads each kind's optional `configSchema` to render its
	// editable config form — no per-kind branches here.
	nodeKinds: NodeKindEntry[]
	// Read-only graphs (template-instance view) hide the delete button.
	readOnly?: boolean
	/** The node's step in the run shown over the canvas, for the "Last run" tab. */
	runStep?: TraceStep | null
	/** Says which run that is ("Test run · just now", "Run 8f3a2c · 14:28"). */
	runLabel?: string
	/** Opens the trace of that run. */
	runTraceUrl?: string
	/** The problem the validator found on this node. */
	issue?: { severity: 'error' | 'warning'; message: string } | null
	/** How a node is named in the builder, for the "From …" of wired fields. */
	nodeName?: (id: string) => string
}>()

const emit = defineEmits<{
	(e: 'update:node', n: GraphNode): void
	(e: 'unwire', payload: { field: string }): void
	(e: 'ports:update', payload: { nodeId: string; ports: GroupPort[] }): void
	// Fires when the user clicks the inspector's "Enter subgraph" button on a
	// group node. Editor.vue translates this into a subgraph-path push (same
	// path as double-clicking the group on the canvas).
	(e: 'group:enter', payload: { id: string }): void
	// Fires when the user clicks the inspector's "Delete node" button. Editor.vue
	// removes the node and its edges from the current graph — the same outcome as
	// pressing Delete/Backspace on the canvas, surfaced for discoverability.
	(e: 'delete:node', payload: { id: string }): void
	(e: 'duplicate:node', payload: { id: string }): void
	(e: 'wrap:retry', payload: { id: string }): void
}>()

type InspectorTab = 'settings' | 'run' | 'docs'
const tab = ref<InspectorTab>('settings')

// A node with a run to show opens on it; otherwise on its settings.
watch(
	[() => props.node?.id, () => !!props.runStep],
	([, hasRun]) => {
		tab.value = hasRun && props.runStep?.status === 'failed' ? 'run' : 'settings'
	},
	{ immediate: true },
)

const tabs = computed(() => [
	{ label: t('dms_automation.editor.inspector.settings'), value: 'settings' },
	...(props.runStep
		? [{ label: props.runStep.status === 'failed' ? t('dms_automation.editor.inspector.runFailed') : t('dms_automation.editor.inspector.lastRun'), value: 'run' }]
		: []),
	{ label: t('dms_automation.editor.inspector.docs'), value: 'docs' },
])

const label = computed({
	get: () => ((props.node as (GraphNode & { label?: string }) | null)?.label ?? ''),
	set: (value: string) => {
		if (!props.node) return
		const next = { ...props.node, label: value.trim() ? value : undefined } as GraphNode
		emit('update:node', next)
	},
})

const canWrapInRetry = computed(() => {
	const n = props.node
	return !!n && !props.readOnly && n.kind === 'action'
})

const typeDescription = computed(() => {
	const n = props.node
	if (!n) return ''
	const type = n.kind === 'trigger' ? props.triggerType : n.kind === 'action' ? props.actionType : dataNodeType.value
	return type?.description ? processI18n(type.description) : ''
})

const outputSchema = computed(() => {
	const n = props.node
	if (!n) return null
	if (n.kind === 'trigger') return props.triggerType?.outputSchema ?? null
	if (n.kind === 'action') return props.actionType?.outputSchema ?? null
	if (n.kind === 'data') return dataNodeType.value?.outputSchema ?? null
	return null
})

function unwrap(described: unknown): unknown {
	if (!described || typeof described !== 'object') return described
	if ('value' in described && 'type' in described) return (described as { value: unknown }).value
	return Object.fromEntries(Object.entries(described as Record<string, unknown>).map(([k, v]) => [k, unwrap(v)]))
}

// Sentinel nodes (the group's input/output handles) are auto-managed and
// never user-deletable, mirroring the canvas keyboard-delete guard.
const SENTINEL_KINDS: ReadonlySet<string> = new Set(['groupInput', 'groupOutput'])

const canDelete = computed<boolean>(() => {
	const n = props.node
	if (!n || props.readOnly) return false
	return !SENTINEL_KINDS.has(n.kind)
})

function emitDelete() {
	if (!props.node || !canDelete.value) return
	emit('delete:node', { id: props.node.id })
}

// True when the selected node is a group with a usable subgraph. Template
// instances without an inline subgraph (templateId set, no `subgraph`) can't
// be entered yet — the runtime resolves their subgraph via the template
// cache, but the editor doesn't wire that into navigation.
const canEnterGroup = computed<boolean>(() => {
	const n = props.node
	if (!n || n.kind !== 'group') return false
	const g = n as GraphNode & { templateId?: string; subgraph?: unknown }
	if (g.templateId && !g.subgraph) return false
	return true
})

function emitEnterGroup() {
	if (!props.node) return
	emit('group:enter', { id: props.node.id })
}

// Group ports — surfaced via GroupPortEditor when a group node is selected.
// The editor emits ports:update with the full GroupPort[] array; we bubble
// it up to Editor.vue with the owning node id so the parent can locate the
// group in whichever graph it lives in and run sentinel sync.
const groupPorts = computed<GroupPort[]>(() => {
	const n = props.node
	if (!n || !isGroupNode(n)) return []
	return Array.isArray(n.ports) ? n.ports : []
})

function onGroupPortsUpdate(next: GroupPort[]) {
	if (!props.node || props.node.kind !== 'group') return
	emit('ports:update', { nodeId: props.node.id, ports: next })
}

const dataNodeType = computed<DataNodeType | null>(() => {
	const n = props.node
	if (!n || n.kind !== 'data') return null
	return props.dataNodeTypes.find((d) => d.id === n.typeId) ?? null
})

const schema = computed<JsonSchema | null>(() => {
	const n = props.node
	if (!n) return null
	// Type-registry-backed kinds — their config form comes from the
	// selected type's schema, not the kind's own configSchema.
	if (n.kind === 'trigger') return props.triggerType?.configSchema ?? null
	if (n.kind === 'action') return props.actionType?.inputSchema ?? null
	// Data nodes: merge inputSchema (wired-port fields) with configSchema
	// (in-place config fields, e.g. a constant's value). configSchema wins on
	// key collisions; nodes declaring only one schema are unaffected.
	if (n.kind === 'data') {
		const t = dataNodeType.value
		if (!t) return null
		if (!t.configSchema) return t.inputSchema ?? null
		return {
			type: 'object',
			properties: {
				...(t.inputSchema?.properties ?? {}),
				...(t.configSchema.properties ?? {}),
			},
			required: [
				...(t.inputSchema?.required ?? []),
				...(t.configSchema.required ?? []),
			],
		}
	}
	return (
		(props.nodeKinds.find((k) => k.kind === n.kind)?.meta.ui?.configSchema as
			| JsonSchema
			| undefined) ?? null
	)
})

const fields = computed<
	Array<{ name: string; prop: JsonSchemaProperty }>
>(() => {
	const s = schema.value
	if (!s?.properties) return []
	return Object.entries(s.properties).map(([name, prop]) => ({
		name,
		prop: prop ?? {},
	}))
})

// Type names may be `$`-prefixed DMS i18n keys shipped in the declaring
// module's locales; plain text is shown as written.
const { processI18n } = useTranslation()
const { t } = useI18n()
const typeName = (type: { name: string } | null | undefined) =>
	type ? processI18n(type.name) : undefined

const nodeTypeLabel = computed<string>(() => {
	const n = props.node
	if (!n) return ''
	if (n.kind === 'trigger') return typeName(props.triggerType) ?? n.typeId ?? 'Trigger'
	if (n.kind === 'action') return typeName(props.actionType) ?? n.typeId ?? 'Action'
	if (n.kind === 'data') return typeName(dataNodeType.value) ?? n.typeId ?? 'Data'
	return n.kind
})

function findIncoming(field: string): DataEdge | undefined {
	if (!props.node) return undefined
	const id = props.node.id
	return props.dataEdges.find((e) => e.to.node === id && e.to.field === field)
}

function emitUpdated(field: string, value: unknown) {
	if (!props.node) return
	const next: GraphNode = {
		...props.node,
		config: { ...props.node.config, [field]: value },
	}
	emit('update:node', next)
}

function getValue(field: string): unknown {
	return props.node?.config?.[field]
}

function asString(v: unknown): string {
	if (v === undefined || v === null) return ''
	if (typeof v === 'string') return v
	return String(v)
}

function asNumber(v: unknown): number | undefined {
	if (v === undefined || v === null || v === '') return undefined
	const n = Number(v)
	return Number.isNaN(n) ? undefined : n
}

function asBool(v: unknown): boolean {
	return !!v
}

// Returns true if `prop.type` is `"string"` OR an array of types that includes
// `"string"`. Used to render a plain string input instead of a JSON textarea
// for multi-type fields like compare-node ports.
function isStringish(prop: JsonSchemaProperty): boolean {
	const t = prop.type
	if (t === 'string') return true
	if (Array.isArray(t) && t.includes('string')) return true
	return false
}

function isNumberish(prop: JsonSchemaProperty): boolean {
	const t = prop.type
	if (t === 'number' || t === 'integer') return true
	if (Array.isArray(t) && (t.includes('number') || t.includes('integer')) && !t.includes('string')) return true
	return false
}

function isBoolish(prop: JsonSchemaProperty): boolean {
	const t = prop.type
	if (t === 'boolean') return true
	if (Array.isArray(t) && t.includes('boolean') && !t.includes('string') && !t.includes('number')) return true
	return false
}

function arrayToText(v: unknown): string {
	if (Array.isArray(v)) return v.map((x) => String(x)).join('\n')
	if (typeof v === 'string') return v
	return ''
}

function textToArray(s: string): string[] {
	return s.split('\n').map((x) => x.trim()).filter((x) => x.length > 0)
}


function onUnwire(field: string) {
	emit('unwire', { field })
}
</script>

<template>
	<div class="flex h-full min-h-0 flex-col">
		<div v-if="!node" class="p-4 text-sm text-dimmed">
			{{ $t('dms_automation.editor.inspector.empty') }}
		</div>

		<template v-else>
			<div class="flex flex-col gap-1 border-b border-default px-4 pt-3 pb-2">
				<span class="truncate font-mono text-[10.5px] text-dimmed uppercase">{{ nodeTypeLabel }} · {{ node.id.slice(0, 8) }}</span>
				<UInput
					v-model.lazy="label"
					size="sm"
					variant="ghost"
					:placeholder="nodeTypeLabel"
					:disabled="readOnly"
					:aria-label="$t('dms_automation.editor.inspector.stepName')"
					class="-mx-2 font-medium"
				/>
				<UTabs v-model="tab" :items="tabs" variant="link" size="xs" :content="false" class="-mb-2" />
			</div>
			<div
				v-if="issue"
				class="mx-4 mt-3 flex items-start gap-2 rounded-md px-2 py-1.5 text-xs"
				:class="issue.severity === 'error' ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning'"
			>
				<UIcon name="i-ph-warning" class="mt-0.5 size-3.5 shrink-0" />
				{{ issue.message }}
			</div>

			<div v-if="tab === 'run' && runStep" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
				<div class="flex items-center justify-between gap-2">
					<DmsStatusPill
						:tone="runStep.status === 'failed' ? 'error' : 'success'"
						:label="runStep.status === 'failed' ? $t('dms_automation.runs.status.failed') : $t('dms_automation.runs.status.ok')"
						size="sm"
					/>
					<span class="font-mono text-xs text-muted">{{ describeDuration(runStep.durationMs) }}</span>
				</div>
				<p v-if="runLabel" class="text-xs text-muted">{{ runLabel }}</p>
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.trace.input') }}</span>
					<pre class="max-h-56 overflow-auto rounded-md bg-elevated p-2 font-mono text-xs text-toned">{{ prettyJson(unwrap(runStep.inputs)) || '—' }}</pre>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10.5px] text-dimmed uppercase">
						{{ runStep.status === 'failed' ? $t('dms_automation.trace.error') : $t('dms_automation.trace.output') }}
					</span>
					<pre
						class="max-h-56 overflow-auto rounded-md bg-elevated p-2 font-mono text-xs"
						:class="runStep.status === 'failed' ? 'text-error' : 'text-toned'"
					>{{ runStep.status === 'failed' ? runStep.error : prettyJson(unwrap(runStep.output)) || '—' }}</pre>
				</div>
				<UButton v-if="runTraceUrl" size="xs" variant="ghost" color="neutral" trailing-icon="i-ph-arrow-up-right" :to="runTraceUrl" class="self-start">
					{{ $t('dms_automation.trace.openFull') }}
				</UButton>
			</div>

			<div v-else-if="tab === 'docs'" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
				<p class="text-sm text-toned">{{ typeDescription || $t('dms_automation.editor.inspector.noDocs') }}</p>
				<div class="flex flex-col gap-1">
					<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.library.outputs') }}</span>
					<DmsAutomationSchemaTable :schema="outputSchema" />
				</div>
			</div>

		<div v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
			<UButton
				v-if="canEnterGroup"
				block
				color="primary"
				icon="i-ph-arrow-square-in"
				variant="outline"
				@click="emitEnterGroup"
			>
				{{ $t('dms_automation.editor.inspector.enterSubgraph') }}
			</UButton>

			<div
				v-if="fields.length === 0 && node.kind !== 'group'"
				class="text-xs text-dimmed"
			>
				{{ $t('dms_automation.editor.inspector.noFields') }}
			</div>

			<!-- Group port editor — declared ports drive the sentinel handles
			     inside the subgraph (see syncSentinels in Editor.vue). -->
			<DmsAutomationGroupPortEditor
				v-if="node.kind === 'group'"
				:ports="groupPorts"
				@ports:update="onGroupPortsUpdate"
			/>

			<div
				v-for="f in fields"
				:key="f.name"
				class="flex flex-col gap-1"
			>
				<label class="text-xs font-medium text-highlighted">{{ f.prop.title || f.name }}</label>

				<template v-if="findIncoming(f.name)">
					<DmsAutomationWiredField
						:field="f.name"
						:source="{
							node: findIncoming(f.name)!.from.node,
							port: findIncoming(f.name)!.from.port,
						}"
						:source-label="nodeName ? nodeName(findIncoming(f.name)!.from.node) : findIncoming(f.name)!.from.node"
						@unwire="onUnwire(f.name)"
					/>
				</template>

				<template v-else>
					<USelect
						v-if="Array.isArray(f.prop.enum) && f.prop.enum.length > 0"
						:items="(f.prop.enum as unknown[]).map((v) => String(v))"
						:model-value="asString(getValue(f.name) ?? f.prop.default)"
						@update:model-value="(v: string) => emitUpdated(f.name, v)"
					/>
					<UInput
						v-else-if="isStringish(f.prop)"
						:model-value="asString(getValue(f.name))"
						@update:model-value="(v: string | number) => emitUpdated(f.name, String(v))"
					/>
					<UInput
						v-else-if="isNumberish(f.prop)"
						type="number"
						:model-value="asNumber(getValue(f.name))"
						@update:model-value="(v: string | number) => emitUpdated(f.name, asNumber(v))"
					/>
					<USwitch
						v-else-if="isBoolish(f.prop)"
						:model-value="asBool(getValue(f.name))"
						@update:model-value="(v: boolean) => emitUpdated(f.name, v)"
					/>
					<UTextarea
						v-else-if="f.prop.type === 'array'"
						:rows="3"
						:placeholder="$t('dms_automation.editor.inspector.arrayPlaceholder')"
						:model-value="arrayToText(getValue(f.name))"
						@update:model-value="(v: string | number) => emitUpdated(f.name, textToArray(String(v)))"
					/>
					<JsonField
						v-else
						:model-value="getValue(f.name)"
						@update:model-value="(v: unknown) => emitUpdated(f.name, v)"
					/>
				</template>

				<p v-if="f.prop.description" class="text-xs text-dimmed">
					{{ processI18n(f.prop.description) }}
				</p>
			</div>

			<div v-if="canWrapInRetry" class="flex flex-col gap-1.5 rounded-md border border-default p-3">
				<span class="text-xs font-medium text-highlighted">{{ $t('dms_automation.editor.inspector.ifItFails') }}</span>
				<span class="text-xs text-muted">{{ $t('dms_automation.editor.inspector.ifItFailsHint') }}</span>
				<UButton size="xs" variant="soft" color="neutral" icon="i-ph-arrow-counter-clockwise" class="self-start" @click="emit('wrap:retry', { id: node.id })">
					{{ $t('dms_automation.editor.inspector.wrapInRetry') }}
				</UButton>
			</div>
			<p v-if="node.kind === 'action' && node.typeId === 'http.request'" class="text-xs text-dimmed">
				{{ $t('dms_automation.editor.inspector.credentialsHint') }}
			</p>
			<div v-if="canDelete" class="mt-1 flex gap-2">
				<UButton size="sm" color="neutral" icon="i-ph-copy" variant="outline" @click="emit('duplicate:node', { id: node.id })">
					{{ $t('dms_automation.editor.inspector.duplicate') }}
				</UButton>
				<UButton size="sm" color="error" icon="i-ph-trash" variant="soft" @click="emitDelete">
					{{ $t('dms_automation.editor.inspector.deleteNode') }}
				</UButton>
			</div>
		</div>
		</template>
	</div>
</template>
