<script setup lang="ts">
import { computed, ref } from 'vue'
import { type ListEnvelope, unwrapList } from '../utils/automation'
import type { TriggerType } from '../composables/useGraphConnect'

type TriggerTypeItem = TriggerType & { globalConfig?: string; enabled?: boolean }

// `embedded` drops the page-head when this catalog is rendered inside a Library tab.
defineProps<{ embedded?: boolean }>()

const { $authFetch } = useAuthFetch()
const toast = useToast()

const items = ref<TriggerTypeItem[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

async function loadList() {
	loading.value = true
	loadError.value = null
	try {
		const data = await $authFetch<TriggerTypeItem[] | ListEnvelope<TriggerTypeItem>>(
			'/api/automation/trigger-types',
		)
		items.value = unwrapList(data)
	} catch (e) {
		loadError.value = (e as Error).message ?? 'Failed to load trigger types'
	} finally {
		loading.value = false
	}
}

await loadList()

const selectedId = ref<string | null>(items.value[0]?.id ?? null)

const selectedType = computed<TriggerTypeItem | null>(
	() => items.value.find((t) => t.id === selectedId.value) ?? null,
)

const selectedConfig = computed(() => selectedType.value?.globalConfig ?? '{}')
const selectedEnabled = computed(() => selectedType.value?.enabled ?? true)

async function onSave(payload: { enabled: boolean; config: string }) {
	if (!selectedType.value) return
	const id = selectedType.value.id
	try {
		await $authFetch(`/api/automation/trigger-types/${id}/config`, {
			method: 'PUT',
			body: payload,
		})
		// Reflect saved state locally
		const idx = items.value.findIndex((t) => t.id === id)
		if (idx >= 0) {
			const current = items.value[idx]
			if (current) {
				items.value[idx] = {
					...current,
					enabled: payload.enabled,
					globalConfig: payload.config,
				}
			}
		}
		toast.add({
			title: 'Trigger saved',
			description: id,
			color: 'success',
			icon: 'i-ph-check-circle',
		})
	} catch (e) {
		toast.add({
			title: 'Failed to save trigger',
			description: (e as Error).message ?? id,
			color: 'error',
			icon: 'i-ph-warning',
		})
	}
}
</script>

<template>
	<div :class="embedded ? 'flex flex-col gap-5' : 'flex flex-col gap-6 p-4 sm:p-6'">
		<section v-if="!embedded" class="flex flex-wrap items-center gap-4">
			<div
				class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring ring-primary/20"
			>
				<UIcon name="i-ph-lightning" class="size-6" />
			</div>
			<div class="min-w-0 flex-1">
				<h1 class="text-2xl font-semibold tracking-tight text-highlighted">
					{{ $t('dms_automation.triggers.title') }}
				</h1>
				<p class="text-sm text-muted">
					{{ $t('dms_automation.triggers.description') }}
				</p>
			</div>
			<UButton
				class="ml-auto"
				color="neutral"
				variant="outline"
				icon="i-ph-arrows-clockwise"
				:loading="loading"
				@click="loadList"
			>
				{{ $t('dms_automation.common.refresh') }}
			</UButton>
		</section>

		<UAlert
			v-if="loadError"
			color="error"
			variant="subtle"
			icon="i-ph-warning"
			:title="$t('dms_automation.triggers.loadError')"
			:description="loadError"
		/>

		<div
			class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,340px)_1fr] lg:items-start"
		>
			<DmsAutomationTypeList
				:types="items"
				:model-value="selectedId"
				:title="$t('dms_automation.triggers.listLabel')"
				class="lg:max-h-[calc(100vh-12rem)]"
				@update:model-value="selectedId = $event"
			/>
			<DmsAutomationTypeConfigForm
				:type="selectedType"
				:schema="selectedType?.configSchema"
				:saved-config="selectedConfig"
				:saved-enabled="selectedEnabled"
				@save="onSave"
			/>
		</div>
	</div>
</template>
