<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { describeTrigger, type TriggerSummary } from '../../utils/describe'

// "Run now": the saved procedure, run for real with a payload the user can
// edit, prefilled with the last real one (AU-01, AU-05).

const props = defineProps<{
	apiUrl: string
	procedureId: string
	procedureName: string
	triggers: TriggerSummary[]
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'started', runId: string): void }>()

const { $authFetch } = useAuthFetch()
const { processI18n } = useTranslation()
const { t } = useI18n()

const triggerNodeId = ref<string | undefined>(undefined)
const payload = ref('{}')
const source = ref<string | null>(null)
const loadingPayload = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

const triggerItems = computed(() =>
	props.triggers.map((trigger) => ({ label: describeTrigger(trigger, processI18n), value: trigger.nodeId ?? '' })),
)

async function loadPayload() {
	loadingPayload.value = true
	try {
		const query = triggerNodeId.value ? `?triggerNodeId=${encodeURIComponent(triggerNodeId.value)}` : ''
		const res = await $authFetch<{ last: { runId: string; payload: unknown } | null }>(
			`${props.apiUrl}/procedures/${props.procedureId}/last-payload${query}`,
		)
		payload.value = JSON.stringify(res.last?.payload ?? {}, null, 2)
		source.value = res.last?.runId ?? null
	} catch {
		payload.value = '{}'
		source.value = null
	} finally {
		loadingPayload.value = false
	}
}

watch(open, (isOpen) => {
	if (!isOpen) return
	error.value = null
	triggerNodeId.value = props.triggers.find((tr) => tr.typeId === 'manual')?.nodeId ?? props.triggers[0]?.nodeId
	void loadPayload()
})
watch(triggerNodeId, () => {
	if (open.value) void loadPayload()
})

async function submit() {
	let body: unknown
	try {
		body = JSON.parse(payload.value || 'null')
	} catch (e) {
		error.value = t('dms_automation.editor.runNow.invalidJson', { error: (e as Error).message })
		return
	}
	submitting.value = true
	try {
		const res = await $authFetch<{ runId: string }>(`${props.apiUrl}/procedures/${props.procedureId}/run-now`, {
			method: 'POST',
			body: { payload: body, triggerNodeId: triggerNodeId.value },
		})
		open.value = false
		emit('started', res.runId)
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		submitting.value = false
	}
}
</script>

<template>
	<UModal
		v-model:open="open"
		:title="$t('dms_automation.editor.runNow.title', { name: procedureName })"
		:description="$t('dms_automation.editor.runNow.description')"
		:ui="{ content: 'max-w-xl' }"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<UFormField v-if="triggers.length > 1" :label="$t('dms_automation.editor.runNow.trigger')">
					<USelect v-model="triggerNodeId" :items="triggerItems" class="w-full" />
				</UFormField>
				<UFormField :label="$t('dms_automation.editor.runNow.payload')" :help="source ? $t('dms_automation.editor.dock.payloadFrom', { run: source.slice(-6) }) : $t('dms_automation.editor.runNow.noPastPayload')">
					<UTextarea v-model="payload" :rows="10" class="w-full font-mono text-xs" :disabled="loadingPayload" />
				</UFormField>
				<DmsBanner size="sm" tone="warning" icon="i-ph-warning" :title="$t('dms_automation.editor.runNow.sideEffects')" />
				<p v-if="error" class="text-xs text-error">{{ error }}</p>
			</div>
		</template>
		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton variant="outline" color="neutral" @click="open = false">{{ $t('dms_automation.common.cancel') }}</UButton>
				<UButton color="primary" icon="i-ph-play" :loading="submitting" @click="submit">{{ $t('dms_automation.editor.runNow.submit') }}</UButton>
			</div>
		</template>
	</UModal>
</template>
