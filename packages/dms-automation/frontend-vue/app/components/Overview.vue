<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface HealthBucket {
	total: number
	ok: number
	failed: number
	successRate: number
	avgDurationMs: number
	p95DurationMs: number
}

interface StatsSnapshot {
	counts: {
		procedures: { total: number; enabled: number; disabled: number }
		triggerTypes: number
		actionTypes: number
		dataNodeTypes: number
		templates: number
	}
	health: {
		'24h': HealthBucket
		'7d': HealthBucket
	}
	runsPerDay7d: Array<{ day: string; ok: number; failed: number }>
	recentRuns: Array<{
		runId: string
		procedureId: string
		procedureName: string
		status: string
		startedAt: string
		durationMs: number | null
	}>
	needsAttention: Array<{
		procedureId: string
		name: string
		kind: 'paused' | 'failing'
		failed: number
		lastRunAt: string | null
	}>
}

const { $authFetch } = useAuthFetch()
const { t } = useI18n()

const data = ref<StatsSnapshot | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const autoPoll = ref(false)

async function refresh() {
	loading.value = true
	loadError.value = null
	try {
		data.value = await $authFetch<StatsSnapshot>('/api/automation/stats')
	} catch (e) {
		loadError.value = (e as Error).message ?? 'Failed to load stats'
	} finally {
		loading.value = false
	}
}

let timer: ReturnType<typeof setInterval> | null = null
function clearTimer() {
	if (timer) {
		clearInterval(timer)
		timer = null
	}
}
watch(autoPoll, (v) => {
	clearTimer()
	if (v) timer = setInterval(refresh, 30_000)
})
onMounted(refresh)
onBeforeUnmount(clearTimer)

// ---- Derived metrics ----
const h24 = computed<HealthBucket | null>(() => data.value?.health['24h'] ?? null)

const runsToday = computed<number>(() => {
	const days = data.value?.runsPerDay7d ?? []
	const last = days[days.length - 1]
	return last ? last.ok + last.failed : 0
})

const runs7dTotal = computed<number>(() =>
	(data.value?.runsPerDay7d ?? []).reduce((s, d) => s + d.ok + d.failed, 0),
)

// Four execution-oriented stat cards (rendered as shared DmsKpiCard, static
// mode). `title` carries the `$`-prefix the card's processI18n() expects.
const statCards = computed(() => {
	if (!data.value) return []
	const c = data.value.counts
	const rate = data.value.health['7d'].successRate
	return [
		{
			key: 'procedures',
			title: '$dms_automation.overview.stats.procedures',
			value: c.procedures.total,
			icon: 'i-ph-flow-arrow',
			format: 'number' as const,
		},
		{
			key: 'active',
			title: '$dms_automation.overview.stats.active',
			value: c.procedures.enabled,
			icon: 'i-ph-check-circle',
			format: 'number' as const,
		},
		{
			key: 'runsToday',
			title: '$dms_automation.overview.stats.runsToday',
			value: runsToday.value,
			icon: 'i-ph-activity',
			format: 'compact' as const,
		},
		{
			// DmsKpiCard's `percent` format expects a 0–100 figure (it appends %
			// without re-scaling), so pass the rate as a percentage, not a 0–1 ratio.
			key: 'successRate',
			title: '$dms_automation.overview.stats.successRate',
			value: data.value.health['7d'].total ? rate * 100 : 0,
			icon: 'i-ph-trend-up',
			format: 'percent' as const,
		},
	]
})

// Execution health is "Operational" while the last 24h had no failures, else
// "Needs attention" — drives the badge colour next to the panel title.
const healthOperational = computed<boolean>(() => (h24.value?.failed ?? 0) === 0)

const healthMetrics = computed(() => {
	const h = h24.value
	if (!h) return []
	return [
		{ label: t('dms_automation.overview.execHealth.avgDuration'), value: formatDuration(h.avgDurationMs) },
		{ label: t('dms_automation.overview.execHealth.p95Duration'), value: formatDuration(h.p95DurationMs) },
		{ label: t('dms_automation.overview.execHealth.failed24h'), value: String(h.failed) },
		{ label: t('dms_automation.overview.execHealth.total24h'), value: String(h.total) },
		{ label: t('dms_automation.overview.execHealth.successRate'), value: formatPercent(h.successRate) },
	]
})

// ---- Chart (7-day runs, OK vs Failed) ----
// ApexCharts (via DmsChart) doesn't read CSS tokens, so series colours are
// pinned hex from the DMS chart palette.
const C_OK = '#10b981'
const C_FAILED = '#ef4444'

function dayLabel(iso: string): string {
	const parts = iso.split('-')
	return parts.length === 3 ? `${parts[1]}-${parts[2]}` : iso
}

const hasRuns7d = computed(() =>
	(data.value?.runsPerDay7d ?? []).some((d) => d.ok + d.failed > 0),
)

const chartSeries = computed(() => {
	const days = data.value?.runsPerDay7d ?? []
	return [
		{
			name: t('dms_automation.overview.chart.legendOk'),
			color: C_OK,
			data: days.map((d) => ({ x: dayLabel(d.day), y: d.ok })),
		},
		{
			name: t('dms_automation.overview.chart.legendFailed'),
			color: C_FAILED,
			data: days.map((d) => ({ x: dayLabel(d.day), y: d.failed })),
		},
	]
})

// ---- Formatting ----
function formatDuration(ms: number): string {
	if (!ms || !Number.isFinite(ms)) return '0ms'
	if (ms < 1000) return `${Math.round(ms)}ms`
	const s = ms / 1000
	if (s < 60) return `${s.toFixed(1)}s`
	const m = Math.floor(s / 60)
	const rem = Math.round(s % 60)
	return `${m}m ${rem}s`
}

function formatPercent(rate: number): string {
	if (!Number.isFinite(rate)) return '—'
	return `${(rate * 100).toFixed(1)}%`
}

function timeAgo(iso: string): string {
	const then = new Date(iso).getTime()
	if (!Number.isFinite(then)) return ''
	const sec = Math.max(0, Math.round((Date.now() - then) / 1000))
	if (sec < 60) return t('dms_automation.overview.timeAgo.now')
	const min = Math.floor(sec / 60)
	if (min < 60) return t('dms_automation.overview.timeAgo.min', { n: min })
	const hr = Math.floor(min / 60)
	if (hr < 24) return t('dms_automation.overview.timeAgo.hour', { n: hr })
	const day = Math.floor(hr / 24)
	return t('dms_automation.overview.timeAgo.day', { n: day })
}

// ---- Links (note: module routes are /modules/* plural) ----
function procedureLink(procedureId: string): string {
	return `/modules/automation/builder?selected=${encodeURIComponent(procedureId)}`
}
const runsAllLink = '/modules/automation/runs'
const proceduresLink = '/modules/automation/procedures'

function runIsFailed(status: string): boolean {
	return status === 'failed'
}
</script>

<template>
	<!--
		Title / icon / description come from the page's native dms header
		(src/pages/overview.ts) — only the page actions live here.
	-->
	<div class="flex flex-col gap-5">
		<section class="flex flex-wrap items-center gap-4">
			<div class="ml-auto flex flex-wrap items-center gap-2">
				<label class="mr-1 flex items-center gap-2 text-sm text-muted">
					<USwitch v-model="autoPoll" />
					{{ $t('dms_automation.overview.autoPoll') }}
				</label>
				<UButton
					color="neutral"
					variant="ghost"
					icon="i-ph-arrows-clockwise"
					:loading="loading"
					:aria-label="$t('dms_automation.overview.refresh')"
					@click="refresh"
				/>
				<UButton
					:to="proceduresLink"
					color="neutral"
					variant="outline"
					icon="i-ph-flow-arrow"
				>
					{{ $t('dms_automation.overview.head.procedures') }}
				</UButton>
				<UButton :to="proceduresLink" color="primary" icon="i-ph-plus">
					{{ $t('dms_automation.overview.head.newProcedure') }}
				</UButton>
			</div>
		</section>

		<UAlert
			v-if="loadError"
			color="error"
			variant="subtle"
			icon="i-ph-warning"
			:title="$t('dms_automation.overview.loadError')"
			:description="loadError"
		/>

		<!-- Stat cards -->
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<template v-if="data">
				<DmsKpiCard
					v-for="card in statCards"
					:key="card.key"
					variant="stat"
					page-id="automation.overview"
					:component-id="`overview-stat-${card.key}`"
					:title="card.title"
					:icon="card.icon"
					:static-value="card.value"
					:value-format="card.format"
					:show-delta="false"
				/>
			</template>
			<template v-else>
				<DmsCard v-for="i in 4" :key="`skel-${i}`" :padded="false" class="p-5">
					<USkeleton class="h-10 w-full" />
				</DmsCard>
			</template>
		</div>

		<!-- Runs (7 days) chart  +  Execution health -->
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			<!-- Runs (7 days) -->
			<DmsCard :padded="false" class="flex flex-col">
				<div class="flex flex-col gap-2 px-5 py-4 sm:px-6">
					<div class="flex items-start justify-between gap-3">
						<div>
							<h2 class="font-semibold leading-tight text-highlighted">
								{{ $t('dms_automation.overview.runs7d.title') }}
							</h2>
							<div class="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-highlighted">
								{{ data ? runs7dTotal.toLocaleString() : '—' }}
							</div>
						</div>
						<div class="flex items-center gap-3 pt-1 text-xs">
							<span class="flex items-center gap-1.5">
								<span class="inline-block size-2.5 rounded-sm" :style="{ background: C_OK }" />
								<span class="text-muted">{{ $t('dms_automation.overview.chart.legendOk') }}</span>
							</span>
							<span class="flex items-center gap-1.5">
								<span class="inline-block size-2.5 rounded-sm" :style="{ background: C_FAILED }" />
								<span class="text-muted">{{ $t('dms_automation.overview.chart.legendFailed') }}</span>
							</span>
						</div>
					</div>
				</div>
				<div class="flex-1 px-2 pb-3 sm:px-3">
					<DmsChart
						v-if="data && hasRuns7d"
						type="area"
						:static-dataset="chartSeries"
						:show-legend="false"
						height="208px"
					/>
					<div
						v-else-if="data"
						class="flex h-[208px] items-center justify-center text-sm text-dimmed"
					>
						{{ $t('dms_automation.overview.chart.empty') }}
					</div>
					<USkeleton v-else class="mx-3 h-[208px]" />
				</div>
			</DmsCard>

			<!-- Execution health -->
			<DmsCard :padded="false" class="flex flex-col">
				<div
					class="flex items-center justify-between gap-3 border-b border-default px-5 py-4 sm:px-6"
				>
					<h2 class="font-semibold leading-tight text-highlighted">
						{{ $t('dms_automation.overview.execHealth.title') }}
					</h2>
					<UBadge
						v-if="data"
						:color="healthOperational ? 'success' : 'warning'"
						variant="subtle"
						class="gap-1.5"
					>
						<span
							class="inline-block size-1.5 rounded-full"
							:class="healthOperational ? 'bg-success' : 'bg-warning'"
						/>
						{{
							healthOperational
								? $t('dms_automation.overview.execHealth.operational')
								: $t('dms_automation.overview.execHealth.needsAttention')
						}}
					</UBadge>
				</div>
				<div v-if="data" class="px-5 py-1 sm:px-6">
					<div
						v-for="m in healthMetrics"
						:key="m.label"
						class="flex items-center justify-between border-b border-default/60 py-2.5 last:border-0"
					>
						<span class="text-sm text-muted">{{ m.label }}</span>
						<span class="text-sm font-medium tabular-nums text-highlighted">
							{{ m.value }}
						</span>
					</div>
				</div>
				<div v-else class="px-5 py-4 sm:px-6">
					<USkeleton class="h-40 w-full" />
				</div>
			</DmsCard>
		</div>

		<!-- Needs attention  +  Recent runs -->
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			<!-- Needs attention -->
			<DmsCard :padded="false" class="flex flex-col overflow-hidden">
				<div
					class="flex items-start justify-between gap-3 border-b border-default px-5 py-4 sm:px-6"
				>
					<div>
						<h2 class="font-semibold leading-tight text-highlighted">
							{{ $t('dms_automation.overview.needsAttention.title') }}
						</h2>
						<p class="text-xs text-muted">
							{{ $t('dms_automation.overview.needsAttention.subtitle') }}
						</p>
					</div>
					<DmsLink
						:to="proceduresLink"
						class="shrink-0 text-xs font-medium text-primary hover:underline"
					>
						{{ $t('dms_automation.overview.needsAttention.all') }}
					</DmsLink>
				</div>
				<div v-if="!data" class="px-5 py-4 sm:px-6">
					<USkeleton class="h-24 w-full" />
				</div>
				<div
					v-else-if="data.needsAttention.length === 0"
					class="px-5 py-10 text-center text-sm text-dimmed"
				>
					{{ $t('dms_automation.overview.needsAttention.empty') }}
				</div>
				<ul v-else class="flex flex-col">
					<li
						v-for="a in data.needsAttention"
						:key="a.procedureId"
						class="flex items-center gap-3 border-b border-default/60 px-5 py-3 last:border-0 sm:px-6"
					>
						<span
							class="grid size-8 shrink-0 place-items-center rounded-lg"
							:class="
								a.kind === 'failing'
									? 'bg-error/10 text-error'
									: 'bg-warning/10 text-warning'
							"
						>
							<UIcon
								:name="a.kind === 'failing' ? 'i-ph-x-circle' : 'i-ph-pause'"
								class="size-4"
							/>
						</span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-semibold text-highlighted">
								{{ a.name }}
							</div>
							<div class="truncate text-xs text-dimmed">
								<template v-if="a.kind === 'failing'">
									{{ $t('dms_automation.overview.needsAttention.failingDetail', { n: a.failed }) }}
								</template>
								<template v-else>
									{{ $t('dms_automation.overview.needsAttention.pausedDetail') }}
									<template v-if="a.lastRunAt">
										· {{ $t('dms_automation.overview.needsAttention.lastRun', { ago: timeAgo(a.lastRunAt) }) }}
									</template>
								</template>
							</div>
						</div>
						<DmsLink
							:to="procedureLink(a.procedureId)"
							class="flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
						>
							{{ $t('dms_automation.overview.needsAttention.open') }}
							<UIcon name="i-ph-caret-right" class="size-3.5" />
						</DmsLink>
					</li>
				</ul>
			</DmsCard>

			<!-- Recent runs -->
			<DmsCard :padded="false" class="flex flex-col overflow-hidden">
				<div
					class="flex items-center justify-between gap-3 border-b border-default px-5 py-4 sm:px-6"
				>
					<h2 class="font-semibold leading-tight text-highlighted">
						{{ $t('dms_automation.overview.recentRuns.title') }}
					</h2>
					<DmsLink
						:to="runsAllLink"
						class="shrink-0 text-xs font-medium text-primary hover:underline"
					>
						{{ $t('dms_automation.overview.recentRuns.viewAll') }}
					</DmsLink>
				</div>
				<div v-if="!data" class="px-5 py-4 sm:px-6">
					<USkeleton class="h-24 w-full" />
				</div>
				<div
					v-else-if="data.recentRuns.length === 0"
					class="px-5 py-10 text-center text-sm text-dimmed"
				>
					{{ $t('dms_automation.overview.recentRuns.empty') }}
				</div>
				<ul v-else class="flex flex-col">
					<li
						v-for="r in data.recentRuns"
						:key="r.runId"
						class="flex items-center gap-3 border-b border-default/60 px-5 py-3 last:border-0 sm:px-6"
					>
						<span
							class="grid size-7 shrink-0 place-items-center rounded-lg"
							:class="
								runIsFailed(r.status)
									? 'bg-error/10 text-error'
									: 'bg-success/10 text-success'
							"
						>
							<UIcon
								:name="runIsFailed(r.status) ? 'i-ph-x-circle' : 'i-ph-check'"
								class="size-4"
							/>
						</span>
						<div class="min-w-0 flex-1 truncate text-sm text-highlighted">
							{{ r.procedureName }}
						</div>
						<div class="shrink-0 text-xs tabular-nums text-dimmed">
							<span v-if="r.durationMs !== null">{{ formatDuration(r.durationMs) }} · </span>
							{{ $t('dms_automation.overview.recentRuns.ago', { ago: timeAgo(r.startedAt) }) }}
						</div>
					</li>
				</ul>
			</DmsCard>
		</div>
	</div>
</template>
