<script setup lang="ts">
import { computed } from 'vue'
import type { RunDetail } from '../../composables/useAutomationRuns'
import { describeDuration, describeTime, stepTitle } from '../../utils/describe'

// Where and why a failed run stopped: the step by name, the error, how many
// runs in a row failed the same way and when it last worked.

const props = defineProps<{ run: RunDetail }>()

const { processI18n } = useTranslation()

const step = computed(() => stepTitle(props.run.failedStep, processI18n))

const history = computed(() => {
	const run = props.run
	const parts: string[] = []
	if (run.failuresInRow > 1) {
		parts.push(processI18n('$dms_automation.trace.failuresInRow', { count: run.failuresInRow }))
	}
	if (run.lastSuccess) {
		parts.push(
			processI18n('$dms_automation.trace.lastSuccess', {
				run: run.lastSuccess.runId.slice(-6),
				time: describeTime(run.lastSuccess.startedAt),
			}),
		)
	}
	return parts.join(' · ')
})
</script>

<template>
	<div class="flex flex-col gap-3 rounded-lg border border-error/40 bg-error/5 p-4">
		<div class="flex items-start gap-3">
			<DmsIconWell icon="i-ph-x-circle" tone="error" size="sm" />
			<div class="flex min-w-0 flex-col gap-1">
				<p class="text-sm font-semibold text-highlighted">
					{{ step ? $t('dms_automation.trace.failedAt', { step }) : $t('dms_automation.trace.failed') }}
				</p>
				<p class="text-xs text-muted">
					{{ $t('dms_automation.trace.failedAfter', { duration: describeDuration(run.durationMs) }) }}
					<template v-if="history"> {{ history }}</template>
				</p>
			</div>
		</div>
		<pre class="overflow-auto rounded-md bg-default p-2 font-mono text-xs whitespace-pre-wrap text-error">{{ run.errorMessage }}</pre>
		<div v-if="$slots.default" class="flex flex-wrap gap-2">
			<slot />
		</div>
	</div>
</template>
