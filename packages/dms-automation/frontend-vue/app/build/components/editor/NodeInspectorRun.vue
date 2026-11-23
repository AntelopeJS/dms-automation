<script setup lang="ts">
import { computed } from "vue";
import type { TraceStep } from "../../../composables/useAutomationRuns";
import {
  describeDuration,
  prettyJson,
  unwrapDescribed,
} from "../../../utils/describe";
import { isJsonValue } from "../../../utils/json";

const props = defineProps<{
  runStep: TraceStep;
  /** Says which run that is ("Test run · just now", "Run 8f3a2c · 14:28"). */
  runLabel?: string;
  /** Opens the trace of that run. */
  runTraceUrl?: string;
}>();

const inputText = computed(() => {
  const inputs = props.runStep.inputs;
  return isJsonValue(inputs) ? prettyJson(unwrapDescribed(inputs)) : "";
});
const outputText = computed(() => {
  const output = props.runStep.output;
  return isJsonValue(output) ? prettyJson(unwrapDescribed(output)) : "";
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div class="flex items-center justify-between gap-2">
      <DmsStatusPill
        :tone="runStep.status === 'failed' ? 'error' : 'success'"
        :label="
          runStep.status === 'failed'
            ? $t('dms_automation.runs.status.failed')
            : $t('dms_automation.runs.status.ok')
        "
        size="sm"
      />
      <span class="font-mono text-xs text-muted">{{
        describeDuration(runStep.durationMs)
      }}</span>
    </div>
    <p v-if="runLabel" class="text-xs text-muted">{{ runLabel }}</p>
    <div class="flex flex-col gap-1">
      <span class="font-mono text-[10.5px] text-dimmed uppercase">{{
        $t("dms_automation.trace.input")
      }}</span>
      <pre
        class="max-h-56 overflow-auto rounded-md bg-elevated p-2 font-mono text-xs break-all whitespace-pre-wrap text-toned"
        >{{ inputText || "—" }}</pre>
    </div>
    <div class="flex flex-col gap-1">
      <span class="font-mono text-[10.5px] text-dimmed uppercase">
        {{
          runStep.status === "failed"
            ? $t("dms_automation.trace.error")
            : $t("dms_automation.trace.output")
        }}
      </span>
      <pre
        class="max-h-56 overflow-auto rounded-md bg-elevated p-2 font-mono text-xs break-all whitespace-pre-wrap"
        :class="runStep.status === 'failed' ? 'text-error' : 'text-toned'"
        >{{
          runStep.status === "failed" ? runStep.error : outputText || "—"
        }}</pre>
    </div>
    <UButton
      v-if="runTraceUrl"
      size="xs"
      variant="ghost"
      color="neutral"
      trailing-icon="i-ph-arrow-up-right"
      :to="runTraceUrl"
      class="self-start"
    >
      {{ $t("dms_automation.trace.openFull") }}
    </UButton>
  </div>
</template>
