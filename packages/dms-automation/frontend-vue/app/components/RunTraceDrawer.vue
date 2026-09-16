<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { RunDetail, RunSummary } from '../composables/useAutomationRuns'
import RunDetailDrawer from './RunDetailDrawer.vue'

// Drawer body for a single run, opened by the timeline display's Trace
// button via `useDrawer` (which passes `rowData` and `procedureName`). The
// summary row carries no logs, so we re-fetch the full run by id here.
// Attribute fallthrough is disabled so extra injected props don't leak
// onto the DOM.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
	rowData: RunSummary
	procedureName?: string
}>()

const { getRun, listProcedures } = useAutomationRuns()

const run = ref<RunDetail | null>(null)
const resolvedName = ref<string | undefined>(props.procedureName)
const loading = ref(true)

onMounted(async () => {
	const [full] = await Promise.all([
		// Fall back to the summary row (no logs) if the detail fetch fails, so the
		// drawer still shows status/timing/error.
		getRun(props.rowData._id).catch(() => props.rowData as RunDetail),
		props.procedureName
			? Promise.resolve()
			: listProcedures()
					.then((ps) => {
						resolvedName.value = ps.find(
							(p) => p._id === props.rowData.procedureId,
						)?.name
					})
					.catch(() => {
						/* name lookup is best-effort; falls back to procedureId */
					}),
	])
	run.value = full
	loading.value = false
})
</script>

<template>
	<div class="p-1">
		<div v-if="loading" class="flex flex-col gap-3 p-1">
			<USkeleton class="h-6 w-2/3" />
			<USkeleton class="h-4 w-1/2" />
			<USkeleton class="h-32 w-full" />
		</div>
		<RunDetailDrawer
			v-else-if="run"
			:run="run"
			:procedure-name="resolvedName"
		/>
	</div>
</template>
