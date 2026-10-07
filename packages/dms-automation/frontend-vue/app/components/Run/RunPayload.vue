<script setup lang="ts">
import { computed } from 'vue'
import { parsePayload, prettyJson } from '../../utils/describe'

// A run's trigger payload, pretty-printed and copyable. A payload too large
// to keep shows the notice the backend stored instead.

const props = defineProps<{
	raw: string | undefined
	kept: boolean
}>()

const text = computed(() => prettyJson(parsePayload(props.raw ?? 'null')))
const bytes = computed(() => new Blob([props.raw ?? '']).size)
</script>

<template>
	<div class="flex flex-col gap-2">
		<DmsBanner
			v-if="!kept"
			size="sm"
			tone="warning"
			icon="i-ph-warning"
			:title="$t('dms_automation.trace.payloadTooLarge')"
			:description="$t('dms_automation.trace.payloadTooLargeHint')"
		/>
		<div class="relative">
			<pre class="max-h-[28rem] overflow-auto rounded-md border border-default bg-elevated p-3 font-mono text-xs text-toned">{{ text }}</pre>
			<div class="absolute top-2 right-2 flex items-center gap-2">
				<span class="font-mono text-[10.5px] text-dimmed">{{ (bytes / 1024).toFixed(1) }} kB</span>
				<DmsCopyButton :value="text" />
			</div>
		</div>
	</div>
</template>
