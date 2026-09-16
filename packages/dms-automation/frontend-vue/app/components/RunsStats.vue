<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { formatDuration } from '../utils/automation'

// Page-level header + KPI cards for the Runs page, rendered ABOVE the TableView
// (registered as `dms-automation-runs-stats`, wired via `static stats` in
// src/pages/runs.ts). Self-contained: fetches its own stats snapshot. The run
// list, tabs, filters, export and pagination are owned by the TableView below.

const { $authFetch } = useAuthFetch()

interface StatsSnapshot {
	health: { '24h': { avgDurationMs: number } }
	runsPerDay7d: Array<{ day: string; ok: number; failed: number }>
}

const stats = ref<StatsSnapshot | null>(null)
const loading = ref(false)

const kpis = computed(() => {
	const days = stats.value?.runsPerDay7d ?? []
	const today = days[days.length - 1] ?? { ok: 0, failed: 0 }
	return [
		{
			key: 'today',
			title: '$dms_automation.runs.kpis.today',
			value: today.ok + today.failed,
			icon: 'i-ph-activity',
		},
		{
			key: 'success',
			title: '$dms_automation.runs.kpis.success',
			value: today.ok,
			icon: 'i-ph-check-circle',
		},
		{
			key: 'failed',
			title: '$dms_automation.runs.kpis.failed',
			value: today.failed,
			icon: 'i-ph-x-circle',
		},
	]
})

const avgDurationLabel = computed(() =>
	formatDuration(stats.value?.health?.['24h']?.avgDurationMs ?? 0),
)

async function loadStats() {
	loading.value = true
	try {
		stats.value = await $authFetch<StatsSnapshot>('/api/automation/stats')
	} catch {
		/* KPIs are best-effort. */
	} finally {
		loading.value = false
	}
}

onMounted(loadStats)
</script>

<template>
	<!--
		Title / icon / description come from the page's native dms header
		(src/pages/runs.ts) — only the refresh action lives here.
	-->
	<div class="runs-stats flex flex-col gap-5">
		<section class="flex flex-wrap items-center justify-end gap-4">
			<UButton
				color="neutral"
				variant="ghost"
				icon="i-ph-arrows-clockwise"
				:loading="loading"
				:aria-label="$t('dms_automation.common.refresh')"
				@click="loadStats"
			/>
		</section>

		<!-- KPI stat cards -->
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<template v-if="stats">
				<DmsKpiCard
					v-for="k in kpis"
					:key="k.key"
					variant="stat"
					page-id="automation.runs"
					:component-id="`runs-kpi-${k.key}`"
					:title="k.title"
					:icon="k.icon"
					:static-value="k.value"
					value-format="compact"
					:show-delta="false"
				/>
				<DmsCard :padded="false" class="flex flex-col justify-between gap-2 p-4">
					<div class="flex items-center justify-between">
						<span class="font-mono text-[11px] uppercase tracking-wider text-dimmed">
							{{ $t('dms_automation.runs.kpis.avgDuration') }}
						</span>
						<UIcon name="i-ph-clock" class="size-4 text-dimmed" />
					</div>
					<span class="text-2xl font-semibold tabular-nums text-highlighted">
						{{ avgDurationLabel }}
					</span>
				</DmsCard>
			</template>
			<template v-else>
				<DmsCard v-for="i in 4" :key="`skel-${i}`" :padded="false" class="p-5">
					<USkeleton class="h-10 w-full" />
				</DmsCard>
			</template>
		</div>
	</div>
</template>

<style>
/* The Runs TableView sits directly under these KPI cards. Drop its native card
   frame (background/border/shadow) so the whole page reads as one flat section;
   the card's inner padding is kept so the table content stays aligned with the
   KPI grid above. Scoped to the runs page via the .runs-stats marker. */
.dms-page-stack:has(.runs-stats) .dms-card.flow-root {
	background-color: transparent;
	border-color: transparent;
	box-shadow: none;
}
</style>
