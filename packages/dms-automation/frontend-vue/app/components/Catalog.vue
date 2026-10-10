<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { describeCron } from '../utils/describe'

// One catalog of the library (triggers, actions or data nodes): its types
// grouped by the module that registered them, and the picked one's detail —
// where it is used first, then what disabling it does, its settings, inputs
// and outputs as tables, and its global configuration under "Advanced".

type CatalogKind = 'triggers' | 'actions' | 'dataNodes'

interface JsonSchema {
	properties?: Record<string, unknown>
	required?: string[]
}

interface CatalogEntry {
	id: string
	name: string
	description?: string
	icon?: string
	module?: string
	category?: string
	cluster?: 'replicated' | 'singleton'
	configSchema?: JsonSchema
	inputSchema?: JsonSchema
	outputSchema?: JsonSchema
	enabled?: boolean
	globalConfig?: string
}

interface TypeUsage {
	procedureId: string
	procedureName: string
	enabled: boolean
	state: 'failing' | 'degraded' | 'healthy' | 'paused' | 'draft'
	nodeId: string
	nodeLabel: string | null
	method?: string
	path?: string
	cron?: string
}

const props = defineProps<{
	kind: CatalogKind
	apiUrl: string
	builderUrl: string
}>()

const ENDPOINTS: Record<CatalogKind, string> = {
	triggers: 'trigger-types',
	actions: 'action-types',
	dataNodes: 'data-node-types',
}

const STATE_TONES = {
	failing: 'error',
	degraded: 'warning',
	healthy: 'success',
	paused: 'neutral',
	draft: 'info',
} as const

const { $authFetch } = useAuthFetch()
const { processI18n } = useTranslation()
const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const router = useDmsRouter()

const entries = ref<CatalogEntry[]>([])
const usage = ref<Record<string, TypeUsage[]>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const query = ref('')
const configText = ref('{}')
const configError = ref<string | null>(null)
const CONFIG_ID = 'catalog-global-config'
const saving = ref(false)

const configurable = computed(() => props.kind !== 'dataNodes')

async function load() {
	loading.value = true
	try {
		const [list, uses] = await Promise.all([
			$authFetch<CatalogEntry[]>(`${props.apiUrl}/${ENDPOINTS[props.kind]}`),
			$authFetch<Record<string, TypeUsage[]>>(`${props.apiUrl}/library/usage/${props.kind}`),
		])
		entries.value = list
		usage.value = uses
		error.value = null
		if (!selectedId.value || !list.some((e) => e.id === selectedId.value)) {
			selectedId.value = groups.value[0]?.[1][0]?.id ?? null
		}
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

onMounted(load)

function groupOf(entry: CatalogEntry): string {
	if (props.kind === 'dataNodes') return entry.category ?? t('dms_automation.library.other')
	return entry.module ?? t('dms_automation.library.builtIn')
}

const groups = computed(() => {
	const q = query.value.trim().toLowerCase()
	const visible = entries.value.filter(
		(e) =>
			!q ||
			e.id.toLowerCase().includes(q) ||
			processI18n(e.name).toLowerCase().includes(q) ||
			processI18n(e.description ?? '').toLowerCase().includes(q),
	)
	const map = new Map<string, CatalogEntry[]>()
	for (const entry of visible) {
		const group = groupOf(entry)
		map.set(group, [...(map.get(group) ?? []), entry])
	}
	const builtIn = t('dms_automation.library.builtIn')
	return [...map.entries()].sort(([a], [b]) => (a === builtIn ? -1 : b === builtIn ? 1 : a.localeCompare(b)))
})

const selected = computed(() => entries.value.find((e) => e.id === selectedId.value) ?? null)
const uses = computed(() => (selected.value ? (usage.value[selected.value.id] ?? []) : []))
const procedureCount = computed(() => new Set(uses.value.map((u) => u.procedureId)).size)
const enabledUses = computed(() => new Set(uses.value.filter((u) => u.enabled).map((u) => u.procedureId)).size)

watch(selected, (entry) => {
	configText.value = prettyConfig(entry?.globalConfig)
	configError.value = null
})

function prettyConfig(raw: string | undefined): string {
	try {
		return JSON.stringify(JSON.parse(raw || '{}'), null, 2)
	} catch {
		return raw ?? '{}'
	}
}

function useCount(id: string): number {
	return new Set((usage.value[id] ?? []).map((u) => u.procedureId)).size
}

const settingsSchema = computed(() => (props.kind === 'actions' ? selected.value?.inputSchema : selected.value?.configSchema))
const inputSchema = computed(() => (props.kind === 'dataNodes' ? selected.value?.inputSchema : undefined))

async function saveConfig(enabled: boolean, config: string) {
	const entry = selected.value
	if (!entry) return
	saving.value = true
	try {
		await $authFetch(`${props.apiUrl}/${ENDPOINTS[props.kind]}/${encodeURIComponent(entry.id)}/config`, {
			method: 'PUT',
			body: { enabled, config },
		})
		entry.enabled = enabled
		entry.globalConfig = config
		toast.add({
			title: t(enabled ? 'dms_automation.library.enabledToast' : 'dms_automation.library.disabledToast', {
				name: processI18n(entry.name),
			}),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
	} catch (e) {
		toast.add({ title: t('dms_automation.common.actionFailed'), description: (e as Error).message, color: 'error', icon: 'i-ph-warning' })
	} finally {
		saving.value = false
	}
}

async function toggleEnabled(enabled: boolean) {
	const entry = selected.value
	if (!entry) return
	if (!enabled && enabledUses.value > 0) {
		const ok = await confirm({
			title: t('dms_automation.library.disableTitle', { name: processI18n(entry.name) }),
			description: t('dms_automation.library.disableImpact', { count: enabledUses.value }),
			color: 'warning',
			confirmLabel: t('dms_automation.library.disable'),
		})
		if (!ok) return
	}
	await saveConfig(enabled, entry.globalConfig ?? '{}')
}

async function saveAdvanced() {
	try {
		JSON.parse(configText.value || '{}')
		configError.value = null
	} catch (e) {
		configError.value = (e as Error).message
		return
	}
	await saveConfig(selected.value?.enabled ?? true, configText.value || '{}')
}

function where(use: TypeUsage): string {
	if (use.path) return `${use.method ?? 'POST'} ${use.path}`
	if (use.cron) return describeCron(use.cron, processI18n)
	return use.nodeLabel ?? use.nodeId
}

function open(use: TypeUsage) {
	void router.push(`${props.builderUrl}?selected=${use.procedureId}&node=${encodeURIComponent(use.nodeId)}`)
}
</script>

<template>
	<div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
		<div class="dms-card flex flex-col gap-2 p-2">
			<DmsSearchInput
				v-model="query"
				size="sm"
				:placeholder="$t('dms_automation.library.search')"
				class="w-full"
			/>
			<div v-if="loading && entries.length === 0" class="flex flex-col gap-2 p-1">
				<USkeleton v-for="i in 4" :key="i" class="h-12 w-full" />
			</div>
			<DmsEmptyState
				v-else-if="error"
				size="sm"
				variant="error"
				:title="$t('dms_automation.library.loadError')"
				:description="error"
				:actions="[{ label: $t('dms_automation.common.retry'), onClick: load }]"
			/>
			<template v-else>
				<div v-for="[group, items] in groups" :key="group" class="flex flex-col gap-1">
					<p class="px-2.5 pt-2 pb-0.5 font-mono text-[10px] tracking-widest text-dimmed uppercase">{{ group }}</p>
					<button
						v-for="entry in items"
						:key="entry.id"
						type="button"
						class="flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors"
						:class="entry.id === selectedId ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-elevated'"
						@click="selectedId = entry.id"
					>
						<UIcon :name="entry.icon || 'i-ph-cube'" class="mt-0.5 size-4 shrink-0 text-muted" />
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="flex items-center gap-2">
								<span class="truncate text-sm font-medium text-highlighted">{{ processI18n(entry.name) }}</span>
								<UBadge v-if="entry.enabled === false" size="sm" color="neutral" variant="subtle">
									{{ $t('dms_automation.library.off') }}
								</UBadge>
							</span>
							<span v-if="entry.description" class="truncate text-xs text-muted">{{ processI18n(entry.description) }}</span>
						</span>
						<span class="shrink-0 font-mono text-[11px] text-dimmed">
							{{ $t('dms_automation.library.uses', { count: useCount(entry.id) }) }}
						</span>
					</button>
				</div>
				<p v-if="groups.length === 0" class="p-3 text-center text-xs text-dimmed">{{ $t('dms_automation.library.noMatch') }}</p>
			</template>
		</div>

		<div v-if="selected" class="flex flex-col gap-4">
			<DmsCard>
				<div class="flex flex-wrap items-start gap-4">
					<DmsIconWell :icon="selected.icon || 'i-ph-cube'" tone="primary" size="xl" />
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="text-lg font-semibold text-highlighted">{{ processI18n(selected.name) }}</h2>
							<UBadge size="sm" color="neutral" variant="outline">{{ groupOf(selected) }}</UBadge>
						</div>
						<p v-if="selected.description" class="text-sm text-muted">{{ processI18n(selected.description) }}</p>
						<p class="font-mono text-xs text-dimmed">
							id · {{ selected.id }}
							<template v-if="selected.cluster"> · cluster · {{ selected.cluster }}</template>
						</p>
					</div>
					<div v-if="configurable" class="flex items-center gap-2">
						<span class="text-sm text-muted">{{ $t('dms_automation.library.enabled') }}</span>
						<USwitch :model-value="selected.enabled !== false" :loading="saving" @update:model-value="toggleEnabled" />
					</div>
				</div>
			</DmsCard>

			<DmsCard :title="$t('dms_automation.library.usedBy')" :count="procedureCount">
				<p v-if="configurable && enabledUses > 0" class="mb-3 text-xs text-muted">
					{{ $t('dms_automation.library.disableImpact', { count: enabledUses }) }}
				</p>
				<ul v-if="uses.length" class="divide-y divide-default">
					<li v-for="use in uses" :key="`${use.procedureId}-${use.nodeId}`" class="flex items-center gap-3 py-2">
						<DmsStatusPill :tone="STATE_TONES[use.state]" :label="$t(`dms_automation.procedures.status.${use.state}`)" size="sm" />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm text-highlighted">{{ use.procedureName }}</span>
							<span class="block truncate font-mono text-xs text-muted">{{ where(use) }}</span>
						</span>
						<DmsCopyButton v-if="use.path" :value="use.path" />
						<UButton size="xs" variant="ghost" color="neutral" trailing-icon="i-ph-arrow-up-right" @click="open(use)">
							{{ $t('dms_automation.library.open') }}
						</UButton>
					</li>
				</ul>
				<p v-else class="text-xs text-dimmed">{{ $t('dms_automation.library.unused') }}</p>
			</DmsCard>

			<DmsCard v-if="settingsSchema" :title="kind === 'actions' ? $t('dms_automation.library.inputs') : $t('dms_automation.library.settings')">
				<p class="mb-3 text-xs text-muted">{{ $t('dms_automation.library.settingsHint') }}</p>
				<DmsAutomationSchemaTable :schema="settingsSchema" />
			</DmsCard>

			<DmsCard v-if="inputSchema" :title="$t('dms_automation.library.inputs')">
				<DmsAutomationSchemaTable :schema="inputSchema" />
			</DmsCard>

			<DmsCard :title="$t('dms_automation.library.outputs')">
				<DmsAutomationSchemaTable :schema="selected.outputSchema" />
			</DmsCard>

			<DmsBanner
				v-if="selected.cluster"
				size="sm"
				tone="info"
				icon="i-ph-hard-drives"
				:title="$t(`dms_automation.library.cluster.${selected.cluster}`)"
				:description="$t(`dms_automation.library.cluster.${selected.cluster}Hint`)"
			/>

			<UCollapsible v-if="configurable" class="dms-card">
				<UButton variant="ghost" color="neutral" block class="justify-between px-4 py-3" trailing-icon="i-ph-caret-down">
					{{ $t('dms_automation.library.advanced') }}
				</UButton>
				<template #content>
					<div class="flex flex-col gap-3 border-t border-default p-4">
						<p class="text-xs text-muted">{{ $t('dms_automation.library.advancedHint') }}</p>
						<DmsInputCode
							:id="CONFIG_ID"
							v-model="configText"
							language="json"
							:min-lines="6"
							:max-lines="16"
							:aria-invalid="!!configError || undefined"
							:aria-describedby="configError ? `${CONFIG_ID}-error` : undefined"
						/>
						<DmsFieldError :id="`${CONFIG_ID}-error`" :message="configError" />
						<div class="flex justify-end">
							<UButton color="primary" :loading="saving" @click="saveAdvanced">{{ $t('dms_automation.common.save') }}</UButton>
						</div>
					</div>
				</template>
			</UCollapsible>
		</div>
		<DmsEmptyState
			v-else-if="!loading && !error"
			:title="$t('dms_automation.library.nothingSelected')"
			:description="$t('dms_automation.library.nothingSelectedHint')"
		/>
	</div>
</template>
