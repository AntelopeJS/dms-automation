<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
	modelValue: unknown
}>()

const emit = defineEmits<{
	(e: 'update:model-value', v: unknown): void
}>()

function serialize(v: unknown): string {
	if (v === undefined) return ''
	if (typeof v === 'string') return v
	try {
		return JSON.stringify(v, null, 2)
	} catch {
		return ''
	}
}

function parse(s: string): unknown {
	if (s.trim() === '') return undefined
	try {
		return JSON.parse(s)
	} catch {
		return s
	}
}

const text = ref<string>(serialize(props.modelValue))

watch(
	() => props.modelValue,
	(v) => {
		const parsed = parse(text.value)
		if (JSON.stringify(parsed) === JSON.stringify(v)) return
		text.value = serialize(v)
	},
)

function onBlur() {
	emit('update:model-value', parse(text.value))
}
</script>

<template>
	<DmsInputTextarea
		v-model="text"
		:rows="4"
		:placeholder="$t('dms_automation.editor.inspector.jsonPlaceholder')"
		class="w-full font-mono"
		@blur="onBlur"
	/>
</template>
