<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ProcedureRef, RunSummary } from '../composables/useAutomationRuns'
import { formatDuration } from '../utils/automation'
import RunTraceDrawer from './RunTraceDrawer.vue'

// Custom TableView display (registered in plugins/runs-timeline-display.client.ts):
// renders the run history as a timeline instead of a grid. It is ONLY the list —
// status tabs, the (native RelationType filter-only) procedure filter, search,
// export and the KPI header are owned by the TableView chrome / the page-level
// RunsStats component. Everything shown here comes from the shared TableView state
// via `context` (already filtered/sorted); the only extra fetch is the
// procedure-name lookup for display (the filter-only relation keeps the raw
// procedureId on the row, so we resolve the name client-side).

// Minimal slice of the dms `TableViewDisplayContext` we consume.
interface DisplayPagination {
	pageIndex: number
	pageSize: number
	total: number
	setPage: (index: number) => void
}
interface DisplayContext {
	items: RunSummary[]
	loading: boolean
	refresh: () => void | Promise<void>
	pagination: DisplayPagination
}

const props = defineProps<{ context: DisplayContext }>()

const { listProcedures } = useAutomationRuns()
const { $authFetch } = useAuthFetch()
const { open: openRunDrawer } = useDrawer()
const { t } = useI18n()
const toast = useToast()

const rows = computed<RunSummary[]>(() => props.context.items ?? [])
const loading = computed(() => props.context.loading)
const pagination = computed(() => props.context.pagination)
const replayingId = ref<string | null>(null)

// Procedure-name lookup (the list rows only carry the raw procedureId).
const procedures = ref<ProcedureRef[]>([])
function procedureName(id: string): string {
	return procedures.value.find((x) => x._id === id)?.name ?? id
}

onMounted(async () => {
	await listProcedures()
		.then((p) => {
			procedures.value = p
		})
		.catch(() => {
			/* name lookup is best-effort; falls back to procedureId */
		})
})

// ---- Pagination ----
const pageNumber = computed(() => pagination.value.pageIndex + 1)
const hasPrev = computed(() => pagination.value.pageIndex > 0)
const hasNext = computed(
	() =>
		(pagination.value.pageIndex + 1) * pagination.value.pageSize <
		pagination.value.total,
)

// ---- Formatting ----
function isFailed(status: string): boolean {
	return status === 'failed'
}

function fmtClock(ts: string): string {
	try {
		return new Date(ts).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return ts
	}
}

function fmtDuration(
	startedAt: string | Date | null | undefined,
	endedAt: string | Date | null | undefined,
): string {
	if (!startedAt || !endedAt) return '—'
	const s = new Date(startedAt).getTime()
	const e = new Date(endedAt).getTime()
	if (Number.isNaN(s) || Number.isNaN(e)) return '—'
	return formatDuration(e - s)
}

function runSummaryLine(r: RunSummary): string {
	if (isFailed(r.status)) {
		return r.errorMessage || t('dms_automation.runs.timeline.failed')
	}
	return t('dms_automation.runs.timeline.completed')
}

// ---- Actions ----
// Track open trace drawers by container id so a rapid double-click doesn't stack
// two identical drawers sharing one container.
const openTraceIds = new Set<string>()
function openTrace(r: RunSummary) {
	const containerId = `dms-automation-run-${r._id}`
	if (openTraceIds.has(containerId)) return
	openTraceIds.add(containerId)
	const drawer = openRunDrawer({
		containerId,
		title: `${r.status.toUpperCase()} · ${procedureName(r.procedureId)}`,
		description: new Date(r.startedAt).toLocaleString(),
		direction: 'right',
		component: RunTraceDrawer,
		componentOptions: {
			rowData: r,
			procedureName: procedureName(r.procedureId),
		},
	})
	void drawer.result.finally(() => openTraceIds.delete(containerId))
}

async function replay(r: RunSummary) {
	if (replayingId.value) return
	replayingId.value = r._id
	try {
		await $authFetch(`/api/automation/procedures/${r.procedureId}/run`, {
			method: 'POST',
			body: {},
		})
		toast.add({
			title: t('dms_automation.runs.timeline.replayQueued'),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
		await props.context.refresh()
	} catch (e) {
		toast.add({
			title: t('dms_automation.runs.timeline.replayFailed'),
			description: (e as Error).message,
			color: 'error',
			icon: 'i-ph-warning',
		})
	} finally {
		replayingId.value = null
	}
}
</script>

<template>
	<div class="flex flex-col pt-4">
		<div v-if="loading && rows.length === 0" class="flex flex-col gap-3">
			<USkeleton v-for="i in 6" :key="i" class="h-16 w-full" />
		</div>

		<div
			v-else-if="rows.length === 0"
			class="flex flex-col items-center gap-2 py-12 text-center"
		>
			<UIcon name="i-ph-list-bullets" class="size-7 text-dimmed" />
			<p class="text-sm font-medium text-muted">{{ $t('dms_automation.runs.empty') }}</p>
			<p class="text-xs text-dimmed">{{ $t('dms_automation.runs.emptyHint') }}</p>
		</div>

		<ol v-else class="flex flex-col">
			<li v-for="(r, idx) in rows" :key="r._id" class="flex gap-3">
				<!-- rail -->
				<div class="flex flex-col items-center">
					<span
						class="grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-default/40"
						:class="
							isFailed(r.status)
								? 'bg-error/15 text-error'
								: 'bg-success/15 text-success'
						"
					>
						<UIcon
							:name="isFailed(r.status) ? 'i-ph-x' : 'i-ph-check'"
							class="size-3.5"
						/>
					</span>
					<span v-if="idx < rows.length - 1" class="w-px flex-1 bg-default" />
				</div>

				<!-- card -->
				<div
					class="mb-3 min-w-0 flex-1 rounded-xl border border-default bg-elevated/40 p-3.5"
				>
					<div class="flex flex-wrap items-center gap-2">
						<span class="truncate text-sm font-semibold text-highlighted">
							{{ procedureName(r.procedureId) }}
						</span>
						<UBadge
							v-if="r.triggerNodeId"
							color="neutral"
							variant="subtle"
							size="xs"
							class="gap-1"
						>
							<UIcon name="i-ph-lightning" class="size-3" />
							{{ r.triggerNodeId }}
						</UBadge>
						<UBadge
							:color="isFailed(r.status) ? 'error' : 'success'"
							variant="subtle"
							size="xs"
						>
							{{
								isFailed(r.status)
									? $t('dms_automation.runs.badge.failed')
									: $t('dms_automation.runs.badge.success')
							}}
						</UBadge>
						<time class="ml-auto text-xs tabular-nums text-dimmed">
							{{ fmtClock(r.startedAt) }}
						</time>
					</div>

					<p
						class="mt-1.5 line-clamp-2 text-xs"
						:class="isFailed(r.status) ? 'text-error' : 'text-muted'"
					>
						{{ runSummaryLine(r) }}
					</p>

					<div class="mt-2.5 flex flex-wrap items-center gap-3">
						<span
							class="inline-flex items-center gap-1 rounded-md bg-default/60 px-1.5 py-0.5 text-[11px] tabular-nums text-muted"
						>
							<UIcon name="i-ph-clock" class="size-3" />
							{{ fmtDuration(r.startedAt, r.endedAt) }}
						</span>
						<button
							type="button"
							class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
							@click="openTrace(r)"
						>
							<UIcon name="i-ph-eye" class="size-3.5" />
							{{ $t('dms_automation.runs.timeline.trace') }}
						</button>
						<button
							type="button"
							class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
							:disabled="!!replayingId"
							@click="replay(r)"
						>
							<UIcon
								:name="replayingId === r._id ? 'i-ph-spinner' : 'i-ph-arrows-clockwise'"
								class="size-3.5"
								:class="{ 'animate-spin': replayingId === r._id }"
							/>
							{{ $t('dms_automation.runs.timeline.replay') }}
						</button>
					</div>
				</div>
			</li>
		</ol>

		<div
			v-if="pagination.total > 0"
			class="flex items-center justify-between gap-3 pt-3"
		>
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				icon="i-ph-caret-left"
				:label="$t('dms_automation.common.previous')"
				:disabled="!hasPrev || loading"
				@click="pagination.setPage(pagination.pageIndex - 1)"
			/>
			<span class="text-xs tabular-nums text-dimmed">
				{{ $t('dms_automation.runs.pageLabel', { n: pageNumber }) }}
			</span>
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				trailing-icon="i-ph-caret-right"
				:label="$t('dms_automation.common.next')"
				:disabled="!hasNext || loading"
				@click="pagination.setPage(pagination.pageIndex + 1)"
			/>
		</div>
	</div>
</template>
