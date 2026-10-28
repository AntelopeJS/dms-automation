<script setup lang="ts">
import EditorBanners from '../build/components/editor/EditorBanners.vue'
import EditorChoiceModal from '../build/components/editor/EditorChoiceModal.vue'
import EditorForkModal from '../build/components/editor/EditorForkModal.vue'
import EditorHeader from '../build/components/editor/EditorHeader.vue'
import EditorSaveTemplateModal from '../build/components/editor/EditorSaveTemplateModal.vue'
import { createEditorContext } from '../build/composables/editor/useEditorContext'
import { useBuilderMount } from '../build/composables/editor/useBuilderMount'
import { useBuilderSave } from '../build/composables/editor/useBuilderSave'
import { useBuilderShortcuts } from '../build/composables/editor/useBuilderShortcuts'
import { useDraftProblems } from '../build/composables/editor/useDraftProblems'
import { useEditorLoad } from '../build/composables/editor/useEditorLoad'
import { useForkToLocal } from '../build/composables/editor/useForkToLocal'
import { useGraphHistory } from '../build/composables/editor/useGraphHistory'
import { useGroupEditing } from '../build/composables/editor/useGroupEditing'
import { usePalette } from '../build/composables/editor/usePalette'
import { useProcedureActions } from '../build/composables/editor/useProcedureActions'
import { useRunOverlay } from '../build/composables/editor/useRunOverlay'
import { useSaveAsTemplate } from '../build/composables/editor/useSaveAsTemplate'
import { useSavedTriggers } from '../build/composables/editor/useSavedTriggers'
import { seedSubgraphPath, useSubgraphNavigation } from '../build/composables/editor/useSubgraphNavigation'
import { useUnsavedGuards } from '../build/composables/editor/useUnsavedGuards'

// Editor mode.
//
// 'procedure' (default) — loads /api/automation/procedures,
//   manages the selected procedure list, saves via PUT /procedures/:id, exposes
//   the manual Run-now button.
// 'template'   — loads ONE template via GET /api/automation/templates/:id and
//   edits its `subgraph` directly. The template's `ports` are injected as the
//   root canvas's `parentGroupPorts` so the groupInput/groupOutput sentinels at
//   the root level render the template's outer-face handles. Save goes to
//   PUT /api/automation/templates/:id. Run, procedure list, and enabled toggle
//   are hidden.
//
// Mode is resolved from the route query: `?template=<id>` switches into
// template mode.
// This keeps the route wiring trivial (the Templates catalog navigates
// to `/modules/automation/builder?template=<id>`) without needing a
// dedicated page.
const props = withDefaults(
	defineProps<{
		apiUrl?: string
		runsUrl?: string
		traceUrl?: string
	}>(),
	{
		apiUrl: '/api/automation',
		runsUrl: '/modules/automation/runs',
		traceUrl: '/modules/automation/trace',
	},
)

const ctx = createEditorContext(props)
const graphHistory = useGraphHistory(ctx)
const load = useEditorLoad(ctx)

// What the builder opens is awaited: the server renders it, and the browser
// opens the same from the data handed over. The catalogs, the templates and
// the bar's figures are read meanwhile, in parallel.
await Promise.all([load.procedureListRead, load.templateRead])
if (ctx.editorMode.value === 'template') load.openTemplate()
else load.openList()

// `watch(selectedId, …)` (declared below) doesn't fire for the value
// assigned during the awaits above, so seed history + savedSnapshot once
// for the auto-selected procedure. Must come after `selected` is declared
// — initHistoryAndSaved() reads selected.value.
graphHistory.initHistoryAndSaved()
seedSubgraphPath(ctx)

const nav = useSubgraphNavigation(ctx, graphHistory, load)
const groups = useGroupEditing(ctx, nav)
const problems = useDraftProblems(ctx, graphHistory, nav)
const triggers = useSavedTriggers(ctx, problems)
const guards = useUnsavedGuards(ctx, graphHistory, problems, { onSave: () => save.onSave() })
const actions = useProcedureActions(ctx, load, problems, guards)
const save = useBuilderSave(ctx, graphHistory, problems, triggers, guards, { onTestRun: () => runs.onTestRun() })
const saveTpl = useSaveAsTemplate(ctx, graphHistory, nav, save)
const fork = useForkToLocal(ctx, nav)
useBuilderShortcuts(ctx, graphHistory, nav, groups, guards, save, saveTpl, fork, {
	onTestRun: () => runs.onTestRun(),
	exitDebug: () => runs.exitDebug(),
})
const runs = useRunOverlay(ctx, graphHistory, problems, triggers, guards)
const mount = useBuilderMount(ctx, nav, problems, runs)
const palette = usePalette()

// The inspector (or the template's ports): docked beside the canvas from lg
// (the palette starts folded below xl, so the canvas keeps most of the
// width), floating over it on narrower screens.
const ASIDE_CLASS =
	'absolute inset-y-0 right-0 z-10 flex w-80 max-w-full flex-col border-l border-default bg-default shadow-lg lg:relative lg:z-auto lg:shrink-0 lg:shadow-none'

const { actionTypes, canvasViewKey, currentGraph, currentParentGroupPorts, dataNodeTypes, dockCollapsed, dockTab, draftTriggers, editorMode, formatShortcut, graphCanvasRef, inspectorRef, isCurrentGraphReadOnly, libraryBackUrl, loadError, loading, missingProcedureId, newProcedureOpen, nodeKinds, onSelectionChange, overlayIsTest, overlayRun, paletteTriggerTypes, palettesTemplates, runNowOpen, saveBlocked, saving, selected, selectedId, selectedNode, selectedNodeActionType, selectedNodeId, selectedNodeIds, selectedNodeTriggerType, subgraphPath, switcherOpen, templateNotFound, templatePorts, testPayload, testPayloadSource, testTriggerNodeId, testing, triggerTypes } = ctx
const { canRedo, canUndo, isDirty, onRedo, onUndo } = graphHistory
const { breadcrumbItems, canEnterGroup, enterSelectedGroup, exitSubgraph, onGraphUpdate, onGroupEnter, onPaletteAddNode, onPaletteAddTemplate, onSelectNode, onUpdateNode } = nav
const { canGroupSelection, createGroupFromSelection, onDeleteNode, onDuplicateNode, onPortsUpdate, onTemplatePortsUpdate, onUnwireField, onWrapInRetry, showTemplatePorts } = groups
const { NAME_INPUT_ID, blockingIssues, changeCount, currentSummary, dockIssues, issuesByNode, nameMissing, nodeDisplayName, onCancel, procedureEnabled, procedureName, savedName, selectNode, summaries } = problems
const { pausedBanner, saveState, savedTriggers } = triggers
const { answerChoice, choiceDialog, onChoiceDialogOpen, onPickProcedure } = guards
const { onCreate, onCreated, onDelete, onExport } = actions
const { enableNow, goToFirstProblem, onSave, saveAsDraft } = save
const { canSaveAsTemplate, openSaveAsTemplate, saveAsTemplateDescription, saveAsTemplateError, saveAsTemplateIcon, saveAsTemplateName, saveAsTemplateOpen, saveAsTemplateSubmitting, selectedLocalGroupNode, submitSaveAsTemplate, templateFieldErrors } = saveTpl
const { canForkToLocal, forkError, forkOpen, forkSubmitting, openFork, submitFork } = fork
const { exitDebug, onRunStarted, onTestRun, openRunNow, openTrace, overlayDescription, overlayLabel, overlayLook, overlaySteps, overlaySummary, recentRuns, rerunOverlay, runStates, selectedRunStep } = runs
const { testTriggerItems } = mount
const { paletteHidden, togglePalette } = palette
</script>

<template>
	<!--
		The builder is one tool: the page hides its header (src/pages/builder.ts)
		and the editor fills the panel. One bar holds the procedure's identity,
		state and actions; the palette, the canvas and the inspector share the
		height; the dock under them lists problems, runs and the test payload.
	-->
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-default bg-default">
		<EditorHeader
			v-model:name="procedureName"
			v-model:enabled="procedureEnabled"
			:editor-mode="editorMode"
			:library-back-url="libraryBackUrl"
			:selected="selected"
			:selected-id="selectedId"
			:current-graph="currentGraph"
			:is-current-graph-read-only="isCurrentGraphReadOnly"
			:palette-hidden="paletteHidden"
			:name-input-id="NAME_INPUT_ID"
			:name-missing="nameMissing"
			:current-summary="currentSummary"
			:change-count="changeCount"
			:save-state="saveState"
			:is-dirty="isDirty"
			:saving="saving"
			:testing="testing"
			:runs-url="runsUrl"
			:format-shortcut="formatShortcut"
			@open-switcher="switcherOpen = true"
			@toggle-palette="togglePalette"
			@discard="onCancel"
			@run-now="openRunNow"
			@test-run="onTestRun"
			@save="onSave"
			@create="onCreate"
			@export="onExport"
			@delete="onDelete"
		/>

		<EditorBanners
			:load-error="loadError"
			:template-not-found="templateNotFound"
			:editor-mode="editorMode"
			:library-back-url="libraryBackUrl"
			:save-blocked="saveBlocked"
			:blocking-issues="blockingIssues"
			:paused-banner="pausedBanner"
			:saving="saving"
			:testing="testing"
			:overlay-run="overlayRun"
			:overlay-is-test="overlayIsTest"
			:overlay-look="overlayLook"
			:overlay-summary="overlaySummary"
			:overlay-description="overlayDescription"
			:is-dirty="isDirty"
			:is-current-graph-read-only="isCurrentGraphReadOnly"
			:can-fork-to-local="canForkToLocal"
			@go-to-first-problem="goToFirstProblem"
			@save-as-draft="saveAsDraft"
			@enable-now="enableNow"
			@rerun="rerunOverlay"
			@test-run="onTestRun"
			@open-trace="openTrace"
			@exit-debug="exitDebug"
			@open-fork="openFork"
		/>

		<DmsEmptyState
			v-if="!selected && !loading && editorMode === 'procedure' && missingProcedureId"
			class="m-auto"
			size="lg"
			icon="i-ph-question"
			:title="$t('dms_automation.editor.missingTitle')"
			:description="$t('dms_automation.editor.missingDescription')"
			:actions="[
				{ label: $t('dms_automation.editor.missingPick'), icon: 'i-ph-flow-arrow', onClick: () => (switcherOpen = true) },
				{ label: $t('dms_automation.newProcedure.title'), icon: 'i-ph-plus', variant: 'outline', onClick: () => (newProcedureOpen = true) },
			]"
		/>
		<DmsEmptyState
			v-else-if="!selected && !loading && editorMode === 'procedure'"
			class="m-auto"
			size="lg"
			icon="i-ph-flow-arrow"
			:title="$t('dms_automation.editor.noProcedureTitle')"
			:description="$t('dms_automation.editor.noProcedure')"
			:actions="[{ label: $t('dms_automation.newProcedure.title'), icon: 'i-ph-plus', onClick: () => (newProcedureOpen = true) }]"
		/>

		<div v-if="selected" class="relative flex min-h-0 flex-1">
			<DmsAutomationBuilderPalette
				v-if="currentGraph && !isCurrentGraphReadOnly && !paletteHidden"
				:node-kinds="nodeKinds"
				:trigger-types="paletteTriggerTypes"
				:action-types="actionTypes"
				:data-node-types="dataNodeTypes"
				:templates="palettesTemplates"
				class="w-60 shrink-0 border-r border-default"
				@add-node="onPaletteAddNode"
				@add-template="onPaletteAddTemplate"
			/>
			<div class="h-full min-w-0 flex-1">
				<DmsClientOnly>
					<DmsAutomationGraphCanvas
						v-if="currentGraph"
						ref="graphCanvasRef"
						:graph="currentGraph"
						:trigger-types="triggerTypes"
						:action-types="actionTypes"
						:data-node-types="dataNodeTypes"
						:node-kinds="nodeKinds"
						:can-undo="canUndo"
						:can-redo="canRedo"
						:parent-group-ports="currentParentGroupPorts"
						:read-only="isCurrentGraphReadOnly"
						:run-states="runStates"
						:issues="subgraphPath.length <= 1 ? issuesByNode : undefined"
						:selected-node-id="selectedNodeId"
						:view-key="canvasViewKey"
						:covered-by="inspectorRef"
						:triggers="draftTriggers"
						class="[&_.graph-canvas-wrap]:rounded-none [&_.graph-canvas-wrap]:border-0"
						@update:graph="onGraphUpdate"
						@select:node="onSelectNode"
						@selection-change="onSelectionChange"
						@undo="onUndo"
						@redo="onRedo"
						@group:enter="onGroupEnter"
					>
						<template #breadcrumb>
							<div class="flex items-center gap-2 rounded-lg border border-default bg-elevated/90 px-2 py-1 shadow-sm">
								<UBreadcrumb :items="breadcrumbItems" />
								<UButton
									v-if="subgraphPath.length > 1"
									size="xs"
									variant="ghost"
									color="neutral"
									icon="i-ph-arrow-up-left"
									@click="exitSubgraph"
								>
									{{ $t('dms_automation.editor.exitSubgraph') }}
								</UButton>
							</div>
						</template>
						<template
							v-if="canGroupSelection || canSaveAsTemplate || canForkToLocal || canEnterGroup"
							#groupActions
						>
							<span v-if="selectedNodeIds.length > 1" class="px-1 text-xs text-muted">
								{{ $t('dms_automation.editor.selected', { count: selectedNodeIds.length }) }}
							</span>
							<UButton v-if="canEnterGroup" size="sm" color="primary" icon="i-ph-arrow-square-in" variant="ghost" @click="enterSelectedGroup">
								{{ $t('dms_automation.editor.enterGroup') }}
							</UButton>
							<UButton v-if="canGroupSelection" size="sm" color="primary" icon="i-ph-stack" variant="ghost" @click="createGroupFromSelection">
								{{ $t('dms_automation.editor.groupSelection', { n: selectedNodeIds.length }) }}
							</UButton>
							<UButton v-if="canSaveAsTemplate" size="sm" color="primary" icon="i-ph-floppy-disk" variant="ghost" @click="openSaveAsTemplate">
								{{ $t('dms_automation.editor.saveAsTemplate') }}
							</UButton>
							<UButton v-if="canForkToLocal" size="sm" color="primary" icon="i-ph-git-fork" variant="ghost" @click="openFork">
								{{ $t('dms_automation.editor.forkToLocal') }}
							</UButton>
						</template>
					</DmsAutomationGraphCanvas>
					<template #fallback>
						<div class="flex h-full items-center justify-center text-sm text-dimmed">
							{{ $t('dms_automation.editor.loading') }}
						</div>
					</template>
				</DmsClientOnly>
			</div>
			<aside v-if="showTemplatePorts" ref="inspectorRef" :class="ASIDE_CLASS">
				<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
					<p class="text-xs text-muted">{{ $t('dms_automation.editor.templatePortsHint') }}</p>
					<DmsAutomationGroupPortEditor :ports="templatePorts" @ports:update="onTemplatePortsUpdate" />
				</div>
			</aside>
			<aside v-else-if="selectedNode" ref="inspectorRef" :class="ASIDE_CLASS">
				<DmsAutomationNodeInspector
					:node="selectedNode"
					:data-edges="currentGraph?.dataEdges ?? []"
					:trigger-type="selectedNodeTriggerType"
					:action-type="selectedNodeActionType"
					:data-node-types="dataNodeTypes"
					:node-kinds="nodeKinds"
					:read-only="isCurrentGraphReadOnly"
					:run-step="subgraphPath.length <= 1 ? selectedRunStep : null"
					:run-label="overlayLabel"
					:run-trace-url="overlayRun ? `${traceUrl}?run=${overlayRun._id}` : undefined"
					:issue="issuesByNode[selectedNode.id] ?? null"
					:node-name="nodeDisplayName"
					:saved-triggers="savedTriggers"
					@update:node="onUpdateNode"
					@unwire="onUnwireField"
					@ports:update="onPortsUpdate"
					@group:enter="onGroupEnter"
					@delete:node="onDeleteNode"
					@duplicate:node="onDuplicateNode"
					@wrap:retry="onWrapInRetry"
					@close="selectedNodeId = null"
				/>
			</aside>
		</div>

		<DmsAutomationBottomDock
			v-if="selected && editorMode === 'procedure'"
			v-model:tab="dockTab"
			v-model:payload="testPayload"
			v-model:collapsed="dockCollapsed"
			:issues="dockIssues"
			:runs="recentRuns"
			:test-steps="overlaySteps"
			:payload-source="testPayloadSource"
			:triggers="testTriggerItems"
			v-model:trigger="testTriggerNodeId"
			:runs-url="`${runsUrl}?procedure=${selectedId}`"
			@select-node="selectNode"
			@open-trace="openTrace"
		/>

		<DmsAutomationProcedureSwitcher
			v-if="editorMode === 'procedure'"
			v-model:open="switcherOpen"
			:procedures="summaries"
			:current-id="selectedId"
			proceduresUrl="/modules/automation/procedures"
			@pick="onPickProcedure"
			@create="onCreate"
		/>
		<DmsAutomationNewProcedureDialog v-model:open="newProcedureOpen" :api-url="apiUrl" @created="onCreated" />
		<DmsAutomationRunNowDialog
			v-if="selected && editorMode === 'procedure'"
			v-model:open="runNowOpen"
			:api-url="apiUrl"
			:procedure-id="selected._id"
			:procedure-name="savedName"
			:triggers="savedTriggers"
			@started="onRunStarted"
		/>

		<EditorChoiceModal :dialog="choiceDialog" @update:open="onChoiceDialogOpen" @answer="answerChoice" />

		<EditorSaveTemplateModal
			v-model:open="saveAsTemplateOpen"
			v-model:name="saveAsTemplateName"
			v-model:description="saveAsTemplateDescription"
			v-model:icon="saveAsTemplateIcon"
			:group="selectedLocalGroupNode"
			:submitting="saveAsTemplateSubmitting"
			:error="saveAsTemplateError"
			:field-errors="templateFieldErrors"
			@submit="submitSaveAsTemplate"
		/>

		<EditorForkModal v-model:open="forkOpen" :submitting="forkSubmitting" :error="forkError" @submit="submitFork" />
	</div>
</template>
