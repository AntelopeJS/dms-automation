<script setup lang="ts">
import type { GraphNode } from '../../../composables/useGraphConnect'
import { TEMPLATE_NAME_ID, TEMPLATE_ROW } from '../../composables/editor/useSaveAsTemplate'

defineProps<{
	group: GraphNode | null
	submitting: boolean
	error: string | null
	fieldErrors: ReturnType<typeof useFieldErrors<'name'>>
}>()

const emit = defineEmits<{ submit: [] }>()

const open = defineModel<boolean>('open', { required: true })
const name = defineModel<string>('name', { required: true })
const description = defineModel<string>('description', { required: true })
const icon = defineModel<string>('icon', { required: true })
</script>

<template>
<UModal
	v-model:open="open"
	:title="$t('dms_automation.editor.saveTemplateModal.title')"
>
	<template #body>
		<div class="flex flex-col gap-3">
			<DmsFieldRow
				v-bind="TEMPLATE_ROW"
				:label="$t('dms_automation.editor.saveTemplateModal.name')"
				:label-for="TEMPLATE_NAME_ID"
				required
			>
				<div class="grid gap-1.5">
					<DmsInputText
						:id="TEMPLATE_NAME_ID"
						v-model="name"
						:placeholder="$t('dms_automation.editor.saveTemplateModal.namePlaceholder')"
						class="w-full"
						:disabled="submitting"
						v-bind="fieldErrors.aria('name')"
					/>
					<DmsFieldError :id="fieldErrors.errorId('name')" :message="fieldErrors.errors.name" />
				</div>
			</DmsFieldRow>
			<DmsFieldRow
				v-bind="TEMPLATE_ROW"
				:label="$t('dms_automation.editor.saveTemplateModal.description')"
				label-for="save-template-description"
			>
				<DmsTextarea
					id="save-template-description"
					v-model="description"
					:placeholder="$t('dms_automation.editor.saveTemplateModal.descriptionPlaceholder')"
					class="w-full"
					:rows="3"
					:disabled="submitting"
				/>
			</DmsFieldRow>
			<DmsFieldRow v-bind="TEMPLATE_ROW" :label="$t('dms_automation.editor.saveTemplateModal.icon')">
				<DmsAutomationIconPicker v-model="icon" />
			</DmsFieldRow>
			<div v-if="group?.ports?.length" class="flex flex-col gap-1">
				<span class="text-xs font-medium text-highlighted">{{ $t('dms_automation.editor.saveTemplateModal.ports') }}</span>
				<div class="overflow-hidden rounded-md border border-default">
					<div
						v-for="port in group.ports"
						:key="`${port.direction}-${port.kind}-${port.name}`"
						class="flex items-center gap-2 border-b border-default px-2 py-1 font-mono text-xs last:border-0"
					>
						<UBadge size="sm" variant="subtle" :color="port.kind === 'trigger' ? 'info' : 'success'">{{ $t(`dms_automation.templates.ports.kind.${port.kind}`) }}</UBadge>
						<span class="text-muted">{{ $t(`dms_automation.templates.ports.direction.${port.direction}`) }}</span>
						<span class="text-highlighted">{{ port.name }}</span>
						<span v-if="port.schema?.type" class="ml-auto text-dimmed">{{ port.schema.type }}</span>
					</div>
				</div>
			</div>
			<DmsBanner
				v-if="error"
				size="sm"
				tone="error"
				:title="$t('dms_automation.editor.saveTemplateModal.error')"
				:description="error"
			/>
			<DmsFormRequiredLegend />
		</div>
	</template>
	<template #footer>
		<div class="flex w-full justify-end gap-2">
			<UButton
				:label="$t('dms_automation.editor.saveTemplateModal.cancel')"
				variant="outline"
				color="neutral"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				:label="$t('dms_automation.editor.saveTemplateModal.submit')"
				color="primary"
				:loading="submitting"
				@click="emit('submit')"
			/>
		</div>
	</template>
</UModal>
</template>
