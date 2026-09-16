<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { unwrapList } from '../utils/automation'

// `embedded` drops the page-head when this catalog is rendered inside a Library tab.
defineProps<{ embedded?: boolean }>()

// JSON Schema allows `type` to be a single name or a list (`["string", "null"]`).
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
	created_at?: string | Date
	updated_at?: string | Date
}

interface TemplateListResponse {
	results: TemplateRow[]
	total: number
	page: number
	limit: number
}

interface TemplateUsage {
	procedureId: string
	nodeId: string
}

interface ProcedureRow {
	_id: string
	name: string
}

interface ProcedureListResponse {
	results: ProcedureRow[]
}

const DEFAULT_ICON = 'i-ph-package'

const { $authFetch } = useAuthFetch()
const router = useDmsRouter()
const toast = useToast()

const items = ref<TemplateRow[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const selectedId = ref<string | null>(null)

// Form state for the currently selected template.
const formName = ref('')
const formDescription = ref('')
const formIcon = ref(DEFAULT_ICON)
const saving = ref(false)
const saveError = ref<string | null>(null)

// Usages panel state.
const usages = ref<TemplateUsage[]>([])
const usagesLoading = ref(false)
const usagesError = ref<string | null>(null)
const procedureNames = ref<Map<string, string>>(new Map())

// Delete-confirm state.
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

async function loadList() {
	loading.value = true
	loadError.value = null
	try {
		const data = await $authFetch<TemplateListResponse | TemplateRow[]>(
			'/api/automation/templates',
		)
		const list = unwrapList<TemplateRow>(data)
		items.value = list
		// Keep current selection if it still exists, otherwise pick the first.
		if (selectedId.value && !list.find((t) => t._id === selectedId.value)) {
			selectedId.value = list[0]?._id ?? null
		} else if (!selectedId.value) {
			selectedId.value = list[0]?._id ?? null
		}
	} catch (e) {
		loadError.value = (e as Error).message ?? 'Failed to load templates'
	} finally {
		loading.value = false
	}
}

await loadList()

// Lazily fetch the procedure list once so we can resolve procedureId -> name
// in the "Used in" panel. If the fetch fails, we silently fall back to showing
// the raw id (still wrapped in a link to the editor).
async function ensureProcedureNames() {
	if (procedureNames.value.size > 0) return
	try {
		const data = await $authFetch<ProcedureListResponse | ProcedureRow[]>(
			'/api/automation/procedures?limit=100000',
		)
		const list = unwrapList<ProcedureRow>(data)
		const map = new Map<string, string>()
		for (const p of list) map.set(p._id, p.name)
		procedureNames.value = map
	} catch {
		// Non-fatal: keep the map empty so we fall back to ids.
	}
}

const selected = computed<TemplateRow | null>(
	() => items.value.find((t) => t._id === selectedId.value) ?? null,
)

// Search filter applied to the rail.
const search = ref('')
const filteredItems = computed<TemplateRow[]>(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return items.value
	return items.value.filter(
		(t) =>
			t.name.toLowerCase().includes(q) ||
			(t.description ?? '').toLowerCase().includes(q),
	)
})

// Sync form fields whenever the selection changes.
watch(
	selected,
	(t) => {
		formName.value = t?.name ?? ''
		formDescription.value = t?.description ?? ''
		formIcon.value = t?.icon || DEFAULT_ICON
		saveError.value = null
		// Reload usages for the new selection.
		void loadUsages()
	},
	{ immediate: true },
)

async function loadUsages() {
	const t = selected.value
	if (!t) {
		usages.value = []
		usagesError.value = null
		return
	}
	usagesLoading.value = true
	usagesError.value = null
	try {
		const data = await $authFetch<TemplateUsage[]>(
			`/api/automation/templates/${t._id}/usages`,
		)
		usages.value = unwrapList(data)
		if (usages.value.length > 0) {
			await ensureProcedureNames()
		}
	} catch (e) {
		usagesError.value = (e as Error).message ?? 'Failed to load usages'
		usages.value = []
	} finally {
		usagesLoading.value = false
	}
}

function procedureLabel(id: string): string {
	return procedureNames.value.get(id) ?? id
}

function procedureLink(id: string): string {
	return `/modules/automation/builder?selected=${encodeURIComponent(id)}`
}

async function onSave() {
	const t = selected.value
	if (!t) return
	saving.value = true
	saveError.value = null
	try {
		// PUT is required to send the full template body (including ports +
		// subgraph) since the route revalidates the whole graph. We forward
		// the existing ports/subgraph unchanged — only the metadata changes.
		const body = {
			name: formName.value.trim() || t.name,
			description: formDescription.value,
			icon: formIcon.value || DEFAULT_ICON,
			ports: t.ports ?? [],
			subgraph: t.subgraph ?? {
				nodes: [],
				triggerEdges: [],
				dataEdges: [],
			},
		}
		const updated = await $authFetch<TemplateRow>(
			`/api/automation/templates/${t._id}`,
			{ method: 'PUT', body },
		)
		const idx = items.value.findIndex((x) => x._id === t._id)
		if (idx >= 0) {
			items.value[idx] = {
				...t,
				...updated,
				usageCount: t.usageCount,
			}
		}
		toast.add({
			title: 'Template saved',
			description: updated.name,
			color: 'success',
			icon: 'i-ph-check-circle',
		})
	} catch (e) {
		saveError.value = (e as Error).message ?? 'Failed to save'
		toast.add({
			title: 'Failed to save template',
			description: (e as Error).message ?? '',
			color: 'error',
			icon: 'i-ph-warning',
		})
	} finally {
		saving.value = false
	}
}

function onEditSubgraph() {
	const t = selected.value
	if (!t) return
	router.push({
		path: '/modules/automation/builder',
		query: { template: t._id },
	})
}

function openDelete() {
	deleteError.value = null
	deleteOpen.value = true
}

async function confirmDelete(force: boolean) {
	const t = selected.value
	if (!t) return
	deleting.value = true
	deleteError.value = null
	try {
		const url = force
			? `/api/automation/templates/${t._id}?force=1`
			: `/api/automation/templates/${t._id}`
		await $authFetch(url, { method: 'DELETE' })
		toast.add({
			title: 'Template deleted',
			description: t.name,
			color: 'success',
			icon: 'i-ph-check-circle',
		})
		deleteOpen.value = false
		// Drop from list, pick a new selection.
		items.value = items.value.filter((x) => x._id !== t._id)
		selectedId.value = items.value[0]?._id ?? null
	} catch (e) {
		deleteError.value = (e as Error).message ?? 'Failed to delete'
	} finally {
		deleting.value = false
	}
}

function portRowKey(p: TemplatePort, idx: number): string {
	return `${p.direction}-${p.kind}-${p.name}-${idx}`
}

function schemaTypeOf(p: TemplatePort): string {
	if (p.kind !== 'data') return '—'
	const t = p.schema?.type
	if (typeof t === 'string') return t
	if (Array.isArray(t)) return t.join(' | ')
	return 'any'
}
</script>

<template>
	<div :class="embedded ? 'flex flex-col gap-5' : 'flex flex-col gap-6 p-4 sm:p-6'">
		<section v-if="!embedded" class="flex flex-wrap items-center gap-4">
			<div
				class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring ring-primary/20"
			>
				<UIcon name="i-ph-package" class="size-6" />
			</div>
			<div class="min-w-0 flex-1">
				<h1 class="text-2xl font-semibold tracking-tight text-highlighted">
					{{ $t('dms_automation.templates.title') }}
				</h1>
				<p class="text-sm text-muted">
					{{ $t('dms_automation.templates.description') }}
				</p>
			</div>
			<UButton
				class="ml-auto"
				color="neutral"
				variant="outline"
				icon="i-ph-arrows-clockwise"
				:loading="loading"
				@click="loadList"
			>
				{{ $t('dms_automation.templates.refresh') }}
			</UButton>
		</section>

		<UAlert
			v-if="loadError"
			color="error"
			variant="subtle"
			icon="i-ph-warning"
			:title="$t('dms_automation.templates.loadError')"
			:description="loadError"
		/>

		<div
			class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,360px)_1fr] lg:items-start"
		>
			<div class="flex flex-col gap-3">
				<UInput
					v-model="search"
					icon="i-ph-magnifying-glass"
					:placeholder="$t('dms_automation.templates.search')"
				/>
				<DmsCard
					:padded="false"
					class="flex flex-col overflow-hidden lg:max-h-[calc(100vh-16rem)]"
				>
					<div
						v-if="items.length === 0"
						class="px-3 py-6 text-center text-sm text-dimmed"
					>
						{{ $t('dms_automation.templates.empty') }}
					</div>
					<ul v-else class="flex flex-col gap-1 overflow-y-auto p-2">
						<li v-for="t in filteredItems" :key="t._id">
							<button
								type="button"
								class="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors"
								:class="
									selectedId === t._id
										? 'bg-primary/10 text-primary ring-1 ring-primary/20'
										: 'text-toned hover:bg-elevated/60'
								"
								@click="selectedId = t._id"
							>
								<UIcon
									:name="t.icon || DEFAULT_ICON"
									class="mt-0.5 size-4 shrink-0"
									:class="selectedId === t._id ? 'text-primary' : 'text-dimmed'"
								/>
								<div class="min-w-0 flex-1">
									<div
										class="truncate text-sm font-medium"
										:class="selectedId === t._id ? 'text-primary' : 'text-highlighted'"
									>
										{{ t.name }}
									</div>
									<div v-if="t.description" class="truncate text-xs text-muted">
										{{ t.description }}
									</div>
								</div>
								<UBadge
									color="neutral"
									variant="subtle"
									size="sm"
									class="shrink-0 tabular-nums"
								>
									{{ t.usageCount ?? 0 }}
								</UBadge>
							</button>
						</li>
					</ul>
				</DmsCard>
			</div>

			<DmsCard v-if="selected" :padded="false" class="flex flex-col">
				<div class="flex items-start gap-3 border-b border-default px-5 py-4 sm:px-6">
					<div
						class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring ring-primary/20"
					>
						<UIcon :name="formIcon || DEFAULT_ICON" class="size-5" />
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="truncate text-lg font-semibold text-highlighted">
							{{ selected.name }}
						</h2>
						<p class="mt-1 font-mono text-xs text-dimmed">{{ selected._id }}</p>
					</div>
					<UBadge color="neutral" variant="subtle" class="shrink-0">
						{{
							$t('dms_automation.templates.usedInN', {
								n: selected.usageCount ?? 0,
							})
						}}
					</UBadge>
				</div>

				<div class="flex flex-col gap-6 px-5 py-4 sm:px-6">
					<div class="flex flex-col gap-3">
						<UFormField
							:label="$t('dms_automation.templates.form.name')"
							required
						>
							<UInput v-model="formName" class="w-full" />
						</UFormField>
						<UFormField
							:label="$t('dms_automation.templates.form.description')"
						>
							<UTextarea v-model="formDescription" class="w-full" :rows="3" />
						</UFormField>
						<UFormField
							:label="$t('dms_automation.templates.form.icon')"
							:help="$t('dms_automation.templates.form.iconHelp')"
						>
							<UInput
								v-model="formIcon"
								:placeholder="DEFAULT_ICON"
								class="w-full"
							/>
						</UFormField>
						<UAlert
							v-if="saveError"
							color="error"
							variant="subtle"
							icon="i-ph-warning"
							:title="$t('dms_automation.templates.saveError')"
							:description="saveError"
						/>
						<div class="flex justify-end gap-2">
							<UButton
								color="primary"
								icon="i-ph-floppy-disk"
								:loading="saving"
								@click="onSave"
							>
								{{ $t('dms_automation.templates.save') }}
							</UButton>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<div class="text-sm font-semibold text-highlighted">
								{{ $t('dms_automation.templates.ports.title') }}
							</div>
							<UButton
								variant="outline"
								color="neutral"
								icon="i-ph-pencil-simple"
								size="sm"
								@click="onEditSubgraph"
							>
								{{ $t('dms_automation.templates.editSubgraph') }}
							</UButton>
						</div>
						<p class="text-xs text-muted">
							{{ $t('dms_automation.templates.ports.editHint') }}
						</p>
						<div
							v-if="(selected.ports ?? []).length === 0"
							class="text-sm text-dimmed"
						>
							{{ $t('dms_automation.templates.ports.empty') }}
						</div>
						<div v-else class="overflow-hidden rounded-lg border border-default">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-default bg-muted">
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.templates.ports.col.kind') }}
										</th>
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.templates.ports.col.direction') }}
										</th>
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.templates.ports.col.name') }}
										</th>
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.templates.ports.col.type') }}
										</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="(p, idx) in selected.ports"
										:key="portRowKey(p, idx)"
										class="border-b border-default/60 last:border-0"
									>
										<td class="px-4 py-2.5">
											<UBadge
												:color="p.kind === 'trigger' ? 'primary' : 'neutral'"
												variant="subtle"
											>
												{{ p.kind }}
											</UBadge>
										</td>
										<td class="whitespace-nowrap px-4 py-2.5 text-muted">
											{{ p.direction }}
										</td>
										<td class="px-4 py-2.5 font-mono text-highlighted">
											{{ p.name }}
										</td>
										<td class="whitespace-nowrap px-4 py-2.5 font-mono text-primary">
											{{ schemaTypeOf(p) }}
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<div class="text-sm font-semibold text-highlighted">
							{{ $t('dms_automation.templates.usages.title') }}
						</div>
						<UAlert
							v-if="usagesError"
							color="error"
							variant="subtle"
							icon="i-ph-warning"
							:title="$t('dms_automation.templates.usagesError')"
							:description="usagesError"
						/>
						<div v-else-if="usagesLoading" class="text-sm text-dimmed">
							Loading…
						</div>
						<div v-else-if="usages.length === 0" class="text-sm text-dimmed">
							{{ $t('dms_automation.templates.usages.empty') }}
						</div>
						<ul v-else class="flex flex-col">
							<li
								v-for="(u, idx) in usages"
								:key="`${u.procedureId}-${u.nodeId}-${idx}`"
								class="flex items-center gap-3 border-b border-default/60 py-2 last:border-0"
							>
								<UIcon name="i-ph-puzzle-piece" class="size-4 shrink-0 text-dimmed" />
								<DmsLink
									:to="procedureLink(u.procedureId)"
									class="truncate text-highlighted hover:text-primary hover:underline"
								>
									{{ procedureLabel(u.procedureId) }}
								</DmsLink>
								<span class="truncate font-mono text-xs text-dimmed">
									{{ u.nodeId }}
								</span>
							</li>
						</ul>
					</div>

					<div class="flex justify-end border-t border-default pt-4">
						<UButton
							color="error"
							variant="subtle"
							icon="i-ph-trash"
							@click="openDelete"
						>
							{{ $t('dms_automation.templates.delete') }}
						</UButton>
					</div>
				</div>
			</DmsCard>

			<DmsCard
				v-else
				class="flex min-h-[16rem] items-center justify-center text-center"
			>
				<div class="flex flex-col items-center gap-3 text-dimmed">
					<UIcon name="i-ph-package" class="size-8" />
					<p class="max-w-xs text-sm">
						{{ $t('dms_automation.templates.empty') }}
					</p>
				</div>
			</DmsCard>
		</div>

		<UModal
			v-model:open="deleteOpen"
			:title="$t('dms_automation.templates.deleteConfirm.title')"
		>
			<template #body>
				<div class="flex flex-col gap-3">
					<p class="text-default text-sm">
						{{
							$t(
								'dms_automation.templates.deleteConfirm.message',
								{ name: selected?.name ?? '' },
							)
						}}
					</p>
					<UAlert
						v-if="(selected?.usageCount ?? 0) > 0"
						color="warning"
						variant="subtle"
						icon="i-ph-warning"
						:title="
							$t(
								'dms_automation.templates.deleteConfirm.usageWarningTitle',
							)
						"
						:description="
							$t(
								'dms_automation.templates.deleteConfirm.usageWarning',
								{ n: selected?.usageCount ?? 0 },
							)
						"
					/>
					<UAlert
						v-if="deleteError"
						color="error"
						variant="subtle"
						icon="i-ph-warning"
						:title="$t('dms_automation.templates.deleteError')"
						:description="deleteError"
					/>
				</div>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						:label="$t('dms_automation.templates.deleteConfirm.cancel')"
						variant="outline"
						color="neutral"
						:disabled="deleting"
						@click="deleteOpen = false"
					/>
					<UButton
						v-if="(selected?.usageCount ?? 0) > 0"
						color="error"
						icon="i-ph-trash"
						:loading="deleting"
						@click="confirmDelete(true)"
					>
						{{ $t('dms_automation.templates.forceDelete') }}
					</UButton>
					<UButton
						v-else
						color="error"
						icon="i-ph-trash"
						:loading="deleting"
						@click="confirmDelete(false)"
					>
						{{ $t('dms_automation.templates.delete') }}
					</UButton>
				</div>
			</template>
		</UModal>
	</div>
</template>
