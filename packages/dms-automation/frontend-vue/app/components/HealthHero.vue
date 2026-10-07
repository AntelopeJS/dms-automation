<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { describeRelative, describeTime, stepTitle, type StepName } from '../utils/describe'

// The overview's opening line: how automation is doing over the selected
// window, said in one sentence, with the next action. Refreshes itself every
// 30 s ("Live"). With no procedure yet it is the first-run state instead: three
// recipes that create a procedure with its trigger and open the builder.

interface FailureRef {
	runId: string
	procedureId: string
	procedureName: string
	startedAt: string
	error: string
	step: StepName | null
}

interface FailingProcedure {
	procedureId: string
	name: string
	since: string | null
	streak: number
	lastRunId: string | null
}

interface HealthHero {
	state: 'empty' | 'failing' | 'degraded' | 'healthy' | 'idle'
	updatedAt: string
	procedures: number
	enabled: number
	failing: FailingProcedure[]
	degraded: number
	paused: number
	figures: { total: number; ok: number; failed: number; successRate: number | null }
	lastFailure: FailureRef | null
}

const props = defineProps<{
	fetchUrl: string
	periodScope?: string
	runsUrl: string
	traceUrl: string
	builderUrl: string
	createUrl: string
}>()

const REFRESH_MS = 30_000
const TICK_MS = 5_000

const { $authFetch } = useAuthFetch()
const { processI18n } = useTranslation()
const router = useDmsRouter()
const toast = useToast()
const period = usePeriodScope(props.periodScope)

const data = ref<HealthHero | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const lastFetchedAt = ref<number | null>(null)
const now = ref(Date.now())
const creating = ref<string | null>(null)

async function load() {
	try {
		const url = appendPeriodToUrl(props.fetchUrl, period.value) ?? props.fetchUrl
		data.value = await $authFetch<HealthHero>(url)
		error.value = null
		lastFetchedAt.value = Date.now()
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

let refreshTimer: ReturnType<typeof setInterval> | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
	void load()
	refreshTimer = setInterval(() => void load(), REFRESH_MS)
	tickTimer = setInterval(() => (now.value = Date.now()), TICK_MS)
})
onBeforeUnmount(() => {
	clearInterval(refreshTimer)
	clearInterval(tickTimer)
})
watch(() => period.value?.key, () => void load())

const windowLabel = computed(() => {
	const keys: Record<string, string> = {
		'last-24h': 'last24h',
		'last-7-days': 'last7d',
		'last-30-days': 'last30d',
	}
	const key = keys[period.value?.preset ?? 'last-24h'] ?? 'last24h'
	return processI18n(`$dms_automation.period.${key}`)
})

const updatedAgo = computed(() => {
	void now.value
	return lastFetchedAt.value ? describeRelative(new Date(lastFetchedAt.value)) : ''
})

const TONE_BY_STATE = {
	failing: 'error',
	degraded: 'warning',
	healthy: 'success',
	idle: 'neutral',
	empty: 'neutral',
} as const

const ICON_BY_STATE = {
	failing: 'i-ph-x-circle',
	degraded: 'i-ph-warning',
	healthy: 'i-ph-check-circle',
	idle: 'i-ph-moon',
	empty: 'i-ph-flow-arrow',
} as const

const tone = computed(() => TONE_BY_STATE[data.value?.state ?? 'idle'])
const icon = computed(() => ICON_BY_STATE[data.value?.state ?? 'idle'])

const headline = computed(() => {
	const d = data.value
	if (!d) return ''
	if (d.state === 'failing') {
		return processI18n('$dms_automation.health.failing', { count: d.failing.length })
	}
	if (d.state === 'degraded') {
		return processI18n('$dms_automation.health.degraded', { count: d.degraded })
	}
	if (d.state === 'healthy') return processI18n('$dms_automation.health.healthy')
	return processI18n('$dms_automation.health.idle')
})

const detail = computed(() => {
	const d = data.value
	if (!d) return ''
	const first = d.failing[0]
	if (d.state === 'failing' && first) {
		return processI18n('$dms_automation.health.failingSince', {
			name: first.name,
			since: first.since ? describeTime(first.since) : '—',
		})
	}
	const { total, failed } = d.figures
	return processI18n('$dms_automation.health.summary', {
		runs: total,
		failed,
		enabled: d.enabled,
		total: d.procedures,
	})
})

const lastFailureLine = computed(() => {
	const f = data.value?.lastFailure
	if (!f) return ''
	const step = stepTitle(f.step, processI18n)
	return step
		? processI18n('$dms_automation.health.lastFailureAt', { error: f.error, step })
		: f.error
})

function openTrace(runId: string) {
	void router.push(`${props.traceUrl}?run=${runId}`)
}

function showFailedRuns() {
	void router.push(`${props.runsUrl}?tab=failed`)
}

interface Recipe {
	id: string
	trigger: 'webhook' | 'schedule.cron' | 'manual'
	icon: string
}

const RECIPES: Recipe[] = [
	{ id: 'webhook', trigger: 'webhook', icon: 'i-ph-webhooks-logo' },
	{ id: 'digest', trigger: 'schedule.cron', icon: 'i-ph-clock' },
	{ id: 'manual', trigger: 'manual', icon: 'i-ph-play' },
]

async function startRecipe(recipe: Recipe) {
	creating.value = recipe.id
	try {
		const res = await $authFetch<{ _id: string }>(props.createUrl, {
			method: 'POST',
			body: {
				name: processI18n(`$dms_automation.recipes.${recipe.id}.name`),
				description: processI18n(`$dms_automation.recipes.${recipe.id}.description`),
				trigger: recipe.trigger,
			},
		})
		await router.push(`${props.builderUrl}?selected=${res._id}`)
	} catch (e) {
		toast.add({
			title: processI18n('$dms_automation.newProcedure.failed'),
			description: (e as Error).message,
			color: 'error',
			icon: 'i-ph-warning',
		})
	} finally {
		creating.value = null
	}
}
</script>

<template>
	<div>
		<DmsCard v-if="loading && !data" :padded="true">
			<div class="flex items-center gap-4">
				<USkeleton class="size-10 rounded-lg" />
				<div class="flex flex-1 flex-col gap-2">
					<USkeleton class="h-3 w-40" />
					<USkeleton class="h-5 w-72" />
					<USkeleton class="h-3 w-56" />
				</div>
			</div>
		</DmsCard>

		<DmsBanner
			v-else-if="error && !data"
			tone="error"
			icon="i-ph-warning-circle"
			:title="$t('dms_automation.health.loadError')"
			:description="error"
		>
			<template #actions>
				<UButton size="sm" color="error" variant="soft" icon="i-ph-arrow-clockwise" @click="load">
					{{ $t('dms_automation.common.retry') }}
				</UButton>
			</template>
		</DmsBanner>

		<DmsCard v-else-if="data && data.state === 'empty'" :padded="true">
			<div class="flex flex-col gap-5">
				<div class="flex items-start gap-4">
					<DmsIconWell icon="i-ph-flow-arrow" tone="primary" size="xl" />
					<div class="flex min-w-0 flex-col gap-1">
						<h2 class="text-lg font-semibold text-highlighted">
							{{ $t('dms_automation.firstRun.title') }}
						</h2>
						<p class="max-w-2xl text-sm text-muted">
							{{ $t('dms_automation.firstRun.description') }}
						</p>
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-3">
					<button
						v-for="recipe in RECIPES"
						:key="recipe.id"
						type="button"
						class="dms-card flex items-start gap-3 p-4 text-left transition-colors hover:bg-elevated disabled:opacity-60"
						:disabled="creating !== null"
						@click="startRecipe(recipe)"
					>
						<DmsIconWell :icon="recipe.icon" tone="muted" size="sm" />
						<span class="flex min-w-0 flex-col gap-0.5">
							<span class="text-sm font-medium text-highlighted">
								{{ $t(`dms_automation.recipes.${recipe.id}.title`) }}
							</span>
							<span class="text-xs text-muted">
								{{ $t(`dms_automation.recipes.${recipe.id}.hint`) }}
							</span>
						</span>
						<UIcon
							v-if="creating === recipe.id"
							name="i-ph-circle-notch"
							class="ml-auto size-4 shrink-0 animate-spin text-muted"
						/>
					</button>
				</div>
				<p class="text-xs text-dimmed">
					{{ $t('dms_automation.firstRun.otherModules') }}
				</p>
			</div>
		</DmsCard>

		<DmsCard v-else-if="data" :padded="true">
			<div class="flex flex-wrap items-center gap-4">
				<DmsIconWell :icon="icon" :tone="tone" size="xl" />
				<div class="flex min-w-0 flex-1 flex-col gap-0.5">
					<div class="flex items-center gap-2 font-mono text-[10.5px] tracking-widest text-dimmed uppercase">
						<span>{{ $t('dms_automation.health.eyebrow', { window: windowLabel }) }}</span>
						<span class="inline-flex items-center gap-1 normal-case tracking-normal">
							<span class="size-1.5 animate-pulse rounded-full bg-success" />
							{{ $t('dms_automation.health.live', { ago: updatedAgo }) }}
						</span>
					</div>
					<h2 class="text-lg font-semibold text-highlighted">{{ headline }}</h2>
					<p class="truncate text-sm text-muted">{{ detail }}</p>
					<p
						v-if="data.state === 'failing' && lastFailureLine"
						class="truncate font-mono text-xs text-error"
					>
						{{ lastFailureLine }}
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<UButton
						v-if="data.lastFailure && data.state !== 'healthy'"
						:color="data.state === 'failing' ? 'error' : 'neutral'"
						:variant="data.state === 'failing' ? 'solid' : 'outline'"
						icon="i-ph-path"
						@click="openTrace(data.lastFailure.runId)"
					>
						{{ $t('dms_automation.health.inspectLastFailure') }}
					</UButton>
					<UButton
						v-if="data.figures.failed > 0"
						color="neutral"
						variant="outline"
						icon="i-ph-x-circle"
						@click="showFailedRuns"
					>
						{{ $t('dms_automation.health.showFailedRuns') }}
					</UButton>
					<UTooltip :text="$t('dms_automation.common.refresh')">
						<UButton
							color="neutral"
							variant="ghost"
							icon="i-ph-arrow-clockwise"
							:aria-label="$t('dms_automation.common.refresh')"
							@click="load"
						/>
					</UTooltip>
				</div>
			</div>
			<p v-if="error" class="mt-3 text-xs text-warning">
				{{ $t('dms_automation.health.staleData', { time: describeTime(data.updatedAt) }) }}
			</p>
		</DmsCard>
	</div>
</template>
