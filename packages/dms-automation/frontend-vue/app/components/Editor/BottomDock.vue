<script setup lang="ts">
import { computed } from 'vue'
import type { TraceStep } from '../../composables/useAutomationRuns'
import { describeDuration, describeTime, stepTitle, type StepName } from '../../utils/describe'

// The builder's bottom dock: the graph's problems (each one selects its node),
// this procedure's last runs (same rows as the run history, each opening its
// trace), the payload Test run sends, and the steps of the test run on screen.

export interface DockIssue {
	severity: 'error' | 'warning'
	message: string
	nodeId?: string
	nodeName?: string
}

export interface DockRun {
	_id: string
	startedAt: string
	endedAt?: string | null
	status: string
	errorMessage?: string | null
	kind?: string
	failedStep?: StepName | null
}

export type DockTab = 'problems' | 'runs' | 'payload' | 'test'

const props = defineProps<{
	issues: DockIssue[]
	runs: DockRun[]
	testSteps: TraceStep[] | null
	payloadSource: string | null
	runsUrl: string
}>()

const tab = defineModel<DockTab>('tab', { default: 'problems' })
const payload = defineModel<string>('payload', { default: '{}' })
const collapsed = defineModel<boolean>('collapsed', { default: false })

const emit = defineEmits<{
	(e: 'select-node', id: string): void
	(e: 'open-trace', runId: string): void
}>()

const { processI18n } = useTranslation()

const failedRuns = computed(() => props.runs.filter((r) => r.status === 'failed').length)
const payloadError = computed(() => {
	try {
		JSON.parse(payload.value || 'null')
		return null
	} catch (e) {
		return (e as Error).message
	}
})

const tabs = computed(() => [
	...(props.testSteps ? [{ label: processI18n('$dms_automation.editor.dock.testRun'), value: 'test' }] : []),
	{ label: processI18n('$dms_automation.editor.dock.problems'), value: 'problems', badge: props.issues.length || undefined },
	{
		label: processI18n('$dms_automation.editor.dock.recentRuns'),
		value: 'runs',
		badge: failedRuns.value ? processI18n('$dms_automation.editor.dock.failedCount', { count: failedRuns.value }) : undefined,
	},
	{ label: processI18n('$dms_automation.editor.dock.payload'), value: 'payload' },
])

function durationOf(run: DockRun): number | null {
	return run.endedAt ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime() : null
}

function runLine(run: DockRun): string {
	if (run.status !== 'failed') return processI18n('$dms_automation.feed.completedPlain')
	const step = stepTitle(run.failedStep, processI18n)
	return step ? `${step} · ${run.errorMessage ?? ''}` : (run.errorMessage ?? '')
}
</script>

<template>
	<div class="flex min-h-0 flex-col border-t border-default bg-default" :class="collapsed ? '' : 'h-48'">
		<div class="flex items-center justify-between gap-2 px-3">
			<UTabs v-model="tab" :items="tabs" variant="link" size="xs" :content="false" @update:model-value="collapsed = false" />
			<UButton
				size="xs"
				variant="ghost"
				color="neutral"
				:icon="collapsed ? 'i-ph-caret-up' : 'i-ph-caret-down'"
				:aria-label="$t('dms_automation.editor.dock.toggle')"
				@click="collapsed = !collapsed"
			/>
		</div>
		<div v-if="!collapsed" class="min-h-0 flex-1 overflow-y-auto border-t border-default">
			<template v-if="tab === 'problems'">
				<p v-if="issues.length === 0" class="flex items-center gap-2 p-3 text-xs text-muted">
					<UIcon name="i-ph-check-circle" class="size-4 text-success" />
					{{ $t('dms_automation.editor.dock.noProblems') }}
				</p>
				<div v-for="(issue, index) in issues" :key="index" class="flex items-center gap-3 border-b border-default px-3 py-2 text-xs">
					<UIcon name="i-ph-warning" class="size-4 shrink-0" :class="issue.severity === 'error' ? 'text-error' : 'text-warning'" />
					<span class="min-w-0 flex-1">
						<span v-if="issue.nodeName" class="font-medium text-highlighted">{{ issue.nodeName }} — </span>
						<span class="text-toned">{{ issue.message }}</span>
					</span>
					<UButton v-if="issue.nodeId" size="xs" variant="soft" color="neutral" @click="emit('select-node', issue.nodeId!)">
						{{ $t('dms_automation.editor.dock.selectNode') }}
					</UButton>
				</div>
			</template>

			<template v-else-if="tab === 'runs'">
				<p v-if="runs.length === 0" class="p-3 text-xs text-muted">{{ $t('dms_automation.editor.dock.noRuns') }}</p>
				<button
					v-for="run in runs"
					:key="run._id"
					type="button"
					class="flex w-full items-center gap-3 border-b border-default px-3 py-2 text-left text-xs hover:bg-elevated/60"
					@click="emit('open-trace', run._id)"
				>
					<UIcon
						:name="run.status === 'failed' ? 'i-ph-x-circle' : 'i-ph-check-circle'"
						class="size-4 shrink-0"
						:class="run.status === 'failed' ? 'text-error' : 'text-success'"
					/>
					<span class="min-w-0 flex-1 truncate" :class="run.status === 'failed' ? 'text-error' : 'text-toned'">{{ runLine(run) }}</span>
					<UBadge v-if="run.kind === 'test'" size="sm" variant="subtle" color="info">{{ $t('dms_automation.runs.kind.test') }}</UBadge>
					<span class="font-mono text-muted">{{ describeDuration(durationOf(run)) }}</span>
					<span class="w-24 text-right font-mono text-dimmed">{{ describeTime(run.startedAt) }}</span>
				</button>
				<DmsLink :to="runsUrl" class="block px-3 py-2 text-xs text-primary hover:underline">
					{{ $t('dms_automation.editor.dock.allRuns') }}
				</DmsLink>
			</template>

			<div v-else-if="tab === 'payload'" class="flex h-full flex-col gap-2 p-3">
				<div class="flex items-center justify-between gap-2 text-xs">
					<span class="text-muted">
						{{ payloadSource ? $t('dms_automation.editor.dock.payloadFrom', { run: payloadSource.slice(-6) }) : $t('dms_automation.editor.dock.payloadHint') }}
					</span>
					<span v-if="payloadError" class="text-error">{{ $t('dms_automation.editor.dock.invalidJson') }}</span>
				</div>
				<UTextarea v-model="payload" :rows="5" class="w-full flex-1 font-mono text-xs" autoresize :maxrows="12" />
			</div>

			<div v-else-if="tab === 'test' && testSteps">
				<p class="flex items-center gap-2 border-b border-default px-3 py-2 text-xs text-warning">
					<UIcon name="i-ph-warning" class="size-4" />
					{{ $t('dms_automation.editor.dock.sideEffects') }}
				</p>
				<button
					v-for="(step, index) in testSteps"
					:key="`${step.nodeId}-${index}`"
					type="button"
					class="flex w-full items-center gap-3 border-b border-default px-3 py-2 text-left text-xs hover:bg-elevated/60"
					@click="emit('select-node', step.nodeId.split('__')[0]!)"
				>
					<UIcon
						:name="step.status === 'failed' ? 'i-ph-x-circle' : 'i-ph-check-circle'"
						class="size-4 shrink-0"
						:class="step.status === 'failed' ? 'text-error' : 'text-success'"
					/>
					<span class="min-w-0 flex-1 truncate" :class="step.status === 'failed' ? 'text-error' : 'text-toned'">
						{{ stepTitle(step.name, processI18n) }}<template v-if="step.error"> · {{ step.error }}</template>
					</span>
					<span class="font-mono text-muted">{{ describeDuration(step.durationMs) }}</span>
					<span class="w-16 text-right font-mono text-dimmed">+{{ step.startMs }} ms</span>
				</button>
			</div>
		</div>
	</div>
</template>
