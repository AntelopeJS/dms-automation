<script setup lang="ts">
import type { RunDetail } from '../../../composables/useAutomationRuns'
import type { GraphIssue } from '../../types/editor'

defineProps<{
	loadError: string | null
	templateNotFound: boolean
	editorMode: 'procedure' | 'template'
	libraryBackUrl: string
	saveBlocked: boolean
	blockingIssues: GraphIssue[]
	pausedBanner: { title: string; description: string } | null
	saving: boolean
	testing: boolean
	overlayRun: RunDetail | null
	overlayIsTest: boolean
	overlayLook: { readonly tone: 'error' | 'success'; readonly icon: string }
	overlaySummary: string
	overlayDescription: string
	isDirty: boolean
	isCurrentGraphReadOnly: boolean
	canForkToLocal: boolean
}>()

const emit = defineEmits<{
	'go-to-first-problem': []
	'save-as-draft': []
	'enable-now': []
	rerun: []
	'test-run': []
	'open-trace': [runId: string]
	'exit-debug': []
	'open-fork': []
}>()
</script>

<template>
<div class="flex flex-col gap-2 empty:hidden" :class="loadError || saveBlocked || pausedBanner || overlayRun || testing || isCurrentGraphReadOnly ? 'border-b border-default p-2' : ''">
	<DmsBanner
		v-if="loadError"
		size="sm"
		tone="error"
		icon="i-ph-warning"
		:title="editorMode === 'template' ? $t('dms_automation.editor.loadTemplateError') : $t('dms_automation.editor.loadProceduresError')"
		:description="loadError"
	>
		<template v-if="templateNotFound" #actions>
			<UButton size="xs" color="error" variant="soft" icon="i-ph-arrow-left" :to="libraryBackUrl">{{ $t('dms_automation.editor.backToTemplates') }}</UButton>
		</template>
	</DmsBanner>
	<DmsBanner
		v-if="saveBlocked && blockingIssues.length"
		size="sm"
		tone="error"
		icon="i-ph-warning-octagon"
		:title="$t('dms_automation.editor.problems.title', { count: blockingIssues.length })"
		:description="$t('dms_automation.editor.problems.description')"
	>
		<template #actions>
			<UButton size="xs" color="error" variant="soft" @click="emit('go-to-first-problem')">{{ $t('dms_automation.editor.problems.first') }}</UButton>
			<UButton size="xs" color="neutral" variant="outline" :loading="saving" @click="emit('save-as-draft')">{{ $t('dms_automation.editor.problems.saveDraft') }}</UButton>
		</template>
	</DmsBanner>
	<DmsBanner v-if="pausedBanner && !saveBlocked" size="sm" tone="warning" icon="i-ph-pause-circle" :title="pausedBanner.title" :description="pausedBanner.description">
		<template #actions>
			<UButton size="xs" color="warning" variant="soft" :loading="saving" :disabled="blockingIssues.length > 0" @click="emit('enable-now')">
				{{ $t('dms_automation.editor.paused.enable') }}
			</UButton>
		</template>
	</DmsBanner>
	<DmsBanner
		v-if="testing"
		size="sm"
		tone="info"
		icon="i-ph-flask"
		:title="$t('dms_automation.editor.debug.testing')"
		:description="$t('dms_automation.editor.debug.testingHint')"
	/>
	<DmsBanner
		v-if="overlayRun && !testing"
		size="sm"
		:tone="overlayLook.tone"
		:icon="overlayLook.icon"
		:title="overlaySummary"
		:description="overlayDescription"
	>
		<template #actions>
			<UTooltip v-if="!overlayIsTest" :text="isDirty ? $t('dms_automation.editor.debug.rerunSaveFirst') : $t('dms_automation.editor.debug.rerunHint')">
				<UButton size="xs" variant="soft" color="neutral" icon="i-ph-arrow-clockwise" :disabled="isDirty" @click="emit('rerun')">
					{{ $t('dms_automation.runs.rerunWithPayload') }}
				</UButton>
			</UTooltip>
			<UButton v-if="overlayIsTest" size="xs" variant="soft" color="neutral" icon="i-ph-arrow-clockwise" :loading="testing" @click="emit('test-run')">
				{{ $t('dms_automation.editor.debug.again') }}
			</UButton>
			<UButton size="xs" variant="ghost" color="neutral" icon="i-ph-path" @click="emit('open-trace', overlayRun._id)">
				{{ $t('dms_automation.runs.trace') }}
			</UButton>
			<UButton size="xs" variant="ghost" color="neutral" @click="emit('exit-debug')">
				{{ $t('dms_automation.editor.debug.exit') }}
				<UKbd value="Esc" size="sm" class="ml-1" />
			</UButton>
		</template>
	</DmsBanner>
	<DmsBanner
		v-if="isCurrentGraphReadOnly"
		size="sm"
		tone="info"
		icon="i-ph-link"
		:title="$t('dms_automation.editor.linkedTitle')"
		:description="$t('dms_automation.editor.linkedDescription')"
	>
		<template v-if="canForkToLocal" #actions>
			<UButton size="xs" color="info" variant="soft" icon="i-ph-git-fork" @click="emit('open-fork')">
				{{ $t('dms_automation.editor.forkToEdit') }}
			</UButton>
		</template>
	</DmsBanner>
</div>
</template>
