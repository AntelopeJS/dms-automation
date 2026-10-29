<script setup lang="ts">
import type { ProcedureSummaryRow } from '../../../components/Editor/ProcedureSwitcher.vue'
import type { ProcedureGraph } from '../../../composables/useGraphConnect'
import type { ProcedureRecord } from '../../types/editor'

defineProps<{
	editorMode: 'procedure' | 'template'
	libraryBackUrl: string
	selected: ProcedureRecord | null
	selectedId: string | null
	currentGraph: ProcedureGraph | null
	isCurrentGraphReadOnly: boolean
	paletteHidden: boolean
	nameInputId: string
	nameMissing: boolean
	currentSummary: ProcedureSummaryRow | null
	changeCount: number
	saveState: string
	isDirty: boolean
	saving: boolean
	testing: boolean
	runsUrl: string
	formatShortcut: ReturnType<typeof useKeyboardPlatform>['formatShortcut']
}>()

const emit = defineEmits<{
	'open-switcher': []
	'toggle-palette': []
	discard: []
	'run-now': []
	'test-run': []
	save: []
	create: []
	export: []
	delete: []
}>()

const procedureName = defineModel<string>('name', { required: true })
const procedureEnabled = defineModel<boolean>('enabled', { required: true })

const STATE_TONES = {
	failing: 'error',
	degraded: 'warning',
	healthy: 'success',
	paused: 'neutral',
	draft: 'info',
} as const

</script>

<template>
<header class="flex min-h-13 flex-wrap items-center gap-2 border-b border-default px-3 py-2">
	<template v-if="editorMode === 'procedure'">
		<UTooltip :text="$t('dms_automation.editor.switcher.title')" :kbds="['meta', 'p']">
			<UButton
				icon="i-ph-flow-arrow"
				variant="ghost"
				color="neutral"
				:aria-label="$t('dms_automation.editor.switcher.title')"
				@click="emit('open-switcher')"
			/>
		</UTooltip>
	</template>
	<template v-else>
		<UButton icon="i-ph-arrow-left" variant="ghost" color="neutral" :to="libraryBackUrl">
			{{ $t('dms_automation.library.title') }}
		</UButton>
		<UBadge color="info" variant="subtle">{{ $t('dms_automation.editor.templateBadge') }}</UBadge>
	</template>
	<UTooltip v-if="selected && currentGraph && !isCurrentGraphReadOnly" :text="paletteHidden ? $t('dms_automation.editor.showBlocks') : $t('dms_automation.editor.hideBlocks')">
		<UButton
			:icon="paletteHidden ? 'i-ph-sidebar-simple' : 'i-ph-sidebar-simple-fill'"
			variant="ghost"
			color="neutral"
			:aria-label="paletteHidden ? $t('dms_automation.editor.showBlocks') : $t('dms_automation.editor.hideBlocks')"
			:aria-pressed="!paletteHidden"
			@click="emit('toggle-palette')"
		/>
	</UTooltip>
	<UInput
		v-if="selected"
		:id="nameInputId"
		v-model="procedureName"
		variant="ghost"
		:color="nameMissing ? 'error' : undefined"
		:highlight="nameMissing"
		:placeholder="editorMode === 'template' ? $t('dms_automation.editor.templateName') : $t('dms_automation.editor.procedureName')"
		:aria-label="editorMode === 'template' ? $t('dms_automation.editor.templateName') : $t('dms_automation.editor.procedureName')"
		:aria-invalid="nameMissing || undefined"
		:aria-describedby="nameMissing ? `${nameInputId}-error` : undefined"
		class="min-w-[12rem] max-w-sm flex-1 font-medium"
	/>
	<DmsFieldError v-if="nameMissing" :id="`${nameInputId}-error`" :message="$t('dms_automation.editor.nameRequired')" />
	<DmsStatusPill
		v-if="currentSummary && editorMode === 'procedure'"
		:tone="STATE_TONES[currentSummary.status]"
		:label="$t(`dms_automation.procedures.status.${currentSummary.status}`)"
		size="sm"
	/>
	<label v-if="selected && editorMode === 'procedure'" class="flex items-center gap-2 text-sm text-muted">
		<USwitch v-model="procedureEnabled" size="sm" />
		{{ procedureEnabled ? $t('dms_automation.editor.enabled') : $t('dms_automation.editor.disabled') }}
	</label>
	<span v-if="selected" class="ml-1 inline-flex items-center gap-1 whitespace-nowrap text-xs" :class="changeCount > 0 ? 'text-warning' : 'text-dimmed'">
		<UIcon :name="changeCount > 0 ? 'i-ph-circle-fill' : 'i-ph-check'" class="size-2.5 shrink-0" />
		{{ saveState }}
	</span>
	<div class="ml-auto flex flex-wrap items-center gap-2">
		<UButton
			v-if="selected"
			variant="ghost"
			color="neutral"
			:disabled="!isDirty || saving"
			@click="emit('discard')"
		>
			{{ $t('dms_automation.editor.discard') }}
		</UButton>
		<template v-if="selected && editorMode === 'procedure'">
			<UButton variant="outline" color="neutral" icon="i-ph-play" @click="emit('run-now')">
				{{ $t('dms_automation.editor.runNowButton') }}
			</UButton>
			<UButton variant="outline" color="neutral" icon="i-ph-flask" :loading="testing" @click="emit('test-run')">
				{{ $t('dms_automation.editor.testRun') }}
				<UKbd :value="formatShortcut(['meta', '↵'])" size="sm" class="ml-1" />
			</UButton>
		</template>
		<UButton v-if="selected" color="primary" icon="i-ph-floppy-disk" :disabled="!isDirty || nameMissing" :loading="saving" @click="emit('save')">
			{{ $t('dms_automation.common.save') }}
			<UKbd :value="formatShortcut(['meta', 's'])" size="sm" class="ml-1" />
		</UButton>
		<UDropdownMenu
			v-if="selected && editorMode === 'procedure'"
			:items="[
				[
					{ label: $t('dms_automation.newProcedure.title'), icon: 'i-ph-plus', onSelect: () => emit('create') },
					{ label: $t('dms_automation.editor.exportJson'), icon: 'i-ph-download-simple', onSelect: () => emit('export') },
					{ label: $t('dms_automation.editor.viewRuns'), icon: 'i-ph-list-bullets', to: `${runsUrl}?procedure=${selectedId}` },
				],
				[{ label: $t('dms_automation.editor.delete'), icon: 'i-ph-trash', color: 'error', onSelect: () => emit('delete') }],
			]"
		>
			<UButton icon="i-ph-dots-three" variant="ghost" color="neutral" :aria-label="$t('dms_automation.editor.more')" />
		</UDropdownMenu>
	</div>
</header>
</template>
