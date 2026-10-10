<script setup lang="ts">
import { computed } from 'vue'
import type { RunDetail } from '../../composables/useAutomationRuns'
import { describeDuration, describeTime, stepTitle } from '../../utils/describe'

// Each step of this run next to the same step in the last successful run:
// what got slower, and where this one stopped.

const props = defineProps<{ run: RunDetail }>()

const { processI18n } = useTranslation()

const rows = computed(() => {
	const before = props.run.lastSuccess?.stepDurations ?? {}
	const seen = new Set<string>()
	return props.run.trace.steps
		.filter((s) => {
			if (seen.has(s.nodeId)) return false
			seen.add(s.nodeId)
			return true
		})
		.map((s) => ({
			nodeId: s.nodeId,
			name: stepTitle(s.name, processI18n),
			before: before[s.nodeId] ?? null,
			now: s.durationMs,
			failed: s.status === 'failed',
		}))
})
</script>

<template>
	<div v-if="run.lastSuccess" class="flex flex-col">
		<div class="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 border-b border-default pb-1.5 font-mono text-[10.5px] text-dimmed uppercase">
			<span>{{ $t('dms_automation.trace.step') }}</span>
			<span class="text-right">{{ describeTime(run.lastSuccess.startedAt) }}</span>
			<span class="text-right">{{ $t('dms_automation.trace.now') }}</span>
		</div>
		<div
			v-for="row in rows"
			:key="row.nodeId"
			class="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 border-b border-default py-1.5 text-xs"
		>
			<span class="truncate text-toned">{{ row.name }}</span>
			<span class="text-right font-mono text-muted tabular-nums">{{ describeDuration(row.before) }}</span>
			<span class="text-right font-mono tabular-nums" :class="row.failed ? 'text-error' : 'text-toned'">
				{{ describeDuration(row.now) }}
			</span>
		</div>
	</div>
	<p v-else class="text-xs text-dimmed">{{ $t('dms_automation.trace.noSuccessYet') }}</p>
</template>
