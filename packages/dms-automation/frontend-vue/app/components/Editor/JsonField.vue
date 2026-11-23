<script setup lang="ts">
import { ref, watch } from 'vue'
import { isJsonValue, isText } from './jsonValue'
import type { JsonValue } from './jsonValue'

const props = defineProps<{
	modelValue: JsonValue | undefined
}>()

const emit = defineEmits<{
	(e: 'update:model-value', v: JsonValue | undefined): void
}>()

function serialize(v: JsonValue | undefined): string {
	if (v === undefined) return ''
	if (isText(v)) return v
	try {
		return JSON.stringify(v, null, 2)
	} catch {
		return ''
	}
}

function parse(s: string): JsonValue | undefined {
	if (s.trim() === '') return undefined
	try {
		const parsed: unknown = JSON.parse(s)
		return isJsonValue(parsed) ? parsed : s
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
