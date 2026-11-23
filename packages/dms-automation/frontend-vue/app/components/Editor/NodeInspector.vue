<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TraceStep } from '../../composables/useAutomationRuns'
import { describeDateTime } from '../../utils/describe'
import JsonField from './JsonField.vue'
import { isJsonValue, isText } from './jsonValue'
import type { JsonValue } from './jsonValue'
import NodeInspectorDocs from '../../build/components/editor/NodeInspectorDocs.vue'
import NodeInspectorRun from '../../build/components/editor/NodeInspectorRun.vue'
import {
	arrayToText,
	asBool,
	asNumber,
	asString,
	dataNodeSchema,
	isBoolish,
	nameInWords,
	isNumberish,
	isStringish,
	portsSchema,
	textToArray,
} from '../../build/utils/inspectorFields'
import type { GraphIssue } from '../../build/types/editor'
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
	dataNodeTypes: DataNodeType[]
	nodeKinds: NodeKindEntry[]
	readOnly?: boolean
	/** The node's step in the run shown over the canvas, for the "Last run" tab. */
	runStep?: TraceStep | null
	/** Says which run that is ("Test run · just now", "Run 8f3a2c · 14:28"). */
	runLabel?: string
	/** Opens the trace of that run. */
	runTraceUrl?: string
	/** The problem the validator found on this node (`code` translated, `message` as fallback). */
	issue?: GraphIssue | null
	/** How a node is named in the builder, for the "From …" of wired fields. */
	nodeName?: (id: string) => string
	/** The saved graph's triggers, with the next time a schedule fires. */
	savedTriggers?: Array<{ nodeId: string; cron?: string; timeZone?: string; nextAt: string | null }>
}>()

const emit = defineEmits<{
	(e: 'update:node', n: GraphNode): void
	(e: 'unwire', payload: { field: string }): void
	(e: 'ports:update', payload: { nodeId: string; ports: GroupPort[] }): void
	(e: 'group:enter', payload: { id: string }): void
	(e: 'delete:node', payload: { id: string }): void
	(e: 'duplicate:node', payload: { id: string }): void
	(e: 'wrap:retry', payload: { id: string }): void
	(e: 'close'): void
}>()

type InspectorTab = 'settings' | 'run' | 'docs'
const tab = ref<InspectorTab>('settings')

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
	get: () => {
		const n = props.node
		return n?.label || (n?.kind === 'group' ? String(n.config?.name ?? '') : '')
	},
	set: (value: string) => {
		if (!props.node) return
		const next: GraphNode = { ...props.node, label: value.trim() ? value : undefined }
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
	if (type?.description) return processI18n(type.description)
	const key = `dms_automation.nodes.docs.${n.kind}`
	return te(key) ? t(key) : ''
})

const kindUi = computed(() => props.nodeKinds.find((k) => k.kind === props.node?.kind)?.meta.ui)

const inputSchema = computed<JsonSchema | null>(() => {
	const n = props.node
	if (!n || n.kind === 'trigger' || n.kind === 'action' || n.kind === 'data') return schema.value
	const ui = kindUi.value
	if (!ui) return null
	const own = portsSchema(ui.staticDataIns)
	return { properties: { ...own.properties, ...ui.configSchema?.properties } }
})

const outputSchema = computed(() => {
	const n = props.node
	if (!n) return null
	if (n.kind === 'trigger') return props.triggerType?.outputSchema ?? null
	if (n.kind === 'action') return props.actionType?.outputSchema ?? null
	if (n.kind === 'data') return dataNodeType.value?.outputSchema ?? null
	return kindUi.value ? portsSchema(kindUi.value.staticDataOuts) : null
})

const branches = computed(() => kindUi.value?.staticTriggerOuts ?? [])

const templateId = computed(() => props.node?.templateId)

const issueText = computed(() => {
	const issue = props.issue
	if (!issue) return ''
	const key = `dms_automation.editor.problems.codes.${issue.code}`
	if (!issue.code || !te(key)) return issue.message
	const field = issue.params?.field
	const prop = isText(field) ? schema.value?.properties?.[field] : undefined
	return t(key, prop ? { ...issue.params, label: fieldLabel(String(field), prop) } : (issue.params ?? {}))
})

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

const canEnterGroup = computed<boolean>(() => {
	const n = props.node
	if (!n || n.kind !== 'group') return false
	if (n.templateId && !n.subgraph) return false
	return true
})

function emitEnterGroup() {
	if (!props.node) return
	emit('group:enter', { id: props.node.id })
}

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
	if (n.kind === 'trigger') return props.triggerType?.configSchema ?? null
	if (n.kind === 'action') return props.actionType?.inputSchema ?? null
	if (n.kind === 'data') {
		const t = dataNodeType.value
		if (!t) return null
		return dataNodeSchema(t)
	}
	return kindUi.value?.configSchema ?? null
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

const { processI18n } = useTranslation()
const i18n = useI18n()
const { t } = i18n
const te = (key: string) => i18n.te(key)
const { dateTimeFormat } = useRegionalFormat()
const typeName = (type: { name: string } | null | undefined) =>
	type ? processI18n(type.name) : undefined

const nodeTypeLabel = computed<string>(() => {
	const n = props.node
	if (!n) return ''
	if (n.kind === 'trigger') return typeName(props.triggerType) ?? n.typeId ?? 'Trigger'
	if (n.kind === 'action') return typeName(props.actionType) ?? n.typeId ?? 'Action'
	if (n.kind === 'data') return typeName(dataNodeType.value) ?? n.typeId ?? 'Data'
	if (n.kind === 'group') return t('dms_automation.nodes.role.group')
	return kindUi.value?.label ? processI18n(kindUi.value.label) : n.kind
})

function fieldLabel(name: string, prop: JsonSchemaProperty): string {
	if (prop.title?.startsWith('$')) return processI18n(prop.title)
	const key = `dms_automation.editor.inspector.fields.${name}`
	if (te(key)) return t(key)
	if (prop.title) return prop.title
	return nameInWords(name)
}

const nextRunText = computed(() => {
	const n = props.node
	const cron = n?.config?.cron
	if (!n || n.kind !== 'trigger' || !isText(cron) || !cron) return ''
	const saved = props.savedTriggers?.find((tr) => tr.nodeId === n.id)
	if (saved?.cron !== cron) return t('dms_automation.editor.inspector.nextRunAfterSave')
	if (!saved.nextAt) return ''
	return t('dms_automation.editor.inspector.nextRun', {
		when: describeDateTime(saved.nextAt, dateTimeFormat, saved.timeZone),
		zone: saved.timeZone ?? '',
	})
})

function isRequired(name: string): boolean {
	return schema.value?.required?.includes(name) ?? false
}

function descriptionParts(text: string): Array<{ text: string; code: boolean }> {
	return processI18n(text)
		.split('`')
		.map((part, i) => ({ text: part, code: i % 2 === 1 }))
		.filter((part) => part.text !== '')
}

function findIncoming(field: string): DataEdge | undefined {
	if (!props.node) return undefined
	const id = props.node.id
	return props.dataEdges.find((e) => e.to.node === id && e.to.field === field)
}

function emitUpdated(field: string, value: JsonValue | undefined) {
	if (!props.node) return
	const next: GraphNode = {
		...props.node,
		config: { ...props.node.config, [field]: value },
	}
	emit('update:node', next)
}

function getValue(field: string): JsonValue | undefined {
	const value = props.node?.config?.[field]
	return isJsonValue(value) ? value : undefined
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
				<div class="flex items-center gap-1">
					<span class="truncate font-mono text-[10.5px] text-dimmed uppercase">{{ nodeTypeLabel }}</span>
					<!-- The span gives the tooltip a plain element: DMS components load
					     asynchronously and can't be its trigger. -->
					<UTooltip :text="$t('dms_automation.editor.inspector.copyId')">
						<span class="-my-1.5 ms-auto inline-flex">
							<DmsCopyButton :value="node.id" />
						</span>
					</UTooltip>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						icon="i-ph-x"
						class="-my-1.5"
						:aria-label="$t('dms_automation.editor.closeInspector')"
						@click="emit('close')"
					/>
				</div>
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
				{{ issueText }}
			</div>

			<NodeInspectorRun
				v-if="tab === 'run' && runStep"
				:run-step="runStep"
				:run-label="runLabel"
				:run-trace-url="runTraceUrl"
			/>

			<NodeInspectorDocs
				v-else-if="tab === 'docs'"
				:description="typeDescription"
				:input-schema="inputSchema"
				:branches="branches"
				:output-schema="outputSchema"
			/>

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

			<DmsAutomationWebhookEndpoint
				v-if="node.kind === 'trigger' && node.typeId === 'webhook' && typeof node.config.path === 'string' && node.config.path"
				:path="node.config.path"
				:method="typeof node.config.method === 'string' ? node.config.method : undefined"
			/>

			<div
				v-if="fields.length === 0 && node.kind !== 'group'"
				class="text-xs text-dimmed"
			>
				{{ $t('dms_automation.editor.inspector.noFields') }}
			</div>

			<div v-if="templateId" class="flex flex-col gap-1.5 rounded-md border border-default p-3">
				<span class="text-xs text-muted">{{ $t('dms_automation.editor.inspector.templateInstance') }}</span>
				<UButton
					size="xs"
					variant="soft"
					color="neutral"
					icon="i-ph-pencil-simple"
					:to="`/modules/automation/builder?template=${templateId}`"
					class="self-start"
				>
					{{ $t('dms_automation.editor.inspector.editTemplate') }}
				</UButton>
			</div>

			<!-- Group port editor — declared ports drive the sentinel handles
			     inside the subgraph (see syncSentinels in Editor.vue). A
			     template instance shows the template's ports, read-only. -->
			<DmsAutomationGroupPortEditor
				v-if="node.kind === 'group'"
				:ports="groupPorts"
				:read-only="readOnly || !!templateId"
				@ports:update="onGroupPortsUpdate"
			/>

			<DmsFieldRow
				v-for="f in fields"
				:key="f.name"
				layout="stack"
				spacing="list"
				:inset="false"
				:label="fieldLabel(f.name, f.prop)"
				:required="isRequired(f.name)"
				:label-for="findIncoming(f.name) || isBoolish(f.prop) ? undefined : `inspector-${f.name}`"
			>
				<template v-if="f.prop.description" #details>
					<p class="mt-0.5 text-[12.5px] leading-normal text-muted">
						<template v-for="(part, i) in descriptionParts(f.prop.description)" :key="i">
							<code v-if="part.code" class="rounded bg-elevated px-1 font-mono text-[11.5px] text-toned">{{ part.text }}</code>
							<template v-else>{{ part.text }}</template>
						</template>
					</p>
				</template>
				<DmsAutomationWiredField
					v-if="findIncoming(f.name)"
					:source="{
						node: findIncoming(f.name)!.from.node,
						port: findIncoming(f.name)!.from.port,
					}"
					:source-label="nodeName ? nodeName(findIncoming(f.name)!.from.node) : findIncoming(f.name)!.from.node"
					@unwire="onUnwire(f.name)"
				/>
				<DmsInputSelect
					v-else-if="Array.isArray(f.prop.enum) && f.prop.enum.length > 0"
					:id="`inspector-${f.name}`"
					:items="(f.prop.enum as unknown[]).map((v) => ({ label: String(v), value: String(v) }))"
					:model-value="asString(getValue(f.name) ?? f.prop.default)"
					class="w-full"
					@update:model-value="(v: string) => emitUpdated(f.name, v)"
				/>
				<DmsInputText
					v-else-if="isStringish(f.prop)"
					:id="`inspector-${f.name}`"
					:model-value="asString(getValue(f.name))"
					class="w-full"
					@update:model-value="(v: string | number) => emitUpdated(f.name, String(v))"
				/>
				<DmsInputNumber
					v-else-if="isNumberish(f.prop)"
					:id="`inspector-${f.name}`"
					:model-value="asNumber(getValue(f.name))"
					class="w-full"
					@update:model-value="(v: number | null | undefined) => emitUpdated(f.name, asNumber(v))"
				/>
				<DmsInputSwitch
					v-else-if="isBoolish(f.prop)"
					:model-value="asBool(getValue(f.name) ?? f.prop.default)"
					@update:model-value="(v: boolean) => emitUpdated(f.name, v)"
				/>
				<DmsInputTextarea
					v-else-if="f.prop.type === 'array'"
					:id="`inspector-${f.name}`"
					:rows="3"
					:placeholder="$t('dms_automation.editor.inspector.arrayPlaceholder')"
					:model-value="arrayToText(getValue(f.name))"
					class="w-full"
					@update:model-value="(v: string | number) => emitUpdated(f.name, textToArray(String(v)))"
				/>
				<JsonField
					v-else
					:model-value="getValue(f.name)"
					@update:model-value="(v: JsonValue | undefined) => emitUpdated(f.name, v)"
				/>
				<p v-if="f.name === 'cron' && nextRunText" class="text-xs text-muted">{{ nextRunText }}</p>
			</DmsFieldRow>

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
				<UTooltip :text="$t('dms_automation.editor.inspector.duplicate')" :kbds="['meta', 'd']">
					<UButton size="sm" color="neutral" icon="i-ph-copy" variant="outline" @click="emit('duplicate:node', { id: node.id })">
						{{ $t('dms_automation.editor.inspector.duplicate') }}
					</UButton>
				</UTooltip>
				<UButton size="sm" color="error" icon="i-ph-trash" variant="soft" @click="emitDelete">
					{{ $t('dms_automation.editor.inspector.deleteNode') }}
				</UButton>
			</div>
		</div>
		</template>
	</div>
</template>
