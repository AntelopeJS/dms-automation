<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { describeRelative, describeTime, stepTitle, type StepName } from '../utils/describe'

// "Needs attention": the procedures someone should look at, each saying why
// and offering the next action — open the failing trace, edit the procedure,
// resume a paused one, dismiss a degraded one that recovered.

interface FailureRef {
	runId: string
	startedAt: string
	error: string
	step: StepName | null
}

interface AttentionRow {
	procedureId: string
	name: string
	state: 'failing' | 'degraded' | 'paused'
	runs: number
	failed: number
	streak: number
	since: string | null
	lastRunId: string | null
	lastFailure: FailureRef | null
	recovered: boolean
	pausedAt: string | null
	pausedBy: string | null
	triggerType: string | null
}

const props = defineProps<{
	fetchUrl: string
	proceduresUrl: string
	builderUrl: string
	traceUrl: string
	runsUrl: string
	apiUrl: string
}>()

const { $authFetch } = useAuthFetch()
const { processI18n } = useTranslation()
const router = useDmsRouter()
const toast = useToast()

const rows = ref<AttentionRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)

async function load() {
	try {
		const res = await $authFetch<{ items: AttentionRow[] }>(props.fetchUrl)
		rows.value = res.items ?? []
		error.value = null
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

onMounted(load)

const TONES = { failing: 'error', degraded: 'warning', paused: 'neutral' } as const

function reason(row: AttentionRow): string {
	const f = row.lastFailure
	const step = stepTitle(f?.step, processI18n)
	const error = f?.error ?? ''
	if (row.state === 'failing') {
		const key = step ? 'failingAt' : 'failing'
		return processI18n(`$dms_automation.attention.${key}`, {
			count: row.streak,
			step,
			error,
		})
	}
	if (row.state === 'degraded') {
		return processI18n('$dms_automation.attention.degraded', {
			count: row.failed,
			failed: row.failed,
			runs: row.runs,
			when: f ? describeTime(f.startedAt) : '—',
			error,
		})
	}
	if (row.pausedAt) {
		return processI18n(
			row.pausedBy ? '$dms_automation.attention.pausedBy' : '$dms_automation.attention.pausedAt',
			{ name: row.pausedBy ?? '', ago: describeRelative(row.pausedAt) },
		)
	}
	return processI18n('$dms_automation.attention.paused')
}

function go(url: string) {
	void router.push(url)
}

async function act(row: AttentionRow, url: string, body: Record<string, unknown>, message: string) {
	busy.value = row.procedureId
	try {
		await $authFetch(url, { method: url.endsWith('/enabled') ? 'PUT' : 'POST', body })
		toast.add({ title: processI18n(message, { name: row.name }), color: 'success', icon: 'i-ph-check-circle' })
		await load()
	} catch (e) {
		toast.add({
			title: processI18n('$dms_automation.common.actionFailed'),
			description: (e as Error).message,
			color: 'error',
			icon: 'i-ph-warning',
		})
	} finally {
		busy.value = null
	}
}

function resume(row: AttentionRow) {
	void act(row, `${props.apiUrl}/procedures/${row.procedureId}/enabled`, { enabled: true }, '$dms_automation.attention.resumed')
}

function dismiss(row: AttentionRow) {
	void act(row, `${props.apiUrl}/procedures/${row.procedureId}/dismiss-attention`, {}, '$dms_automation.attention.dismissed')
}

const count = computed(() => rows.value.length)
</script>

<template>
	<DmsCard :title="$t('dms_automation.attention.title')" :count="count || undefined" :padded="false" class="h-full">
		<template #actions>
			<UButton size="xs" variant="ghost" color="neutral" trailing-icon="i-ph-arrow-right" @click="go(proceduresUrl)">
				{{ $t('dms_automation.attention.allProcedures') }}
			</UButton>
		</template>

		<div v-if="loading" class="flex flex-col gap-3 p-4">
			<USkeleton v-for="i in 3" :key="i" class="h-12 w-full" />
		</div>
		<div v-else-if="error" class="p-4">
			<DmsEmptyState
				variant="error"
				size="sm"
				:title="$t('dms_automation.attention.loadError')"
				:description="error"
				:actions="[{ label: $t('dms_automation.common.retry'), icon: 'i-ph-arrow-clockwise', onClick: load }]"
			/>
		</div>
		<div v-else-if="rows.length === 0" class="p-4">
			<DmsEmptyState
				size="sm"
				icon="i-ph-check-circle"
				tone="success"
				:title="$t('dms_automation.attention.empty')"
				:description="$t('dms_automation.attention.emptyHint')"
			/>
		</div>
		<ul v-else class="divide-y divide-default">
			<li v-for="row in rows" :key="row.procedureId" class="flex items-start gap-3 px-4 py-3">
				<div class="flex min-w-0 flex-1 flex-col gap-1">
					<div class="flex min-w-0 items-center gap-2">
						<span class="truncate text-sm font-medium text-highlighted">{{ row.name }}</span>
						<DmsStatusPill
							:tone="TONES[row.state]"
							:label="$t(`dms_automation.procedures.status.${row.state}`)"
							size="sm"
						/>
					</div>
					<p
						class="line-clamp-2 text-xs"
						:class="row.state === 'failing' ? 'text-error' : 'text-muted'"
					>
						{{ reason(row) }}
					</p>
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<UButton
						v-if="row.state !== 'paused' && row.lastFailure"
						size="xs"
						:color="row.state === 'failing' ? 'error' : 'neutral'"
						variant="soft"
						icon="i-ph-path"
						@click="go(`${traceUrl}?run=${row.lastFailure.runId}`)"
					>
						{{ $t('dms_automation.attention.openTrace') }}
					</UButton>
					<UButton
						v-if="row.state === 'degraded'"
						size="xs"
						color="neutral"
						variant="ghost"
						:loading="busy === row.procedureId"
						@click="dismiss(row)"
					>
						{{ $t('dms_automation.attention.dismiss') }}
					</UButton>
					<UButton
						v-if="row.state === 'paused'"
						size="xs"
						color="primary"
						variant="soft"
						icon="i-ph-play"
						:loading="busy === row.procedureId"
						@click="resume(row)"
					>
						{{ $t('dms_automation.attention.resume') }}
					</UButton>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						icon="i-ph-pencil-simple"
						:aria-label="$t('dms_automation.attention.edit')"
						@click="go(`${builderUrl}?selected=${row.procedureId}`)"
					/>
				</div>
			</li>
		</ul>
	</DmsCard>
</template>
