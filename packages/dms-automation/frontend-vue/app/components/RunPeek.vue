<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { type RunDetail, useAutomationRuns } from '../composables/useAutomationRuns'
import { useRunActions } from '../composables/useRunActions'
import { describeDuration, describeTrigger } from '../utils/describe'

// The quick look at a run, in the run history's drawer: what it did, where it
// failed, the path it took and its payload, with the next actions. J / K step
// through the rows of the table.

interface RowNavigation {
	index: number
	total: number
	hasPrev: boolean
	hasNext: boolean
	prev: () => void
	next: () => void
}

const props = defineProps<{
	rowData?: { _id?: string }
	navigation?: RowNavigation
	apiUrl: string
	traceUrl: string
	builderUrl: string
}>()

const router = useDmsRouter()
const { processI18n } = useTranslation()
const { t, locale } = useI18n()
const runs = useAutomationRuns(props.apiUrl)
const { rerun, rerunning } = useRunActions({ apiUrl: props.apiUrl, traceUrl: props.traceUrl })

const run = ref<RunDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const section = ref<'summary' | 'payload' | 'logs'>('summary')

async function load(id: string | undefined) {
	if (!id) return
	loading.value = true
	try {
		run.value = await runs.getRun(id)
		error.value = null
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

watch(() => props.rowData?._id, (id) => void load(id), { immediate: true })

const failed = computed(() => run.value?.status === 'failed')
const procedureName = computed(() => run.value?.procedure?.name ?? t('dms_automation.feed.deletedProcedure'))
const names = computed(() => new Map((run.value?.trace.steps ?? []).map((s) => [s.nodeId, s.name])))

const when = computed(() =>
	run.value
		? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(run.value.startedAt))
		: '',
)

const sections = computed(() => [
	{ label: t('dms_automation.trace.tabs.summary'), value: 'summary' },
	{ label: t('dms_automation.trace.tabs.payload'), value: 'payload' },
	{ label: t('dms_automation.trace.tabs.logs'), value: 'logs', badge: run.value?.logs?.entries.length },
])

function go(url: string) {
	void router.push(url)
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<div v-if="navigation" class="flex items-center justify-between text-xs text-muted">
			<span class="font-mono">{{ navigation.index + 1 }} / {{ navigation.total }}</span>
			<div class="flex items-center gap-1">
				<UButton size="xs" variant="ghost" color="neutral" icon="i-ph-caret-up" :disabled="!navigation.hasPrev" :aria-label="$t('dms_automation.common.previous')" @click="navigation.prev()" />
				<UButton size="xs" variant="ghost" color="neutral" icon="i-ph-caret-down" :disabled="!navigation.hasNext" :aria-label="$t('dms_automation.common.next')" @click="navigation.next()" />
				<UKbd value="J" /><UKbd value="K" />
			</div>
		</div>

		<div v-if="loading && !run" class="flex flex-col gap-3">
			<USkeleton class="h-6 w-60" />
			<USkeleton class="h-24 w-full" />
			<USkeleton class="h-40 w-full" />
		</div>

		<DmsEmptyState v-else-if="error && !run" variant="error" :title="$t('dms_automation.trace.loadError')" :description="error" />

		<template v-else-if="run">
			<div class="flex flex-col gap-1">
				<div class="flex flex-wrap items-center gap-2">
					<h3 class="text-base font-semibold text-highlighted">{{ procedureName }}</h3>
					<DmsStatusPill
						:tone="failed ? 'error' : 'success'"
						:label="failed ? $t('dms_automation.runs.status.failed') : $t('dms_automation.runs.status.ok')"
						size="sm"
					/>
					<UBadge v-if="run.kind === 'test'" color="info" variant="subtle" size="sm">{{ $t('dms_automation.runs.kind.test') }}</UBadge>
				</div>
				<p class="text-xs text-muted">
					{{ when }} · {{ describeDuration(run.durationMs, locale) }} · {{ describeTrigger(run.trigger, processI18n) }}
				</p>
			</div>

			<UTabs v-model="section" :items="sections" variant="link" :content="false" size="sm" />

			<template v-if="section === 'summary'">
				<DmsAutomationRunFailure v-if="failed" :run="run" />
				<div class="flex flex-col gap-2">
					<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.trace.pathTaken') }}</span>
					<DmsAutomationRunPathTaken :graph="run.graph" :steps="run.trace.steps" :failed-node-id="run.failedNodeId" />
				</div>
				<div class="flex flex-col gap-2">
					<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.trace.tabs.steps') }}</span>
					<DmsAutomationRunWaterfall :steps="run.trace.steps" :skipped="[]" :total-ms="run.durationMs" path-only />
				</div>
			</template>
			<DmsAutomationRunPayload v-else-if="section === 'payload'" :raw="run.triggerPayload" :kept="run.payloadKept" />
			<DmsAutomationRunLogList v-else :log="run.logs" :names="names" />

			<div class="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-default bg-default pt-3">
				<UButton
					v-if="run.procedure && run.payloadKept"
					color="neutral"
					variant="outline"
					icon="i-ph-arrow-clockwise"
					:loading="rerunning"
					@click="rerun(run._id, procedureName)"
				>
					{{ $t('dms_automation.runs.rerunWithPayload') }}
				</UButton>
				<UButton color="neutral" variant="outline" icon="i-ph-path" @click="go(`${traceUrl}?run=${run._id}`)">
					{{ $t('dms_automation.runs.trace') }}
				</UButton>
				<UButton
					v-if="run.procedure"
					color="primary"
					icon="i-ph-bug"
					class="ml-auto"
					@click="go(`${builderUrl}?selected=${run.procedureId}&run=${run._id}`)"
				>
					{{ $t('dms_automation.trace.debugInBuilder') }}
				</UButton>
			</div>
		</template>
	</div>
</template>
