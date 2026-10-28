<script setup lang="ts">
import { nextTick } from 'vue'
import type { ChoiceQuestion } from '../../types/editor'

defineProps<{ dialog: ChoiceQuestion<string> & { open: boolean } }>()

const emit = defineEmits<{
	'update:open': [open: boolean]
	answer: [choice: string]
}>()

/** The dialog opens on its safe answer: Enter keeps the draft, runs nothing. */
function focusSafeChoice(event: Event) {
	event.preventDefault()
	void nextTick(() => document.querySelector<HTMLElement>('[data-safe-choice]')?.focus())
}
</script>

<template>
<UModal
	:open="dialog.open"
	:title="dialog.title"
	:content="{ onOpenAutoFocus: focusSafeChoice }"
	@update:open="emit('update:open', $event)"
>
	<template #body>
		<p class="text-sm text-toned">{{ dialog.description }}</p>
	</template>
	<template #footer>
		<div class="flex w-full justify-end gap-2">
			<UButton
				v-for="choice in dialog.choices"
				:key="choice.value"
				:color="choice.color ?? 'neutral'"
				:variant="choice.variant ?? 'solid'"
				:data-safe-choice="choice.value === dialog.dismiss || undefined"
				@click="emit('answer', choice.value)"
			>
				{{ choice.label }}
			</UButton>
		</div>
	</template>
</UModal>
</template>
