<script setup lang="ts">
import { computed } from 'vue'
import { prettyJson } from '../../utils/describe'
import { isJsonObject, isNumber, isText, parseJsonText } from '../Editor/jsonValue'

const props = defineProps<{
	raw: string | undefined
	kept: boolean
}>()

const { locale } = useI18n()

const parsed = computed(() => parseJsonText(props.raw ?? 'null'))

/** What the backend keeps of a payload too large: its size and a preview. */
const preview = computed(() => {
	if (props.kept) return null
	const marker = isJsonObject(parsed.value) ? parsed.value : null
	return {
		text: isText(marker?.preview) ? marker.preview : '',
		bytes: isNumber(marker?.originalBytes) ? marker.originalBytes : null,
	}
})

/** A webhook body that is text, not JSON: shown as received. */
const textBody = computed(() => {
	if (!props.kept) return null
	const envelope = isJsonObject(parsed.value) ? parsed.value : null
	if (!isText(envelope?.body)) return null
	const headers = isJsonObject(envelope.headers) ? envelope.headers : null
	const type = headers?.['content-type']
	return { text: envelope.body, type: isText(type) ? type : null }
})

const text = computed(() => {
	const value = parsed.value
	if (!textBody.value || !isJsonObject(value)) return prettyJson(value)
	const { body: _body, ...rest } = value
	return prettyJson(rest)
})

const bytes = computed(() => preview.value?.bytes ?? new Blob([props.raw ?? '']).size)

function describeBytes(value: number): string {
	return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value / 1024)} kB`
}
</script>

<template>
	<div class="flex flex-col gap-2">
		<template v-if="preview">
			<DmsNoticeBanner
				size="sm"
				tone="warning"
				icon="i-ph-warning"
				:title="$t('dms_automation.trace.payloadTooLarge')"
				:description="$t('dms_automation.trace.payloadTooLargeHint')"
			/>
			<div class="flex items-center justify-between gap-2 font-mono text-[10.5px] text-dimmed">
				<span>{{ $t('dms_automation.trace.payloadPreview', { chars: preview.text.length, size: describeBytes(bytes) }) }}</span>
				<DmsCopyButton :value="preview.text" />
			</div>
			<pre class="max-h-[28rem] overflow-auto rounded-md border border-default bg-elevated p-3 font-mono text-xs break-all whitespace-pre-wrap text-toned">{{ preview.text }}</pre>
		</template>
		<template v-else>
			<div class="relative">
				<pre class="max-h-[28rem] overflow-auto rounded-md border border-default bg-elevated p-3 font-mono text-xs text-toned">{{ text }}</pre>
				<div class="absolute top-2 right-2 flex items-center gap-2">
					<span class="font-mono text-[10.5px] text-dimmed">{{ describeBytes(bytes) }}</span>
					<DmsCopyButton :value="textBody ? text : (raw ?? '')" />
				</div>
			</div>
			<template v-if="textBody">
				<div class="flex items-center justify-between gap-2 font-mono text-[10.5px] text-dimmed uppercase">
					<span>{{ $t('dms_automation.trace.payloadBody') }}<template v-if="textBody.type"> · <span class="normal-case">{{ textBody.type }}</span></template></span>
					<DmsCopyButton :value="textBody.text" />
				</div>
				<pre class="max-h-[28rem] overflow-auto rounded-md border border-default bg-elevated p-3 font-mono text-xs break-words whitespace-pre-wrap text-toned">{{ textBody.text }}</pre>
			</template>
		</template>
	</div>
</template>
