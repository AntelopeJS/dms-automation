<script setup lang="ts">
import { ref, watch } from 'vue'

interface ProcedureListItem {
	_id: string
	name: string
	enabled: boolean
}

const props = defineProps<{
	procedures: ProcedureListItem[]
	modelValue: string | null
}>()

const emit = defineEmits(['update:modelValue', 'create', 'delete'])

const confirmOpen = ref(false)
const pendingDeleteId = ref<string | null>(null)
const pendingDeleteName = ref<string>('')

function select(id: string) {
	const next = props.modelValue === id ? null : id
	emit('update:modelValue', next)
}

function askDelete(p: ProcedureListItem) {
	pendingDeleteId.value = p._id
	pendingDeleteName.value = p.name
	confirmOpen.value = true
}

function confirmDelete() {
	const id = pendingDeleteId.value
	if (id) {
		emit('delete', id)
	}
	confirmOpen.value = false
}

function cancelDelete() {
	confirmOpen.value = false
}

// Reset pending state whenever the modal closes (via any means).
watch(confirmOpen, (open) => {
	if (!open) {
		pendingDeleteId.value = null
		pendingDeleteName.value = ''
	}
})

const isSelected = (id: string) => props.modelValue === id
</script>

<template>
	<div class="flex flex-col gap-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="text-sm font-semibold text-highlighted">
				{{ $t('dms_automation.editor.procedureList.title') }}
			</div>
			<UButton
				size="xs"
				icon="i-ph-plus"
				color="primary"
				variant="soft"
				class="shrink-0"
				@click="emit('create')"
			>
				{{ $t('dms_automation.editor.procedureList.new') }}
			</UButton>
		</div>

		<div
			v-if="!procedures || procedures.length === 0"
			class="px-2 py-6 text-center text-sm text-dimmed"
		>
			{{ $t('dms_automation.editor.procedureList.empty') }}
		</div>
		<ul v-else class="flex flex-col gap-1">
			<li v-for="p in procedures" :key="p._id">
				<div
					class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
					:class="
						isSelected(p._id)
							? 'bg-primary/10 ring-1 ring-primary/20'
							: 'hover:bg-elevated/60'
					"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-2 text-left"
						@click="select(p._id)"
					>
						<div class="min-w-0 flex-1">
							<div
								class="truncate text-sm font-medium"
								:class="isSelected(p._id) ? 'text-primary' : 'text-highlighted'"
							>
								{{ p.name }}
							</div>
						</div>
						<UBadge
							:color="p.enabled ? 'success' : 'neutral'"
							variant="subtle"
							size="xs"
						>
							{{
								p.enabled
									? $t('dms_automation.editor.procedureList.enabled')
									: $t('dms_automation.editor.procedureList.disabled')
							}}
						</UBadge>
					</button>
					<UButton
						size="xs"
						icon="i-ph-trash"
						color="error"
						variant="ghost"
						:aria-label="$t('dms_automation.editor.procedureList.deleteAria')"
						@click.stop="askDelete(p)"
					/>
				</div>
			</li>
		</ul>

		<UModal
			v-model:open="confirmOpen"
			:title="$t('dms_automation.editor.procedureList.deleteTitle')"
		>
			<template #body>
				<p class="text-muted">
					{{
						$t('dms_automation.editor.procedureList.deleteConfirm', {
							name: pendingDeleteName,
						})
					}}
				</p>
			</template>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						:label="$t('dms_automation.editor.procedureList.cancel')"
						variant="outline"
						color="neutral"
						@click="cancelDelete"
					/>
					<UButton
						:label="$t('dms_automation.editor.procedureList.delete')"
						color="error"
						@click="confirmDelete"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>
