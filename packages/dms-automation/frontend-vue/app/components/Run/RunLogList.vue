<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LogEntry, RunLog } from '../../composables/useAutomationRuns'
import { prettyJson, stepTitle, type StepName } from '../../utils/describe'

// The run's log as a flat, timed list: every executor event and every
// message a step wrote, named by step instead of node id.

const props = defineProps<{
	log: RunLog | undefined
	names: Map<string, StepName>
}>()

const { processI18n } = useTranslation()
const expanded = ref<Set<number>>(new Set())

const entries = computed<LogEntry[]>(() =>
	[...(props.log?.entries ?? [])].sort((a, b) => a.ts - b.ts || a.seq - b.seq),
)

const LEVEL_ICON = {
	error: { name: 'i-ph-x-circle', class: 'text-error' },
	warn: { name: 'i-ph-warning', class: 'text-warning' },
	info: { name: 'i-ph-dot-outline', class: 'text-dimmed' },
} as const

function stepOf(entry: LogEntry): string {
	if (!entry.nodeId) return entry.source
	const name = props.names.get(entry.nodeId)
	return name ? stepTitle(name, processI18n) : entry.nodeId
}

function toggle(seq: number) {
	const next = new Set(expanded.value)
	if (next.has(seq)) next.delete(seq)
	else next.add(seq)
	expanded.value = next
}
</script>

<template>
	<div class="flex flex-col">
		<div v-for="entry in entries" :key="entry.seq" class="border-b border-default">
			<button
				type="button"
				class="grid w-full grid-cols-[5rem_1rem_minmax(0,1fr)_minmax(0,12rem)] items-start gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-elevated/60"
				:disabled="entry.value === undefined"
				@click="toggle(entry.seq)"
			>
				<span class="text-dimmed tabular-nums">+{{ entry.ts }} ms</span>
				<UIcon :name="LEVEL_ICON[entry.level].name" class="mt-0.5 size-3.5" :class="LEVEL_ICON[entry.level].class" />
				<span class="break-words" :class="entry.level === 'error' ? 'text-error' : 'text-toned'">{{ entry.message }}</span>
				<span class="truncate text-right text-dimmed">{{ stepOf(entry) }}</span>
			</button>
			<pre
				v-if="expanded.has(entry.seq)"
				class="mx-3 mb-2 max-h-64 overflow-auto rounded-md bg-elevated p-2 font-mono text-xs text-toned"
			>{{ prettyJson(entry.value) }}</pre>
		</div>
		<p class="px-3 py-2 font-mono text-[11px] text-dimmed">
			{{ $t('dms_automation.trace.logComplete', { count: entries.length }) }}
			<template v-if="log?.truncated">· {{ $t('dms_automation.trace.logTruncated', { count: log.truncated }) }}</template>
		</p>
	</div>
</template>
