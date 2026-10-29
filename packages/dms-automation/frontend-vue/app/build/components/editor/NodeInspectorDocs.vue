<script setup lang="ts">
import type { JsonSchema } from '../../../composables/useGraphConnect'

defineProps<{
	description: string
	inputSchema: JsonSchema | null
	branches: string[]
	outputSchema: JsonSchema | null
}>()
</script>

<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
		<p class="text-sm text-toned">{{ description || $t('dms_automation.editor.inspector.noDocs') }}</p>
		<div class="flex flex-col gap-1">
			<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.library.inputs') }}</span>
			<DmsAutomationSchemaTable :schema="inputSchema" />
		</div>
		<div v-if="branches.length" class="flex flex-col gap-1">
			<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.editor.inspector.branches') }}</span>
			<p class="font-mono text-xs text-toned">{{ branches.join(' · ') }}</p>
		</div>
		<div class="flex flex-col gap-1">
			<span class="font-mono text-[10.5px] text-dimmed uppercase">{{ $t('dms_automation.library.outputs') }}</span>
			<DmsAutomationSchemaTable :schema="outputSchema" />
		</div>
	</div>
</template>
