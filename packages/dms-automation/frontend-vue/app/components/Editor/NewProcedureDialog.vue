<script setup lang="ts">
import { ref, watch } from 'vue'

// "New procedure" from the builder: name it, pick what starts it, and land on
// a draft with its trigger placed (AU-11).

const props = defineProps<{ apiUrl: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const { $authFetch } = useAuthFetch()
const { t } = useI18n()

const STARTERS = [
	{ value: 'webhook', icon: 'i-ph-webhooks-logo', label: 'webhook' },
	{ value: 'schedule.cron', icon: 'i-ph-clock', label: 'schedule' },
	{ value: 'manual', icon: 'i-ph-play', label: 'manual' },
] as const

const name = ref('')
const trigger = ref<(typeof STARTERS)[number]['value']>('webhook')
const description = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
	if (!isOpen) return
	name.value = ''
	trigger.value = 'webhook'
	description.value = ''
	error.value = null
})

async function submit() {
	if (!name.value.trim()) {
		error.value = t('dms_automation.newProcedure.nameRequired')
		return
	}
	submitting.value = true
	try {
		const res = await $authFetch<{ _id: string }>(`${props.apiUrl}/procedures/new`, {
			method: 'POST',
			body: { name: name.value.trim(), trigger: trigger.value, description: description.value },
		})
		open.value = false
		emit('created', res._id)
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		submitting.value = false
	}
}
</script>

<template>
	<UModal v-model:open="open" :title="$t('dms_automation.newProcedure.title')" :description="$t('dms_automation.newProcedure.subtitle')">
		<template #body>
			<form class="flex flex-col gap-4" @submit.prevent="submit">
				<UFormField :label="$t('dms_automation.newProcedure.name')" required :error="error ?? undefined">
					<UInput v-model="name" autofocus class="w-full" :placeholder="$t('dms_automation.newProcedure.namePlaceholder')" />
				</UFormField>
				<UFormField :label="$t('dms_automation.newProcedure.startsWhen')" :help="$t('dms_automation.newProcedure.startsWhenHint')">
					<div class="grid gap-2">
						<button
							v-for="starter in STARTERS"
							:key="starter.value"
							type="button"
							class="flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors"
							:class="trigger === starter.value ? 'border-primary bg-primary/10' : 'border-default hover:bg-elevated'"
							:aria-pressed="trigger === starter.value"
							@click="trigger = starter.value"
						>
							<UIcon :name="starter.icon" class="mt-0.5 size-4 text-muted" />
							<span class="flex flex-col">
								<span class="text-sm font-medium text-highlighted">{{ $t(`dms_automation.newProcedure.starts.${starter.label}`) }}</span>
								<span class="text-xs text-muted">{{ $t(`dms_automation.newProcedure.starts.${starter.label}Hint`) }}</span>
							</span>
						</button>
					</div>
				</UFormField>
				<UFormField :label="$t('dms_automation.newProcedure.description')">
					<UTextarea v-model="description" :rows="2" class="w-full" />
				</UFormField>
			</form>
		</template>
		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton variant="outline" color="neutral" @click="open = false">{{ $t('dms_automation.common.cancel') }}</UButton>
				<UButton color="primary" :loading="submitting" @click="submit">{{ $t('dms_automation.newProcedure.submit') }}</UButton>
			</div>
		</template>
	</UModal>
</template>
