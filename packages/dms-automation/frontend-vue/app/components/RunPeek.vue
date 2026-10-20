<script setup lang="ts">
import { computed, ref } from 'vue'
import { builderRunUrl, opensInBuilder, type RunDetail, useAutomationRuns } from '../composables/useAutomationRuns'
import { useFillScrollArea } from '../composables/useFillScrollArea'
import { useRunActions } from '../composables/useRunActions'
import { describeDateTime, describeDuration } from '../utils/describe'

// The quick look at a run, in the run history's drawer: what it did, where it
// failed, the path it took and its payload, with the next actions. The DMS
// drawer draws the row header (the procedure's name, "Run x of y" and the
// J / K navigation): the body does not name the run again.

const props = defineProps<{
	rowData?: { _id?: string }
	apiUrl: string
	traceUrl: string
	builderUrl: string
}>()

const router = useDmsRouter()
const { processText } = useComposedText()
const { t, locale } = useI18n()
const { dateTimeFormat } = useRegionalFormat()
const runs = useAutomationRuns(props.apiUrl)
const { rerun, rerunning } = useRunActions({ apiUrl: props.apiUrl, traceUrl: props.traceUrl })

// The run of the row opened, read once the drawer shows it. A run does not
// change once stored: the live page's refreshes leave it alone.
const runRead = runs.readRun(() => props.rowData?._id, { refreshOnPageRefresh: false })
const run = computed<RunDetail | null>(() => runRead.data.value)
const loading = computed(() => runRead.pending.value)
const error = computed(() => (runRead.error.value ? describeApiError(runRead.error.value) : null))
const section = ref<'summary' | 'payload' | 'logs'>('summary')

const failed = computed(() => run.value?.status === 'failed')
const procedureName = computed(
	() => run.value?.procedure?.name ?? run.value?.procedureName ?? t('dms_automation.feed.deletedProcedure'),
)
const names = computed(() => new Map((run.value?.trace.steps ?? []).map((s) => [s.nodeId, s.name])))

const when = computed(() => describeDateTime(run.value?.startedAt, dateTimeFormat))

const sections = computed(() => [
	{ label: t('dms_automation.trace.tabs.summary'), value: 'summary' },
	{ label: t('dms_automation.trace.tabs.payload'), value: 'payload' },
	{ label: t('dms_automation.trace.tabs.logs'), value: 'logs', badge: run.value?.logCount ?? run.value?.logs?.entries.length },
])

// The actions sit at the bottom of the drawer, the content scrolling under them.
const root = ref<HTMLElement>()
const minHeight = useFillScrollArea(root)

function go(url: string) {
	void router.push(url)
}
</script>

<template>
	<div ref="root" class="flex flex-col gap-4" :style="{ minHeight }">
		<div v-if="loading && !run" class="flex flex-col gap-3">
			<USkeleton class="h-6 w-60" />
			<USkeleton class="h-24 w-full" />
			<USkeleton class="h-40 w-full" />
		</div>

		<DmsEmptyState v-else-if="error && !run" variant="error" :title="$t('dms_automation.trace.loadError')" :description="error" />

		<template v-else-if="run">
			<div class="flex flex-col gap-1">
				<div class="flex flex-wrap items-center gap-2">
					<DmsStatusPill
						:tone="failed ? 'error' : 'success'"
						:label="failed ? $t('dms_automation.runs.status.failed') : $t('dms_automation.runs.status.ok')"
						size="sm"
					/>
					<UBadge v-if="run.kind === 'test'" color="info" variant="subtle" size="sm">{{ $t('dms_automation.runs.kind.test') }}</UBadge>
					<UBadge v-if="!run.procedure" color="neutral" variant="subtle" size="sm">{{ $t('dms_automation.trace.deleted') }}</UBadge>
				</div>
				<p class="text-xs text-muted">
					{{ when }} · {{ describeDuration(run.durationMs, locale) }} · {{ processText(run.triggerText) }}
				</p>
			</div>

			<UTabs v-model="section" :items="sections" variant="link" :content="false" size="sm" />

			<template v-if="section === 'summary'">
				<DmsAutomationRunFailure v-if="failed" :run="run" :trace-url="traceUrl" />
				<div class="flex flex-col gap-2">
					<DmsEyebrow as="h4" :label="$t('dms_automation.trace.pathTaken')" />
					<DmsAutomationRunPathTaken :run="run" :builder-url="builderUrl" />
				</div>
				<div class="flex flex-col gap-2">
					<DmsEyebrow as="h4" :label="$t('dms_automation.trace.tabs.steps')" />
					<DmsAutomationRunWaterfall :steps="run.trace.steps" :skipped="[]" :total-ms="run.durationMs" :truncated="run.trace.truncated" path-only />
				</div>
			</template>
			<DmsAutomationRunPayload v-else-if="section === 'payload'" :raw="run.triggerPayload" :kept="run.payloadKept" />
			<DmsAutomationRunLogList v-else :api-url="apiUrl" :run-id="run._id" :log="run.logs" :names="names" />

			<!-- Flush with the drawer's bottom edge, over the body's padding (as a
				DMS form's footer). Labels stay on one line: a narrow drawer wraps the
				buttons instead, Re-run being an icon with its name in a tooltip. -->
			<div
				class="sticky bottom-[calc(var(--dms-form-foot-pb,0px)*-1)] z-10 -mx-[var(--dms-form-foot-px,0px)] mt-auto -mb-[var(--dms-form-foot-pb,0px)] flex flex-wrap items-center gap-2 border-t border-default bg-default px-[var(--dms-form-foot-px,0px)] pt-3 pb-[var(--dms-form-foot-pb,12px)]"
			>
				<UTooltip v-if="run.procedure && run.payloadKept" :text="$t('dms_automation.runs.rerunWithPayload')">
					<UButton
						color="neutral"
						variant="outline"
						icon="i-ph-arrow-clockwise"
						:aria-label="$t('dms_automation.runs.rerunWithPayload')"
						:loading="rerunning"
						@click="rerun(run._id, procedureName)"
					/>
				</UTooltip>
				<UButton
					color="neutral"
					variant="outline"
					icon="i-ph-path"
					class="whitespace-nowrap"
					@click="go(`${traceUrl}?run=${encodeURIComponent(run._id)}`)"
				>
					{{ $t('dms_automation.runs.trace') }}
				</UButton>
				<UTooltip v-if="run.procedure" :text="opensInBuilder(run) ? '' : $t('dms_automation.trace.builderDraftHint')" :disabled="opensInBuilder(run)">
					<span class="ml-auto inline-flex">
						<UButton color="primary" icon="i-ph-bug" class="whitespace-nowrap" :disabled="!opensInBuilder(run)" @click="go(builderRunUrl(builderUrl, run))">
							{{ $t('dms_automation.trace.debugInBuilder') }}
						</UButton>
					</span>
				</UTooltip>
			</div>
		</template>
	</div>
</template>
