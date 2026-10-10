<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { unwrapList } from '../utils/automation'

// The library's templates: reusable groups other procedures place as linked
// blocks. The detail edits the name, icon and description, lists the ports
// (edited inside the graph) and where the template is used; deleting forks
// every usage into a local group so the procedures keep working.

interface JsonSchema {
	type?: string | string[]
	[key: string]: unknown
}

interface TemplatePort {
	name: string
	kind: 'data' | 'trigger'
	direction: 'in' | 'out'
	schema?: JsonSchema
}

interface TemplateRow {
	_id: string
	name: string
	description: string
	icon: string
	ports: TemplatePort[]
	subgraph: unknown
	usageCount?: number
	updated_at?: string
}

interface TemplateUsage {
	procedureId: string
	nodeId: string
}

interface ProcedureSummary {
	procedureId: string
	name: string
	status: 'failing' | 'degraded' | 'healthy' | 'paused' | 'draft'
}

const props = defineProps<{
	apiUrl: string
	builderUrl: string
}>()

const DEFAULT_ICON = 'i-ph-package'
const STATE_TONES = {
	failing: 'error',
	degraded: 'warning',
	healthy: 'success',
	paused: 'neutral',
	draft: 'info',
} as const

const { $authFetch } = useAuthFetch()
const router = useDmsRouter()
const toast = useToast()
const { t } = useI18n()
const { confirm } = useConfirm()

const items = ref<TemplateRow[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const search = ref('')

const formName = ref('')
const formDescription = ref('')
const formIcon = ref(DEFAULT_ICON)
const saving = ref(false)

const usages = ref<TemplateUsage[]>([])
const usagesLoading = ref(false)
const procedures = ref<Map<string, ProcedureSummary>>(new Map())

async function loadList() {
	loading.value = true
	try {
		const list = unwrapList<TemplateRow>(await $authFetch(`${props.apiUrl}/templates`))
		items.value = list
		if (!selectedId.value || !list.some((x) => x._id === selectedId.value)) {
			selectedId.value = list[0]?._id ?? null
		}
		loadError.value = null
	} catch (e) {
		loadError.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

async function loadProcedures() {
	try {
		const rows = unwrapList<ProcedureSummary>(await $authFetch(`${props.apiUrl}/procedures/summary`))
		procedures.value = new Map(rows.map((p) => [p.procedureId, p]))
	} catch {
		procedures.value = new Map()
	}
}

onMounted(() => {
	void loadList()
	void loadProcedures()
})

const selected = computed(() => items.value.find((x) => x._id === selectedId.value) ?? null)

const filteredItems = computed(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return items.value
	return items.value.filter((x) => x.name.toLowerCase().includes(q) || (x.description ?? '').toLowerCase().includes(q))
})

const dirty = computed(() => {
	const s = selected.value
	if (!s) return false
	return formName.value !== s.name || formDescription.value !== (s.description ?? '') || formIcon.value !== (s.icon || DEFAULT_ICON)
})

watch(
	selected,
	(s) => {
		formName.value = s?.name ?? ''
		formDescription.value = s?.description ?? ''
		formIcon.value = s?.icon || DEFAULT_ICON
		void loadUsages()
	},
	{ immediate: true },
)

async function loadUsages() {
	const s = selected.value
	usages.value = []
	if (!s) return
	usagesLoading.value = true
	try {
		usages.value = unwrapList<TemplateUsage>(await $authFetch(`${props.apiUrl}/templates/${s._id}/usages`))
	} catch {
		usages.value = []
	} finally {
		usagesLoading.value = false
	}
}

const NAME_ID = 'template-name'
// A missing name shows under its field; a refused save is a toast.
const fieldErrors = useFieldErrors({ fields: { name: NAME_ID } })
watch(formName, () => fieldErrors.clear('name'))

async function onSave() {
	const s = selected.value
	if (!s) return
	if (!formName.value.trim()) {
		await fieldErrors.setError('name', t('dms_automation.templates.form.nameRequired'))
		return
	}
	saving.value = true
	try {
		const updated = await $authFetch<TemplateRow>(`${props.apiUrl}/templates/${s._id}`, {
			method: 'PUT',
			body: {
				name: formName.value.trim(),
				description: formDescription.value,
				icon: formIcon.value || DEFAULT_ICON,
				ports: s.ports ?? [],
				subgraph: s.subgraph ?? { nodes: [], triggerEdges: [], dataEdges: [] },
			},
		})
		const index = items.value.findIndex((x) => x._id === s._id)
		if (index >= 0) items.value[index] = { ...s, ...updated, usageCount: s.usageCount }
		toast.add({ title: t('dms_automation.templates.saved', { name: updated.name }), color: 'success', icon: 'i-ph-check-circle' })
	} catch (e) {
		toast.add({ title: t('dms_automation.templates.saveError'), description: (e as Error).message, color: 'error', icon: 'i-ph-warning' })
	} finally {
		saving.value = false
	}
}

function editGraph() {
	const s = selected.value
	if (s) void router.push(`${props.builderUrl}?template=${s._id}`)
}

function openUsage(usage: TemplateUsage) {
	void router.push(`${props.builderUrl}?selected=${usage.procedureId}&node=${encodeURIComponent(usage.nodeId)}`)
}

async function onDelete() {
	const s = selected.value
	if (!s) return
	const used = (s.usageCount ?? 0) > 0
	await confirm({
		title: t('dms_automation.templates.deleteTitle', { name: s.name }),
		description: used
			? t('dms_automation.templates.deleteForks', { count: s.usageCount ?? 0 })
			: t('dms_automation.templates.deleteUnused'),
		color: 'error',
		icon: 'i-ph-trash',
		confirmLabel: t('dms_automation.templates.delete'),
		onConfirm: async () => {
			await $authFetch(`${props.apiUrl}/templates/${s._id}${used ? '?force=1' : ''}`, { method: 'DELETE' })
			toast.add({ title: t('dms_automation.templates.deleted', { name: s.name }), color: 'success', icon: 'i-ph-check-circle' })
			items.value = items.value.filter((x) => x._id !== s._id)
			selectedId.value = items.value[0]?._id ?? null
		},
	})
}

function schemaTypeOf(p: TemplatePort): string {
	if (p.kind !== 'data') return '—'
	const type = p.schema?.type
	if (typeof type === 'string') return type
	if (Array.isArray(type)) return type.join(' | ')
	return 'any'
}
</script>

<template>
	<div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
		<div class="dms-card flex flex-col gap-2 p-2">
			<DmsSearchInput v-model="search" size="sm" :placeholder="$t('dms_automation.templates.search')" class="w-full" />
			<div v-if="loading && items.length === 0" class="flex flex-col gap-2 p-1">
				<USkeleton v-for="i in 3" :key="i" class="h-12 w-full" />
			</div>
			<DmsEmptyState
				v-else-if="loadError"
				size="sm"
				variant="error"
				:title="$t('dms_automation.templates.loadError')"
				:description="loadError"
				:actions="[{ label: $t('dms_automation.common.retry'), onClick: loadList }]"
			/>
			<DmsEmptyState
				v-else-if="items.length === 0"
				size="sm"
				icon="i-ph-stack"
				:title="$t('dms_automation.templates.empty')"
				:description="$t('dms_automation.templates.emptyHint')"
			/>
			<template v-else>
			<button
				v-for="row in filteredItems"
				:key="row._id"
				type="button"
				class="flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors"
				:class="row._id === selectedId ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-elevated'"
				@click="selectedId = row._id"
			>
				<UIcon :name="row.icon || DEFAULT_ICON" class="mt-0.5 size-4 shrink-0 text-muted" />
				<span class="flex min-w-0 flex-1 flex-col">
					<span class="truncate text-sm font-medium text-highlighted">{{ row.name }}</span>
					<span v-if="row.description" class="truncate text-xs text-muted">{{ row.description }}</span>
				</span>
				<span class="shrink-0 font-mono text-[11px] text-dimmed">{{ $t('dms_automation.library.uses', { count: row.usageCount ?? 0 }) }}</span>
			</button>
			</template>
		</div>

		<div v-if="selected" class="flex flex-col gap-4">
			<DmsCard>
				<div class="flex flex-wrap items-start gap-4">
					<DmsIconWell :icon="formIcon || DEFAULT_ICON" tone="primary" size="xl" />
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<h2 class="truncate text-lg font-semibold text-highlighted">{{ selected.name }}</h2>
						<p class="font-mono text-xs text-dimmed">{{ selected._id }}</p>
					</div>
					<UButton color="neutral" variant="outline" icon="i-ph-tree-structure" @click="editGraph">
						{{ $t('dms_automation.templates.editGraph') }}
					</UButton>
				</div>
			</DmsCard>

			<DmsCard :title="$t('dms_automation.templates.details')">
				<div>
					<DmsFieldRow layout="form" :label="$t('dms_automation.templates.form.name')" :label-for="NAME_ID" required>
						<div class="grid gap-1.5">
							<DmsInputText :id="NAME_ID" v-model="formName" class="w-full" v-bind="fieldErrors.aria('name')" />
							<DmsFieldError :id="fieldErrors.errorId('name')" :message="fieldErrors.errors.name" />
						</div>
					</DmsFieldRow>
					<DmsFieldRow layout="form" :label="$t('dms_automation.templates.form.description')" label-for="template-description">
						<DmsTextarea id="template-description" v-model="formDescription" class="w-full" :rows="2" />
					</DmsFieldRow>
					<DmsFieldRow layout="form" :label="$t('dms_automation.templates.form.icon')">
						<DmsAutomationIconPicker v-model="formIcon" />
					</DmsFieldRow>
				</div>
				<template #footer>
					<div class="flex justify-end">
						<UButton color="primary" icon="i-ph-floppy-disk" :disabled="!dirty" :loading="saving" @click="onSave">
							{{ $t('dms_automation.common.save') }}
						</UButton>
					</div>
				</template>
			</DmsCard>

			<DmsCard :title="$t('dms_automation.templates.ports.title')" :count="selected.ports?.length ?? 0">
				<p class="mb-3 text-xs text-muted">{{ $t('dms_automation.templates.ports.editHint') }}</p>
				<p v-if="(selected.ports ?? []).length === 0" class="text-xs text-dimmed">{{ $t('dms_automation.templates.ports.empty') }}</p>
				<div v-else class="overflow-hidden rounded-md border border-default">
					<table class="w-full text-left text-xs">
						<thead class="bg-elevated/60 font-mono text-[10.5px] text-dimmed uppercase">
							<tr>
								<th class="px-3 py-1.5 font-normal">{{ $t('dms_automation.templates.ports.col.kind') }}</th>
								<th class="px-3 py-1.5 font-normal">{{ $t('dms_automation.templates.ports.col.direction') }}</th>
								<th class="px-3 py-1.5 font-normal">{{ $t('dms_automation.templates.ports.col.name') }}</th>
								<th class="px-3 py-1.5 font-normal">{{ $t('dms_automation.templates.ports.col.type') }}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-default">
							<tr v-for="(port, index) in selected.ports" :key="`${port.direction}-${port.kind}-${port.name}-${index}`">
								<td class="px-3 py-1.5">
									<UBadge :color="port.kind === 'trigger' ? 'info' : 'success'" variant="subtle" size="sm">
										{{ $t(`dms_automation.templates.ports.kind.${port.kind}`) }}
									</UBadge>
								</td>
								<td class="px-3 py-1.5 text-muted">{{ $t(`dms_automation.templates.ports.direction.${port.direction}`) }}</td>
								<td class="px-3 py-1.5 font-mono text-highlighted">{{ port.name }}</td>
								<td class="px-3 py-1.5 font-mono text-muted">{{ schemaTypeOf(port) }}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</DmsCard>

			<DmsCard :title="$t('dms_automation.templates.usedIn')" :count="usages.length">
				<p v-if="usages.length" class="mb-3 text-xs text-muted">{{ $t('dms_automation.templates.usedInHint') }}</p>
				<div v-if="usagesLoading" class="flex flex-col gap-2">
					<USkeleton v-for="i in 2" :key="i" class="h-8 w-full" />
				</div>
				<p v-else-if="usages.length === 0" class="text-xs text-dimmed">{{ $t('dms_automation.templates.usages.empty') }}</p>
				<ul v-else class="divide-y divide-default">
					<li v-for="(usage, index) in usages" :key="`${usage.procedureId}-${usage.nodeId}-${index}`" class="flex items-center gap-3 py-2">
						<DmsStatusPill
							v-if="procedures.get(usage.procedureId)"
							:tone="STATE_TONES[procedures.get(usage.procedureId)!.status]"
							:label="$t(`dms_automation.procedures.status.${procedures.get(usage.procedureId)!.status}`)"
							size="sm"
						/>
						<span class="min-w-0 flex-1 truncate text-sm text-highlighted">
							{{ procedures.get(usage.procedureId)?.name ?? usage.procedureId }}
						</span>
						<UButton size="xs" variant="ghost" color="neutral" trailing-icon="i-ph-arrow-up-right" @click="openUsage(usage)">
							{{ $t('dms_automation.library.open') }}
						</UButton>
					</li>
				</ul>
			</DmsCard>

			<div class="flex items-center justify-between gap-3">
				<p class="text-xs text-muted">{{ $t('dms_automation.templates.deleteHint') }}</p>
				<UButton color="error" variant="soft" icon="i-ph-trash" @click="onDelete">
					{{ $t('dms_automation.templates.delete') }}
				</UButton>
			</div>
		</div>
	</div>
</template>
