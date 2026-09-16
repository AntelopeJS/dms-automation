<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RunDetailDrawer from '../RunDetailDrawer.vue'
import { useAutomationRuns } from '../../composables/useAutomationRuns'
import { type ListEnvelope, unwrapList } from '../../utils/automation'

interface RunRecord {
	_id: string
	procedureId: string
	startedAt: string | Date
	endedAt?: string | Date | null
	status: string
	errorMessage?: string | null
	triggerNodeId?: string
	triggerPayload?: string
}

const props = defineProps<{
	procedureId: string | null
	procedureName?: string
}>()

const { $authFetch } = useAuthFetch()
// DMS-themed drawer from the dms layer (dms ≥0.0.26, public API replacing the
// removed useSheets/addSheet). Opens the run-detail view sliding in from the
// right; `open` marks the body component raw and generates a containerId.
const { open: openRunDrawer } = useDrawer()
const { getRun } = useAutomationRuns()
const { t } = useI18n()

const PAGE_SIZE = 10

const runs = ref<RunRecord[]>([])
const loading = ref(false)
const open = ref(false)
const error = ref<string | null>(null)
const loadingDetailId = ref<string | null>(null)
const detailError = ref<string | null>(null)
const page = ref(0)
const hasMore = ref(false)

async function load(target = 0) {
	if (!props.procedureId) {
		runs.value = []
		hasMore.value = false
		page.value = 0
		return
	}
	const p = Math.max(0, target)
	loading.value = true
	error.value = null
	try {
		const data = await $authFetch<RunRecord[] | ListEnvelope<RunRecord>>(
			`/api/automation/procedures/${props.procedureId}/runs?page=${p}&limit=${PAGE_SIZE}`,
		)
		// The API over-fetches one row beyond PAGE_SIZE as a next-page probe;
		// trim it for display and use its presence for `hasMore`, so an
		// exactly-full final page never enables a dead "Next".
		const list = unwrapList<RunRecord>(data)
		runs.value = list.slice(0, PAGE_SIZE)
		page.value = p
		hasMore.value = list.length > PAGE_SIZE
	} catch (e) {
		error.value = (e as Error).message ?? 'Failed to load runs'
		runs.value = []
		hasMore.value = false
	} finally {
		loading.value = false
	}
}

watch(
	() => props.procedureId,
	() => {
		void load(0)
	},
	{ immediate: true },
)

// Reset to the first page when the panel closes so the trigger badge always
// reflects the most recent runs, not whatever page was left open.
watch(open, (isOpen) => {
	if (!isOpen && page.value !== 0) void load(0)
})

// Let the editor refresh the list (and the trigger badge) after "Run now".
defineExpose({ reload: () => load(0) })

function fmtStarted(v: string | Date | null | undefined): string {
	if (!v) return '—'
	try {
		return new Date(v).toLocaleString()
	} catch {
		return String(v)
	}
}

function fmtDuration(
	startedAt: string | Date | null | undefined,
	endedAt: string | Date | null | undefined,
): string {
	if (!endedAt || !startedAt) return '—'
	try {
		const s = new Date(startedAt).getTime()
		const e = new Date(endedAt).getTime()
		if (Number.isNaN(s) || Number.isNaN(e)) return '—'
		return `${e - s} ms`
	} catch {
		return '—'
	}
}

function statusIcon(status: string): { name: string; color: string } {
	if (status === 'ok')
		return { name: 'i-ph-check-circle', color: 'text-success' }
	if (status === 'failed')
		return { name: 'i-ph-x-circle', color: 'text-error' }
	return { name: 'i-ph-spinner', color: 'text-warning' }
}

function truncate(s: string | null | undefined, n: number): string {
	if (!s) return '—'
	if (s.length <= n) return s
	return `${s.slice(0, n)}…`
}

const headerText = computed(() => {
	if (!props.procedureId) return t('dms_automation.editor.runsDrawer.title')
	if (loading.value) return t('dms_automation.editor.runsDrawer.loading')
	return t('dms_automation.editor.runsDrawer.count', { n: runs.value.length })
})

async function onRefresh() {
	await load()
}

async function openDetail(r: RunRecord) {
	if (loadingDetailId.value === r._id) return
	loadingDetailId.value = r._id
	detailError.value = null
	try {
		// Bubble fetch errors up to the drawer (instead of pretending the
		// summary is the detail — the fire tree would just render empty).
		const full = await getRun(r._id)
		openRunDrawer({
			containerId: `dms-automation-run-${r._id}`,
			title: `${r.status.toUpperCase()} · ${props.procedureName ?? r.procedureId}`,
			description: new Date(r.startedAt).toLocaleString(),
			direction: 'right',
			component: RunDetailDrawer,
			componentOptions: {
				run: full,
				procedureName: props.procedureName,
			},
		})
		// Intentionally keep the runs list open BEHIND the detail. Closing it
		// here (open.value = false) made the just-opened detail vanish ~a tick
		// later — tearing down the runs USlideover cascades into the detail
		// overlay. The detail is a separate dms `useDrawer` (a dismissible:false
		// UDrawer) closed only via its own control, so leaving the list mounted
		// lets you inspect runs back to back. Trade-off: while a detail is open
		// the drawer stacks above the still-mounted list.
	} catch (e) {
		const msg = (e as Error).message ?? 'Failed to load run'
		detailError.value = msg
		console.error('[dms-automation] failed to open run detail', e)
	} finally {
		loadingDetailId.value = null
	}
}
</script>

<template>
	<UButton
		icon="i-ph-clock-counter-clockwise"
		variant="outline"
		color="neutral"
		:disabled="!procedureId"
		@click="open = true"
	>
		{{ $t('dms_automation.editor.runsDrawer.title') }}
		<UBadge
			v-if="runs.length"
			:label="hasMore ? `${runs.length}+` : String(runs.length)"
			color="neutral"
			variant="subtle"
			size="sm"
		/>
	</UButton>

	<USlideover v-model:open="open" side="right" :title="headerText">
		<template #body>
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<div class="text-xs text-dimmed">
						<span v-if="error" class="text-error">{{ error }}</span>
						<span v-else-if="detailError" class="text-error">{{ detailError }}</span>
						<span v-else-if="!procedureId">
							{{ $t('dms_automation.editor.runsDrawer.selectProcedure') }}
						</span>
						<span v-else-if="loading">
							{{ $t('dms_automation.editor.runsDrawer.loadingShort') }}
						</span>
						<span v-else>
							{{ $t('dms_automation.editor.runsDrawer.runCount', { n: runs.length }) }}
						</span>
					</div>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						icon="i-ph-arrows-clockwise"
						:loading="loading"
						:disabled="!procedureId"
						@click="onRefresh"
					>
						{{ $t('dms_automation.editor.runsDrawer.refresh') }}
					</UButton>
				</div>

				<div
					v-if="runs.length > 0"
					class="overflow-hidden rounded-lg border border-default"
				>
					<table class="w-full text-xs">
						<thead>
							<tr class="border-b border-default bg-muted">
								<th class="w-12 px-3 py-2 text-left font-semibold text-dimmed">
									{{ $t('dms_automation.editor.runsDrawer.cols.status') }}
								</th>
								<th class="px-3 py-2 text-left font-semibold text-dimmed">
									{{ $t('dms_automation.editor.runsDrawer.cols.started') }}
								</th>
								<th class="px-3 py-2 text-left font-semibold text-dimmed">
									{{ $t('dms_automation.editor.runsDrawer.cols.duration') }}
								</th>
								<th class="px-3 py-2 text-left font-semibold text-dimmed">
									{{ $t('dms_automation.editor.runsDrawer.cols.error') }}
								</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="r in runs"
								:key="r._id"
								class="cursor-pointer border-b border-default/60 transition-colors last:border-0 hover:bg-elevated/40"
								:class="{ 'opacity-60': loadingDetailId === r._id }"
								@click="openDetail(r)"
							>
								<td class="px-3 py-2">
									<UIcon
										v-if="loadingDetailId === r._id"
										name="i-ph-spinner"
										class="animate-spin text-dimmed"
									/>
									<UIcon
										v-else
										:name="statusIcon(r.status).name"
										:class="statusIcon(r.status).color"
									/>
								</td>
								<td class="whitespace-nowrap px-3 py-2 tabular-nums text-toned">
									{{ fmtStarted(r.startedAt) }}
								</td>
								<td class="whitespace-nowrap px-3 py-2 tabular-nums text-toned">
									{{ fmtDuration(r.startedAt, r.endedAt) }}
								</td>
								<td class="px-3 py-2 text-error">
									{{ truncate(r.errorMessage, 60) }}
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div
					v-else-if="!loading && procedureId && !error"
					class="p-2 text-xs text-dimmed"
				>
					{{ $t('dms_automation.editor.runsDrawer.empty') }}
				</div>

				<div
					v-if="runs.length > 0"
					class="flex items-center justify-between gap-3 pt-1"
				>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						icon="i-ph-caret-left"
						:label="$t('dms_automation.common.previous')"
						:disabled="page === 0 || loading"
						@click="load(page - 1)"
					/>
					<span class="text-xs tabular-nums text-dimmed">
						{{ $t('dms_automation.runs.pageLabel', { n: page + 1 }) }}
					</span>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						trailing-icon="i-ph-caret-right"
						:label="$t('dms_automation.common.next')"
						:disabled="!hasMore || loading"
						@click="load(page + 1)"
					/>
				</div>
			</div>
		</template>
	</USlideover>
</template>
