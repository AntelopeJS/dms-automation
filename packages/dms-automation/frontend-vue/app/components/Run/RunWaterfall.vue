<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TraceStep } from '../../composables/useAutomationRuns'
import { describeDuration, prettyJson, stepTitle, type StepName } from '../../utils/describe'

// The steps of a run on a time line: one row per step execution, named, with
// its duration bar placed where it ran. A click opens what it received and
// produced. Steps that never ran are listed greyed after the others.

const props = defineProps<{
	steps: TraceStep[]
	skipped: Array<{ nodeId: string; name: StepName }>
	totalMs: number | null
	/** Draw only the steps that ran (the "Path only" switch). */
	pathOnly?: boolean
}>()

const { processI18n } = useTranslation()
const open = ref<Set<number>>(new Set())

const KIND_ICONS: Record<string, string> = {
	trigger: 'i-ph-lightning',
	action: 'i-ph-play-circle',
	if: 'i-ph-git-branch',
	switch: 'i-ph-arrows-split',
	foreach: 'i-ph-repeat',
	forRange: 'i-ph-repeat',
	retry: 'i-ph-arrow-clockwise',
	tryCatch: 'i-ph-shield-check',
	parallel: 'i-ph-git-fork',
	delay: 'i-ph-hourglass',
	setVariable: 'i-ph-pencil-simple',
	group: 'i-ph-stack',
}

const span = computed(() => {
	const ends = props.steps.map((s) => s.startMs + (s.durationMs ?? 0))
	return Math.max(props.totalMs ?? 0, ...ends, 1)
})

function barStyle(step: TraceStep) {
	const left = (step.startMs / span.value) * 100
	const width = Math.max(((step.durationMs ?? 0) / span.value) * 100, 0.6)
	return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }
}

const BAR_CLASS = { ok: 'bg-success/70', failed: 'bg-error', running: 'bg-info animate-pulse' } as const

function toggle(index: number) {
	const next = new Set(open.value)
	if (next.has(index)) next.delete(index)
	else next.add(index)
	open.value = next
}

/** One line saying what the step produced. */
function outcome(step: TraceStep): string {
	if (step.status === 'failed') return step.error ?? ''
	const output = (step.output as { value?: unknown } | undefined)?.value
	if (output === undefined || output === null) return ''
	if (typeof output !== 'object') return `→ ${String(output)}`
	const status = (output as Record<string, unknown>).status
	if (typeof status === 'number') return `→ ${status}`
	const keys = Object.keys(output)
	return keys.length ? `→ { ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }` : ''
}

function unwrap(described: unknown): unknown {
	if (!described || typeof described !== 'object') return described
	if ('value' in described && 'type' in described) return (described as { value: unknown }).value
	return Object.fromEntries(
		Object.entries(described as Record<string, unknown>).map(([k, v]) => [k, unwrap(v)]),
	)
}

const ticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((f) => describeDuration(Math.round(span.value * f))))
</script>

<template>
	<div class="flex flex-col">
		<div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] items-center gap-3 border-b border-default px-3 pb-2 font-mono text-[10.5px] text-dimmed uppercase">
			<span>{{ $t('dms_automation.trace.step') }}</span>
			<span class="flex justify-between normal-case">
				<span v-for="(tick, i) in ticks" :key="i">{{ tick }}</span>
			</span>
			<span class="text-right">{{ $t('dms_automation.trace.time') }}</span>
		</div>

		<template v-for="(step, index) in steps" :key="`${step.fireId}-${step.nodeId}-${index}`">
			<button
				type="button"
				class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] items-center gap-3 border-b border-default px-3 py-2 text-left hover:bg-elevated/60"
				:class="step.status === 'failed' ? 'bg-error/5' : ''"
				:aria-expanded="open.has(index)"
				@click="toggle(index)"
			>
				<span class="flex min-w-0 items-center gap-2">
					<UIcon
						:name="KIND_ICONS[step.name.kind ?? ''] ?? 'i-ph-circle'"
						class="size-4 shrink-0"
						:class="step.status === 'failed' ? 'text-error' : 'text-muted'"
					/>
					<span class="flex min-w-0 flex-col">
						<span class="truncate text-sm text-highlighted">{{ stepTitle(step.name, processI18n) }}</span>
						<span class="truncate font-mono text-[11px]" :class="step.status === 'failed' ? 'text-error' : 'text-dimmed'">
							{{ outcome(step) || (step.name.typeName ? processI18n(step.name.typeName) : step.name.kind) }}
						</span>
					</span>
				</span>
				<span class="relative h-2 rounded-full bg-elevated">
					<span class="absolute top-0 h-2 rounded-full" :class="BAR_CLASS[step.status]" :style="barStyle(step)" />
				</span>
				<span class="text-right font-mono text-xs tabular-nums" :class="step.status === 'failed' ? 'text-error' : 'text-muted'">
					{{ describeDuration(step.durationMs) }}
				</span>
			</button>
			<div v-if="open.has(index)" class="grid gap-3 border-b border-default bg-elevated/40 px-3 py-3 md:grid-cols-2">
				<div class="flex min-w-0 flex-col gap-1">
					<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.trace.input') }}</span>
					<pre class="max-h-64 overflow-auto rounded-md bg-default p-2 font-mono text-xs text-toned">{{ prettyJson(unwrap(step.inputs)) || '—' }}</pre>
				</div>
				<div class="flex min-w-0 flex-col gap-1">
					<span class="font-mono text-[10.5px] text-dimmed uppercase">
						{{ step.status === 'failed' ? $t('dms_automation.trace.error') : $t('dms_automation.trace.output') }}
					</span>
					<pre
						class="max-h-64 overflow-auto rounded-md bg-default p-2 font-mono text-xs"
						:class="step.status === 'failed' ? 'text-error' : 'text-toned'"
					>{{ step.status === 'failed' ? step.error : prettyJson(unwrap(step.output)) || '—' }}</pre>
				</div>
			</div>
		</template>

		<template v-if="!pathOnly">
			<div
				v-for="step in skipped"
				:key="`skipped-${step.nodeId}`"
				class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] items-center gap-3 border-b border-default px-3 py-2 opacity-60"
			>
				<span class="flex min-w-0 items-center gap-2">
					<UIcon name="i-ph-circle-dashed" class="size-4 shrink-0 text-dimmed" />
					<span class="flex min-w-0 flex-col">
						<span class="truncate text-sm text-muted">{{ stepTitle(step.name, processI18n) }}</span>
						<span class="truncate font-mono text-[11px] text-dimmed">{{ $t('dms_automation.trace.notOnPath') }}</span>
					</span>
				</span>
				<span class="h-2 rounded-full border border-dashed border-default" />
				<span class="text-right font-mono text-xs text-dimmed">{{ $t('dms_automation.trace.skipped') }}</span>
			</div>
		</template>

		<p v-if="steps.length === 0" class="px-3 py-6 text-center text-sm text-dimmed">
			{{ $t('dms_automation.trace.noSteps') }}
		</p>
	</div>
</template>
