<script setup lang="ts">
defineProps<{
	submitting: boolean
	error: string | null
}>()

const emit = defineEmits<{ submit: [] }>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
<UModal
	v-model:open="open"
	:title="$t('dms_automation.editor.forkModal.title')"
>
	<template #body>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-toned">
				{{ $t('dms_automation.editor.forkModal.body') }}
			</p>
			<DmsBanner
				v-if="error"
				size="sm"
				tone="error"
				:title="$t('dms_automation.editor.forkModal.error')"
				:description="error"
			/>
		</div>
	</template>
	<template #footer>
		<div class="flex w-full justify-end gap-2">
			<UButton
				:label="$t('dms_automation.editor.forkModal.cancel')"
				variant="outline"
				color="neutral"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				:label="$t('dms_automation.editor.forkModal.submit')"
				color="primary"
				icon="i-ph-git-fork"
				:loading="submitting"
				@click="emit('submit')"
			/>
		</div>
	</template>
</UModal>
</template>
