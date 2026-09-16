<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
	FireNode,
	LogEntry,
} from '../composables/useAutomationRuns'

const props = defineProps<{
	fire: FireNode
	childrenOf: Map<string, FireNode[]>
	entriesOf: Map<string, LogEntry[]>
}>()

defineOptions({ name: 'RunFireTree' })

const open = ref(true)
function toggle() {
	open.value = !open.value
}

const ownEntries = computed<LogEntry[]>(
	() => props.entriesOf.get(props.fire.id) ?? [],
)
const childFires = computed<FireNode[]>(
	() => props.childrenOf.get(props.fire.id) ?? [],
)

type Item =
	| { kind: 'entry'; ts: number; seq: number; entry: LogEntry }
	| { kind: 'fire'; ts: number; seq: number; fire: FireNode }

// Chronological interleave of own log entries and child fires within this
// fire's scope. Sort by ts first; break ties with `seq` (the executor's
// monotonic event counter) so sub-millisecond iterations preserve their
// logical order — without this, "run ok" sometimes appears between
// iterations because the entry was pushed into the merge first.
const items = computed<Item[]>(() => {
	const merged: Item[] = []
	for (const entry of ownEntries.value) {
		merged.push({ kind: 'entry', ts: entry.ts, seq: entry.seq, entry })
	}
	for (const child of childFires.value) {
		merged.push({ kind: 'fire', ts: child.ts, seq: child.seq, fire: child })
	}
	merged.sort((a, b) => a.ts - b.ts || a.seq - b.seq)
	return merged
})

const headerLabel = computed(() => {
	const f = props.fire
	const port = f.port ? ` · ${f.port}` : ''
	const iter =
		typeof f.iteration === 'number' ? ` · iter ${f.iteration}` : ''
	return `${f.sourceNodeId}${port}${iter}`
})

const durationLabel = computed(() => {
	const f = props.fire
	if (typeof f.closedAt !== 'number') return '…'
	return `${f.closedAt - f.ts} ms`
})

// Track expanded entries by `seq` (executor-emitted, stable across
// reflows). Index-based keying flips state every time logs arrive in
// a different order.
const expandedEntrySeq = ref<Set<number>>(new Set())
function toggleExpanded(seq: number) {
	if (expandedEntrySeq.value.has(seq)) expandedEntrySeq.value.delete(seq)
	else expandedEntrySeq.value.add(seq)
	expandedEntrySeq.value = new Set(expandedEntrySeq.value)
}

function iconFor(level: LogEntry['level']): { name: string; class: string } {
	if (level === 'error') return { name: 'i-ph-x-circle', class: 'text-error' }
	if (level === 'warn') return { name: 'i-ph-warning', class: 'text-warning' }
	return { name: 'i-ph-info', class: 'text-muted' }
}

function formatTs(ms: number): string {
	return `+${ms} ms`
}

function nodeLabel(entry: LogEntry): string {
	if (!entry.nodeId) return 'run'
	return entry.nodeKind ? `${entry.nodeKind} · ${entry.nodeId}` : entry.nodeId
}

function prettyValue(v: unknown): string {
	try {
		return JSON.stringify(v, null, 2)
	} catch {
		return String(v)
	}
}

// Short inline summary shown next to the message for `log`-source entries
// (e.g. `Body alpha`, `Body 42`). Falls back to a compact JSON snippet
// for arrays/objects; truncates anything longer than 40 chars.
function inlineSummary(v: unknown): string {
	if (v === undefined || v === null) return ''
	if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v
	if (typeof v === 'number' || typeof v === 'boolean') return String(v)
	try {
		const j = JSON.stringify(v)
		return j.length > 40 ? `${j.slice(0, 40)}…` : j
	} catch {
		return ''
	}
}
</script>

<template>
	<div class="flex flex-col">
		<button
			type="button"
			class="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 px-2 py-1 text-left text-xs hover:bg-elevated border-b border-default"
			@click="toggle"
		>
			<UIcon
				:name="open ? 'i-ph-caret-down' : 'i-ph-caret-right'"
				class="text-dimmed"
			/>
			<span class="font-mono tabular-nums text-dimmed">{{ formatTs(fire.ts) }}</span>
			<span class="font-mono text-default truncate">{{ headerLabel }}</span>
			<span class="font-mono tabular-nums text-dimmed">{{ durationLabel }}</span>
		</button>
		<div v-if="open" class="border-l-2 border-default pl-2 ml-2">
			<template v-for="item in items" :key="`${item.kind}-${item.seq}`">
				<RunFireTree
					v-if="item.kind === 'fire'"
					:fire="item.fire"
					:children-of="childrenOf"
					:entries-of="entriesOf"
				/>
				<div
					v-else
					class="border-b border-default last:border-b-0"
				>
					<button
						type="button"
						class="grid w-full grid-cols-[auto_auto_auto_1fr_auto] items-center gap-2 px-2 py-1 text-left text-xs hover:bg-elevated"
						:disabled="item.entry.value === undefined"
						@click="toggleExpanded(item.seq)"
					>
						<span class="font-mono tabular-nums text-dimmed">{{ formatTs(item.entry.ts) }}</span>
						<UIcon :name="iconFor(item.entry.level).name" :class="iconFor(item.entry.level).class" />
						<span class="font-mono text-muted truncate">{{ nodeLabel(item.entry) }}</span>
						<span class="truncate text-default">
							<span v-if="item.entry.source === 'exec'" class="mr-1 inline-block rounded bg-elevated px-1 py-px text-[10px] uppercase text-dimmed">exec</span>
							{{ item.entry.message }}
							<span
								v-if="item.entry.source === 'log' && inlineSummary(item.entry.value)"
								class="ml-2 font-mono text-dimmed"
							>{{ inlineSummary(item.entry.value) }}</span>
						</span>
						<UIcon
							v-if="item.entry.value !== undefined"
							:name="expandedEntrySeq.has(item.seq) ? 'i-ph-caret-down' : 'i-ph-caret-right'"
							class="text-dimmed"
						/>
					</button>
					<pre
						v-if="item.entry.value !== undefined && expandedEntrySeq.has(item.seq)"
						class="max-h-48 overflow-auto bg-elevated px-3 py-2 text-[11px]"
					>{{ prettyValue(item.entry.value) }}</pre>
				</div>
			</template>
		</div>
	</div>
</template>
