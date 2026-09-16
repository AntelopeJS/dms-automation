<script setup lang="ts">
import { computed } from 'vue'
import type {
	FireNode,
	LogEntry,
	RunDetail,
} from '../composables/useAutomationRuns'
import RunFireTree from './RunFireTree.vue'

const props = defineProps<{
	run: RunDetail
	procedureName?: string
}>()

const statusColor = computed<'success' | 'error' | 'warning' | 'neutral'>(
	() => {
		if (props.run.status === 'ok') return 'success'
		if (props.run.status === 'failed') return 'error'
		return 'neutral'
	},
)

const startedAt = computed(() =>
	props.run.startedAt ? new Date(props.run.startedAt).toLocaleString() : '—',
)

const durationMs = computed<string>(() => {
	if (!props.run.startedAt || !props.run.endedAt) return '—'
	const s = new Date(props.run.startedAt).getTime()
	const e = new Date(props.run.endedAt).getTime()
	if (Number.isNaN(s) || Number.isNaN(e)) return '—'
	return `${e - s} ms`
})

function prettyJson(text?: string | null): string {
	if (!text) return ''
	try {
		return JSON.stringify(JSON.parse(text), null, 2)
	} catch {
		return text
	}
}

const payloadJson = computed(() => prettyJson(props.run.triggerPayload))
const hasPayload = computed(
	() => !!props.run.triggerPayload && props.run.triggerPayload !== '{}',
)

const fires = computed<FireNode[]>(() => props.run.logs?.fires ?? [])
const entries = computed<LogEntry[]>(() => props.run.logs?.entries ?? [])
const hasLogs = computed(
	() => fires.value.length > 0 || entries.value.length > 0,
)

// Index entries and child fires by their parent fire id so the recursive
// RunFireTree component can do constant-time lookups while rendering.
const childrenOf = computed<Map<string, FireNode[]>>(() => {
	const m = new Map<string, FireNode[]>()
	for (const f of fires.value) {
		if (f.parentFireId === null) continue
		let list = m.get(f.parentFireId)
		if (!list) {
			list = []
			m.set(f.parentFireId, list)
		}
		list.push(f)
	}
	return m
})

const entriesOf = computed<Map<string, LogEntry[]>>(() => {
	const m = new Map<string, LogEntry[]>()
	for (const e of entries.value) {
		let list = m.get(e.fireId)
		if (!list) {
			list = []
			m.set(e.fireId, list)
		}
		list.push(e)
	}
	return m
})

const rootFires = computed<FireNode[]>(() =>
	fires.value.filter((f) => f.parentFireId === null),
)
</script>

<template>
	<div class="flex flex-col gap-4 p-1">
		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<UBadge :color="statusColor" variant="subtle" class="font-semibold">
					{{ run.status.toUpperCase() }}
				</UBadge>
				<code
					class="rounded-md bg-muted px-2 py-1 font-mono text-sm text-highlighted"
				>
					{{ procedureName ?? run.procedureId }}
				</code>
			</div>
			<div class="flex flex-wrap items-center gap-2 text-xs text-dimmed">
				<span class="tabular-nums">{{ durationMs }}</span>
				<span>·</span>
				<span class="tabular-nums">{{ startedAt }}</span>
				<span v-if="run.triggerNodeId">
					· {{ $t('dms_automation.runs.detail.trigger') }}
					<code class="font-mono">{{ run.triggerNodeId }}</code>
				</span>
			</div>
			<p class="text-xs text-muted">
				{{ $t('dms_automation.runs.detail.runId') }}
				<code class="font-mono">{{ run._id }}</code>
			</p>
		</div>

		<USeparator />

		<section v-if="run.errorMessage" class="flex flex-col gap-2">
			<h4 class="text-sm font-semibold text-error">
				{{ $t('dms_automation.runs.detail.error') }}
			</h4>
			<pre
				class="max-h-48 overflow-auto rounded-lg border border-default bg-muted p-3 text-[11px] text-toned"
			>{{ run.errorMessage }}</pre>
		</section>

		<section v-if="hasPayload" class="flex flex-col gap-2">
			<h4 class="text-sm font-semibold text-highlighted">
				{{ $t('dms_automation.runs.detail.triggerPayload') }}
			</h4>
			<pre
				class="max-h-64 overflow-auto rounded-lg border border-default bg-muted p-3 text-[11px] text-toned"
			>{{ payloadJson }}</pre>
		</section>

		<section class="flex flex-col gap-2">
			<h4 class="text-sm font-semibold text-highlighted">
				{{ $t('dms_automation.runs.detail.logs') }}
			</h4>
			<p v-if="!hasLogs" class="text-xs italic text-dimmed">
				{{ $t('dms_automation.runs.detail.noLogs') }}
			</p>
			<div
				v-else
				class="flex flex-col overflow-hidden rounded-lg border border-default"
			>
				<RunFireTree
					v-for="fire in rootFires"
					:key="fire.id"
					:fire="fire"
					:children-of="childrenOf"
					:entries-of="entriesOf"
				/>
			</div>
		</section>

		<p
			v-if="!run.errorMessage && !hasPayload && !hasLogs"
			class="text-xs italic text-dimmed"
		>
			{{ $t('dms_automation.runs.detail.none') }}
		</p>
	</div>
</template>
