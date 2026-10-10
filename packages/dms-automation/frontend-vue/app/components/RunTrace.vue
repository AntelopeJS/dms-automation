<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { type RunDetail, useAutomationRuns } from '../composables/useAutomationRuns'
import { useRunActions } from '../composables/useRunActions'
import {
	describeDuration,
	describeTrigger,
	type StepName,
} from '../utils/describe'

// The run trace page (`?run=<id>`): one run, linkable. Its steps on a time
// line, the payload and the log in tabs; beside them, where it failed and why,
// the path it took, and how it compares with the last success.

const props = defineProps<{
	apiUrl: string
	runsUrl: string
	builderUrl: string
	traceUrl: string
}>()

const route = useDmsRoute()
const router = useDmsRouter()
const { processI18n } = useTranslation()
const { t, locale } = useI18n()
const runs = useAutomationRuns(props.apiUrl)
const { rerun, rerunning } = useRunActions({ apiUrl: props.apiUrl, traceUrl: props.traceUrl })

const runId = computed(() => {
	const q = route.query.run
	return typeof q === 'string' ? q : Array.isArray(q) ? (q[0] ?? null) : null
})

const run = ref<RunDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const tab = ref('steps')
const pathOnly = ref(false)

async function load() {
	if (!runId.value) {
		error.value = t('dms_automation.trace.noRun')
		loading.value = false
		return
	}
	loading.value = true
	try {
		run.value = await runs.getRun(runId.value)
		error.value = null
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

watch(runId, () => void load(), { immediate: true })

const names = computed(() => {
	const map = new Map<string, StepName>()
	for (const step of run.value?.trace.steps ?? []) map.set(step.nodeId, step.name)
	return map
})

const procedureName = computed(() => run.value?.procedure?.name ?? t('dms_automation.feed.deletedProcedure'))
const failed = computed(() => run.value?.status === 'failed')

const startedAt = computed(() =>
	run.value
		? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(run.value.startedAt))
		: '',
)

const stepPosition = computed(() => {
	const steps = run.value?.trace.steps ?? []
	const index = steps.findIndex((s) => s.status === 'failed')
	return { index: index + 1, total: steps.length + (run.value?.trace.skipped.length ?? 0) }
})

const durationDelta = computed(() => {
	const r = run.value
	if (!r || r.durationMs === null || r.usualDurationMs === null) return null
	return r.durationMs - r.usualDurationMs
})

const olderVersion = computed(() => {
	const r = run.value
	if (!r?.procedure || !r.procedureVersion) return false
	return r.procedureVersion < r.procedure.version
})

const stats = computed(() => {
	const r = run.value
	if (!r) return []
	const delta = durationDelta.value
	return [
		{
			id: 'status',
			eyebrow: t('dms_automation.trace.status'),
			value: failed.value ? t('dms_automation.runs.status.failed') : t('dms_automation.runs.status.ok'),
			detail: failed.value && stepPosition.value.index > 0
				? t('dms_automation.trace.atStep', stepPosition.value)
				: t('dms_automation.trace.stepsRan', { count: r.trace.steps.length }),
			detailTone: failed.value ? ('error' as const) : ('neutral' as const),
			icon: failed.value ? 'i-ph-x-circle' : 'i-ph-check-circle',
			tone: failed.value ? ('error' as const) : ('success' as const),
		},
		{
			id: 'duration',
			eyebrow: t('dms_automation.trace.duration'),
			value: describeDuration(r.durationMs, locale.value),
			detail: delta === null
				? ''
				: t(delta >= 0 ? 'dms_automation.trace.slowerThanUsual' : 'dms_automation.trace.fasterThanUsual', {
						delta: describeDuration(Math.abs(delta), locale.value),
					}),
			detailTone: delta !== null && delta > (r.usualDurationMs ?? 0) ? ('warning' as const) : ('neutral' as const),
			icon: 'i-ph-timer',
		},
		{
			id: 'trigger',
			eyebrow: t('dms_automation.trace.trigger'),
			value: describeTrigger(r.trigger, processI18n),
			detail: r.kind && r.kind !== 'run' ? t(`dms_automation.runs.kind.${r.kind}`) : '',
			icon: 'i-ph-lightning',
		},
		{
			id: 'version',
			eyebrow: t('dms_automation.trace.version'),
			value: r.procedureVersion ? `v${r.procedureVersion}` : '—',
			detail: olderVersion.value ? t('dms_automation.trace.olderVersionShort', { version: r.procedure?.version }) : t('dms_automation.trace.currentVersion'),
			detailTone: olderVersion.value ? ('warning' as const) : ('neutral' as const),
			icon: 'i-ph-git-commit',
		},
		{
			id: 'instance',
			eyebrow: t('dms_automation.trace.instance'),
			value: r.instanceId ? r.instanceId.slice(0, 8) : '—',
			icon: 'i-ph-hard-drives',
		},
	]
})

const tabs = computed(() => [
	{ label: t('dms_automation.trace.tabs.steps'), value: 'steps', badge: run.value?.trace.steps.length },
	{ label: t('dms_automation.trace.tabs.payload'), value: 'payload' },
	{ label: t('dms_automation.trace.tabs.logs'), value: 'logs', badge: run.value?.logs?.entries.length },
])

function debugInBuilder() {
	const r = run.value
	if (!r) return
	void router.push(`${props.builderUrl}?selected=${r.procedureId}&run=${r._id}`)
}
</script>

<template>
	<div class="flex flex-col gap-5">
		<div v-if="loading && !run" class="flex flex-col gap-4">
			<USkeleton class="h-8 w-80" />
			<USkeleton class="h-20 w-full" />
			<USkeleton class="h-80 w-full" />
		</div>

		<DmsEmptyState
			v-else-if="error && !run"
			variant="error"
			size="lg"
			:title="$t('dms_automation.trace.loadError')"
			:description="error"
			:actions="[
				{ label: $t('dms_automation.common.retry'), icon: 'i-ph-arrow-clockwise', onClick: load },
				{ label: $t('dms_automation.runs.title'), variant: 'outline', color: 'neutral', to: runsUrl },
			]"
		/>

		<template v-else-if="run">
			<header class="flex flex-wrap items-start gap-4">
				<div class="flex min-w-0 flex-1 flex-col gap-1">
					<DmsLink :to="runsUrl" class="inline-flex w-fit items-center gap-1 text-xs text-muted hover:text-highlighted">
						<UIcon name="i-ph-arrow-left" class="size-3.5" />
						{{ $t('dms_automation.runs.title') }}
					</DmsLink>
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						<h1 class="truncate text-xl font-semibold text-highlighted">{{ procedureName }}</h1>
						<DmsStatusPill
							:tone="failed ? 'error' : 'success'"
							:label="failed ? $t('dms_automation.runs.status.failed') : $t('dms_automation.runs.status.ok')"
						/>
						<UBadge v-if="run.kind === 'test'" color="info" variant="subtle" size="sm">
							{{ $t('dms_automation.runs.kind.test') }}
						</UBadge>
					</div>
					<p class="flex flex-wrap items-center gap-1.5 text-sm text-muted">
						<span class="font-mono text-xs">{{ run._id }}</span>
						<DmsCopyButton :value="run._id" />
						<span>·</span>
						<span>{{ $t('dms_automation.trace.startedBy', { time: startedAt, trigger: describeTrigger(run.trigger, processI18n) }) }}</span>
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
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
					<UButton v-if="run.procedure" color="primary" icon="i-ph-bug" @click="debugInBuilder">
						{{ $t('dms_automation.trace.debugInBuilder') }}
					</UButton>
				</div>
			</header>

			<DmsBanner
				v-if="olderVersion"
				size="sm"
				tone="info"
				icon="i-ph-git-commit"
				:title="$t('dms_automation.trace.olderVersion', { version: run.procedureVersion })"
				:description="$t('dms_automation.trace.olderVersionHint', { current: run.procedure?.version })"
			/>
			<DmsBanner
				v-if="run.rerunOf"
				size="sm"
				tone="info"
				icon="i-ph-arrow-clockwise"
				:title="$t('dms_automation.trace.rerunOf')"
			>
				<template #actions>
					<UButton size="xs" variant="soft" color="info" :to="`${traceUrl}?run=${run.rerunOf}`">
						{{ $t('dms_automation.trace.openOriginal') }}
					</UButton>
				</template>
			</DmsBanner>

			<DmsStatGroup :items="stats" layout="joined" :columns="5" />

			<div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
				<DmsCard :padded="false">
					<div class="flex flex-wrap items-center justify-between gap-2 border-b border-default px-3 pt-2">
						<UTabs v-model="tab" :items="tabs" variant="link" :content="false" size="sm" />
						<USwitch
							v-if="tab === 'steps'"
							v-model="pathOnly"
							size="xs"
							:label="$t('dms_automation.trace.pathOnly')"
							class="pb-2"
						/>
					</div>
					<DmsAutomationRunWaterfall
						v-if="tab === 'steps'"
						:steps="run.trace.steps"
						:skipped="run.trace.skipped"
						:total-ms="run.durationMs"
						:path-only="pathOnly"
					/>
					<div v-else-if="tab === 'payload'" class="p-3">
						<DmsAutomationRunPayload :raw="run.triggerPayload" :kept="run.payloadKept" />
					</div>
					<DmsAutomationRunLogList v-else :log="run.logs" :names="names" />
				</DmsCard>

				<div class="flex flex-col gap-4">
					<DmsAutomationRunFailure v-if="failed" :run="run">
						<UButton v-if="run.procedure" size="xs" color="error" variant="soft" icon="i-ph-crosshair" @click="debugInBuilder">
							{{ $t('dms_automation.trace.openStep') }}
						</UButton>
					</DmsAutomationRunFailure>
					<DmsCard :title="$t('dms_automation.trace.pathTaken')">
						<template #actions>
							<UButton v-if="run.procedure" size="xs" variant="ghost" color="neutral" trailing-icon="i-ph-arrow-up-right" @click="debugInBuilder">
								{{ $t('dms_automation.trace.openInBuilder') }}
							</UButton>
						</template>
						<DmsAutomationRunPathTaken :graph="run.graph" :steps="run.trace.steps" :failed-node-id="run.failedNodeId" />
					</DmsCard>
					<DmsCard :title="$t('dms_automation.trace.compared')">
						<DmsAutomationRunCompare :run="run" />
					</DmsCard>
				</div>
			</div>
		</template>
	</div>
</template>
