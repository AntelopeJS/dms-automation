<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SkippedStep, TraceStep } from '../../composables/useAutomationRuns'
import { describeDuration, prettyJson, stepTitle, unwrapDescribed } from '../../utils/describe'
import { isJsonContainer, isJsonObject, isJsonValue, isNumber } from '../../utils/json'

const props = defineProps<{
	steps: TraceStep[]
	skipped: SkippedStep[]
	totalMs: number | null
	/** Draw only the steps that ran (the "Path only" switch). */
	pathOnly?: boolean
	/** Log entries dropped to keep the run small: the time line has a gap. */
	truncated?: number
}>()

const { processI18n } = useTranslation()
const open = ref<Set<number>>(new Set())
const toggledGroups = ref<Set<number>>(new Set())

const KIND_ICONS = new Map([
	['trigger', 'i-ph-lightning'],
	['action', 'i-ph-play-circle'],
	['if', 'i-ph-git-branch'],
	['switch', 'i-ph-arrows-split'],
	['foreach', 'i-ph-repeat'],
	['forRange', 'i-ph-repeat'],
	['retry', 'i-ph-arrow-clockwise'],
	['tryCatch', 'i-ph-shield-check'],
	['parallel', 'i-ph-git-fork'],
	['delay', 'i-ph-hourglass'],
	['setVariable', 'i-ph-pencil-simple'],
	['group', 'i-ph-stack'],
])

const UNFOLDED_ITERATIONS = 3
const MAX_INDENT = 6

type Tone = 'ok' | 'failed' | 'handled' | 'running' | 'truncated'

function toneOf(step: TraceStep): Tone {
	if (step.status === 'failed') return step.handled ? 'handled' : 'failed'
	return step.status
}

const BAR_CLASS: Record<Tone, string> = {
	ok: 'bg-success/70',
	failed: 'bg-error',
	handled: 'bg-warning',
	running: 'bg-info animate-pulse',
	truncated: 'bg-accented',
}
const TEXT_CLASS: Record<Tone, string> = {
	ok: 'text-muted',
	failed: 'text-error',
	handled: 'text-warning',
	running: 'text-muted',
	truncated: 'text-muted',
}
const ROW_CLASS: Record<Tone, string> = { ok: '', failed: 'bg-error/5', handled: 'bg-warning/5', running: '', truncated: '' }

const span = computed(() => {
	const ends = props.steps.map((s) => s.startMs + (s.durationMs ?? 0))
	return Math.max(props.totalMs ?? 0, ...ends, 1)
})

function barStyle(startMs: number, durationMs: number | null) {
	const left = (startMs / span.value) * 100
	const width = Math.max(((durationMs ?? 0) / span.value) * 100, 0.6)
	return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }
}

function indent(depth: number) {
	return { paddingInlineStart: `${Math.min(depth, MAX_INDENT)}rem` }
}

interface IndexedStep {
	index: number
	step: TraceStep
}

/** The steps each step started (a loop's body, a try, a retry's attempts). */
const children = computed(() => {
	const map = new Map<number, IndexedStep[]>()
	props.steps.forEach((step, index) => {
		if (step.parent === undefined) return
		const list = map.get(step.parent) ?? []
		list.push({ index, step })
		map.set(step.parent, list)
	})
	return map
})

/** The fires holding a failure, at any depth, the ones that stopped the run apart. */
function firesWith(failure: (step: TraceStep) => boolean): Set<string> {
	const fires = new Set<string>()
	for (const step of props.steps) {
		if (!failure(step)) continue
		let current: TraceStep | undefined = step
		while (current) {
			fires.add(current.fireId)
			current = current.parent === undefined ? undefined : props.steps[current.parent]
		}
	}
	return fires
}
const failingFires = computed(() => firesWith((s) => s.status === 'failed'))
const fatalFires = computed(() => firesWith((s) => s.status === 'failed' && !s.handled))

interface StepRow {
	type: 'step'
	index: number
	step: TraceStep
	/** "#3", "attempt 2", or the port (try, catch) the step ran under. */
	tag?: string
}

interface GroupRow {
	type: 'group'
	parent: number
	depth: number
	count: number
	attempts: boolean
	failed: number
	/** Every failure in it was caught. */
	handled: boolean
	startMs: number
	durationMs: number
	unfolded: boolean
}

function tagOf(step: TraceStep): string | undefined {
	const parent = step.parent === undefined ? undefined : props.steps[step.parent]
	if (step.iteration !== undefined) {
		return parent?.name.kind === 'retry'
			? processI18n('$dms_automation.trace.attempt', { n: step.iteration + 1 })
			: `#${step.iteration + 1}`
	}
	return step.port && step.port !== 'body' ? step.port : undefined
}

/** The fires a step started, in order, each with its direct steps. */
function firesUnder(index: number): Array<[string, IndexedStep[]]> {
	const fires = new Map<string, IndexedStep[]>()
	for (const child of children.value.get(index) ?? []) {
		const fireId = child.step.fireId
		fires.set(fireId, [...(fires.get(fireId) ?? []), child])
	}
	return [...fires.entries()]
}

function groupRow({ index, step: parent }: IndexedStep, fires: Array<[string, IndexedStep[]]>, unfolded: boolean): GroupRow {
	const kids = fires.flatMap(([, list]) => list).map(({ step }) => step)
	const startMs = Math.min(...kids.map((s) => s.startMs))
	const endMs = Math.max(...kids.map((s) => s.startMs + (s.durationMs ?? 0)))
	return {
		type: 'group',
		parent: index,
		depth: parent.depth + 1,
		count: fires.length,
		attempts: parent.name.kind === 'retry',
		failed: fires.filter(([fireId]) => failingFires.value.has(fireId)).length,
		handled: !fires.some(([fireId]) => fatalFires.value.has(fireId)),
		startMs,
		durationMs: endMs - startMs,
		unfolded,
	}
}

const rows = computed(() => {
	const out: Array<StepRow | GroupRow> = []
	const visit = (current: IndexedStep) => {
		const { index, step } = current
		out.push({ type: 'step', index, step, tag: tagOf(step) })
		const fires = firesUnder(index)
		const iterated = fires.length > 1 && fires[0]?.[1][0]?.step.iteration !== undefined
		if (!iterated) {
			for (const [, list] of fires) list.forEach(visit)
			return
		}
		const unfolded = (fires.length <= UNFOLDED_ITERATIONS) !== toggledGroups.value.has(index)
		out.push(groupRow(current, fires, unfolded))
		for (const [fireId, list] of fires) {
			if (unfolded || failingFires.value.has(fireId)) list.forEach(visit)
		}
	}
	props.steps.forEach((step, index) => {
		if (step.parent === undefined) visit({ index, step })
	})
	return out
})

function toggle(index: number) {
	const next = new Set(open.value)
	if (next.has(index)) next.delete(index)
	else next.add(index)
	open.value = next
}

function toggleGroup(parent: number) {
	const next = new Set(toggledGroups.value)
	if (next.has(parent)) next.delete(parent)
	else next.add(parent)
	toggledGroups.value = next
}

/** One line saying what the step produced, or the branch it took. */
function outcome(step: TraceStep): string {
	if (step.status === 'failed') return step.error ?? ''
	if (step.status === 'truncated') return processI18n('$dms_automation.trace.cutFromLog')
	if (step.branch) return `→ ${step.branch}`
	const output = isJsonValue(step.output) && isJsonObject(step.output) ? step.output.value : undefined
	if (output === undefined || output === null) return ''
	if (!isJsonContainer(output)) return `→ ${String(output)}`
	const status = isJsonObject(output) ? output.status : undefined
	if (isNumber(status)) return `→ ${status}`
	const keys = Object.keys(output)
	return keys.length ? `→ { ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }` : ''
}

function shownJson(value: unknown): string {
	return isJsonValue(value) ? prettyJson(unwrapDescribed(value)) : ''
}

const QUARTERS = [0, 0.25, 0.5, 0.75, 1]
const SHORT_SPAN_MS = 10
const ticks = computed(() => {
	const fractions = span.value < SHORT_SPAN_MS ? [0, 1] : QUARTERS
	const seen = new Set<string>()
	return fractions
		.map((f) => ({ label: describeDuration(span.value * f), quarter: f === 0.25 || f === 0.75 }))
		.filter((tick) => !seen.has(tick.label) && seen.add(tick.label))
})

const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1.5 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem]'
const BAR_CELL = 'order-last col-span-2 @xl:order-none @xl:col-span-1'
const NAME_CLASS = 'break-words @xl:truncate'
</script>

<template>
	<div class="@container flex flex-col">
		<DmsNoticeBanner
			v-if="truncated"
			size="sm"
			tone="warning"
			icon="i-ph-scissors"
			class="m-3"
			:title="$t('dms_automation.trace.truncatedTitle', { count: truncated })"
			:description="$t('dms_automation.trace.truncatedHint')"
		/>

		<div :class="ROW_GRID" class="border-b border-default px-3 pb-2 font-mono text-[10.5px] text-dimmed uppercase">
			<span>{{ $t('dms_automation.trace.step') }}</span>
			<span :class="BAR_CELL" class="flex justify-between normal-case">
				<span v-for="tick in ticks" :key="tick.label" :class="tick.quarter ? '@max-xl:hidden' : ''">{{ tick.label }}</span>
			</span>
			<span class="text-right">{{ $t('dms_automation.trace.time') }}</span>
		</div>

		<template v-for="row in rows" :key="row.type === 'step' ? `s${row.index}` : `g${row.parent}`">
			<button
				v-if="row.type === 'group'"
				type="button"
				:class="ROW_GRID"
				class="border-b border-default px-3 py-1.5 text-left hover:bg-elevated/60"
				:aria-expanded="row.unfolded"
				@click="toggleGroup(row.parent)"
			>
				<span class="flex min-w-0 items-center gap-2 text-xs text-muted" :style="indent(row.depth)">
					<UIcon :name="row.unfolded ? 'i-ph-caret-down' : 'i-ph-caret-right'" class="size-3.5 shrink-0" />
					<span class="truncate">
						{{ $t(row.attempts ? 'dms_automation.trace.attempts' : 'dms_automation.trace.iterations', { count: row.count }, row.count) }}
						<template v-if="row.failed">
							· <span :class="row.handled ? 'text-warning' : 'text-error'">{{ $t('dms_automation.trace.iterationsFailed', { count: row.failed }) }}</span>
						</template>
					</span>
				</span>
				<span :class="BAR_CELL" class="relative h-1.5 rounded-full bg-elevated">
					<span class="absolute top-0 h-1.5 rounded-full bg-accented" :style="barStyle(row.startMs, row.durationMs)" />
				</span>
				<span class="text-right font-mono text-xs text-muted tabular-nums">{{ describeDuration(row.durationMs) }}</span>
			</button>

			<template v-else>
				<button
					type="button"
					:class="[ROW_GRID, ROW_CLASS[toneOf(row.step)]]"
					class="border-b border-default px-3 py-2 text-left hover:bg-elevated/60"
					:aria-expanded="open.has(row.index)"
					@click="toggle(row.index)"
				>
					<span class="flex min-w-0 items-center gap-2" :style="indent(row.step.depth)">
						<UIcon
							:name="KIND_ICONS.get(row.step.name.kind ?? '') ?? 'i-ph-circle'"
							class="size-4 shrink-0"
							:class="TEXT_CLASS[toneOf(row.step)]"
						/>
						<span class="flex min-w-0 flex-col">
							<span class="flex min-w-0 items-center gap-1.5">
								<span :class="NAME_CLASS" class="text-sm text-highlighted">{{ stepTitle(row.step.name, processI18n) }}</span>
								<UBadge v-if="row.tag" color="neutral" variant="soft" size="sm" class="shrink-0 font-mono">{{ row.tag }}</UBadge>
								<UBadge v-if="row.step.handled" color="warning" variant="subtle" size="sm" class="shrink-0">
									{{ $t('dms_automation.trace.handled') }}
								</UBadge>
							</span>
							<span class="truncate font-mono text-[11px]" :class="row.step.status === 'failed' ? TEXT_CLASS[toneOf(row.step)] : 'text-muted'">
								{{ outcome(row.step) || (row.step.name.typeName ? processI18n(row.step.name.typeName) : row.step.name.kind) }}
							</span>
						</span>
					</span>
					<span :class="BAR_CELL" class="relative h-2 rounded-full bg-elevated">
						<span class="absolute top-0 h-2 rounded-full" :class="BAR_CLASS[toneOf(row.step)]" :style="barStyle(row.step.startMs, row.step.durationMs)" />
					</span>
					<span class="text-right font-mono text-xs tabular-nums" :class="TEXT_CLASS[toneOf(row.step)]">
						{{ describeDuration(row.step.durationMs) }}
					</span>
				</button>
				<div v-if="open.has(row.index)" class="grid gap-3 border-b border-default bg-elevated/40 px-3 py-3 @2xl:grid-cols-2">
					<div class="flex min-w-0 flex-col gap-1">
						<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.trace.input') }}</span>
						<pre class="max-h-64 overflow-auto rounded-md bg-default p-2 font-mono text-xs text-toned">{{ shownJson(row.step.inputs) || '—' }}</pre>
					</div>
					<div class="flex min-w-0 flex-col gap-1">
						<span class="font-mono text-[10.5px] text-dimmed uppercase">
							{{ row.step.status === 'failed' ? $t('dms_automation.trace.error') : $t('dms_automation.trace.output') }}
						</span>
						<pre
							class="max-h-64 overflow-auto rounded-md bg-default p-2 font-mono text-xs whitespace-pre-wrap"
							:class="row.step.status === 'failed' ? TEXT_CLASS[toneOf(row.step)] : 'text-toned'"
						>{{ row.step.status === 'failed' ? row.step.error : shownJson(row.step.output) || '—' }}</pre>
					</div>
				</div>
			</template>
		</template>

		<template v-if="!pathOnly">
			<div
				v-for="step in skipped"
				:key="`skipped-${step.nodeId}`"
				:class="ROW_GRID"
				class="border-b border-default px-3 py-2"
			>
				<span class="flex min-w-0 items-center gap-2">
					<UIcon name="i-ph-circle-dashed" class="size-4 shrink-0 text-muted" />
					<span class="flex min-w-0 flex-col">
						<span :class="NAME_CLASS" class="text-sm text-muted">{{ stepTitle(step.name, processI18n) }}</span>
						<span class="truncate font-mono text-[11px] text-muted">
							{{ step.reason === 'stopped' ? $t('dms_automation.trace.notReached') : $t('dms_automation.trace.branchNotTaken') }}
						</span>
					</span>
				</span>
				<span :class="BAR_CELL" class="h-2 rounded-full border border-dashed border-default" />
				<span class="text-right font-mono text-xs text-muted">{{ $t('dms_automation.trace.skipped') }}</span>
			</div>
		</template>

		<p v-if="steps.length === 0" class="px-3 py-6 text-center text-sm text-muted">
			{{ $t('dms_automation.trace.noSteps') }}
		</p>
	</div>
</template>
