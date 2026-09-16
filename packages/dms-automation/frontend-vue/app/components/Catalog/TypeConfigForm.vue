<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { JsonSchema } from '../../composables/useGraphConnect'

interface CatalogType {
	id: string
	name: string
	description?: string
	icon?: string
}

// `schema` is the JSON schema of the selected type's configuration, read from
// whichever field the catalog exposes it under (trigger types: `configSchema`,
// action types: `inputSchema`). Rendered read-only next to the config editor.
const props = defineProps<{
	type: CatalogType | null
	schema?: JsonSchema
	savedConfig: string | null
	savedEnabled: boolean
}>()

const emit = defineEmits<{
	(e: 'save', payload: { enabled: boolean; config: string }): void
}>()

const enabled = ref<boolean>(props.savedEnabled)
const configText = ref<string>(props.savedConfig ?? '{}')
const parseError = ref<string | null>(null)

watch(
	() => props.type?.id,
	() => {
		enabled.value = props.savedEnabled
		configText.value = props.savedConfig ?? '{}'
		parseError.value = null
	},
)

watch(
	() => props.savedConfig,
	(v) => {
		if (v !== null && v !== undefined) {
			configText.value = v
		}
	},
)

watch(
	() => props.savedEnabled,
	(v) => {
		enabled.value = v
	},
)

function validate() {
	try {
		JSON.parse(configText.value || '{}')
		parseError.value = null
		return true
	} catch (e) {
		parseError.value = (e as Error).message
		return false
	}
}

const schemaPretty = computed(() =>
	props.schema ? JSON.stringify(props.schema, null, 2) : '',
)

function onSave() {
	if (!validate()) return
	emit('save', {
		enabled: enabled.value,
		config: configText.value || '{}',
	})
}
</script>

<template>
	<DmsCard
		v-if="!type"
		class="flex min-h-[16rem] items-center justify-center text-center"
	>
		<div class="flex flex-col items-center gap-3 text-dimmed">
			<UIcon name="i-ph-faders" class="size-8" />
			<p class="max-w-xs text-sm">
				{{ $t('dms_automation.catalog.selectPrompt') }}
			</p>
		</div>
	</DmsCard>

	<DmsCard v-else :padded="false" class="flex flex-col">
		<div class="flex items-start gap-3 border-b border-default px-5 py-4 sm:px-6">
			<div
				class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring ring-primary/20"
			>
				<UIcon :name="type.icon || 'i-ph-puzzle-piece'" class="size-5" />
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="truncate text-lg font-semibold text-highlighted">
					{{ type.name }}
				</h2>
				<p v-if="type.description" class="text-sm text-muted">
					{{ type.description }}
				</p>
				<p class="mt-1 font-mono text-xs text-dimmed">{{ type.id }}</p>
			</div>
		</div>

		<div class="flex flex-col gap-5 px-5 py-4 sm:px-6">
			<div class="flex items-center justify-between gap-4">
				<div>
					<div class="text-sm font-medium text-highlighted">
						{{ $t('dms_automation.catalog.enabled') }}
					</div>
					<div class="text-xs text-muted">
						{{ $t('dms_automation.catalog.enabledHelp') }}
					</div>
				</div>
				<USwitch v-model="enabled" />
			</div>

			<div v-if="schemaPretty" class="flex flex-col gap-1.5">
				<div class="text-sm font-medium text-highlighted">
					{{ $t('dms_automation.catalog.configSchema') }}
				</div>
				<pre
					class="max-h-48 overflow-auto rounded-lg border border-default bg-muted p-3 font-mono text-xs text-toned"
				>{{ schemaPretty }}</pre>
			</div>

			<div class="flex flex-col gap-1.5">
				<div class="text-sm font-medium text-highlighted">
					{{ $t('dms_automation.catalog.globalConfig') }}
				</div>
				<UTextarea
					v-model="configText"
					:rows="10"
					class="w-full font-mono"
					autoresize
					@blur="validate"
				/>
			</div>

			<UAlert
				v-if="parseError"
				color="error"
				variant="subtle"
				icon="i-ph-warning"
				:title="$t('dms_automation.catalog.invalidJson')"
				:description="parseError"
			/>

			<div class="flex justify-end">
				<UButton
					color="primary"
					icon="i-ph-floppy-disk"
					:disabled="!!parseError"
					@click="onSave"
				>
					{{ $t('dms_automation.catalog.save') }}
				</UButton>
			</div>
		</div>
	</DmsCard>
</template>
