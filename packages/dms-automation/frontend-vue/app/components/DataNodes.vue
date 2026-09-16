<script setup lang="ts">
import { computed, ref } from 'vue'
import { type ListEnvelope, unwrapList } from '../utils/automation'
import type {
	DataNodeType,
	JsonSchema,
	JsonSchemaProperty,
} from '../composables/useGraphConnect'

// Catalog-side shape: backend returns DataNodeType minus `evaluate`.
type DataNodeTypeItem = Omit<DataNodeType, 'inputSchema' | 'outputSchema'> & {
	inputSchema?: JsonSchema
	outputSchema?: JsonSchema
}

type JsonSchemaProp = JsonSchemaProperty

interface PortRow {
	name: string
	type: string | string[]
	description?: string
}

// `embedded` drops the page-head when this catalog is rendered inside a Library tab.
defineProps<{ embedded?: boolean }>()

const { $authFetch } = useAuthFetch()

const items = ref<DataNodeTypeItem[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const selectedId = ref<string | null>(null)

async function loadList() {
	loading.value = true
	loadError.value = null
	try {
		const data = await $authFetch<DataNodeTypeItem[] | ListEnvelope<DataNodeTypeItem>>(
			'/api/automation/data-node-types',
		)
		items.value = unwrapList(data)
		if (!selectedId.value && items.value[0]) {
			selectedId.value = items.value[0].id
		}
	} catch (e) {
		loadError.value = (e as Error).message ?? 'Failed to load data node types'
	} finally {
		loading.value = false
	}
}

await loadList()

const selectedType = computed<DataNodeTypeItem | null>(
	() => items.value.find((t) => t.id === selectedId.value) ?? null,
)

function propsOf(schema: JsonSchema | undefined): PortRow[] {
	const props = schema?.properties ?? {}
	return Object.entries(props).map(([name, p]) => ({
		name,
		type: (p as JsonSchemaProp)?.type ?? 'any',
		description: (p as JsonSchemaProp)?.description,
	}))
}

const inputs = computed<PortRow[]>(() => propsOf(selectedType.value?.inputSchema))
const outputs = computed<PortRow[]>(() => propsOf(selectedType.value?.outputSchema))

function categoryOf(t: DataNodeTypeItem): string {
	return t.category ?? 'other'
}
</script>

<template>
	<div :class="embedded ? 'flex flex-col gap-5' : 'flex flex-col gap-6 p-4 sm:p-6'">
		<section v-if="!embedded" class="flex flex-wrap items-center gap-4">
			<div
				class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring ring-primary/20"
			>
				<UIcon name="i-ph-cube" class="size-6" />
			</div>
			<div class="min-w-0 flex-1">
				<h1 class="text-2xl font-semibold tracking-tight text-highlighted">
					{{ $t('dms_automation.data_nodes.title') }}
				</h1>
				<p class="text-sm text-muted">
					{{ $t('dms_automation.data_nodes.description') }}
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
				{{ $t('dms_automation.data_nodes.refresh') }}
			</UButton>
		</section>

		<UAlert
			v-if="loadError"
			color="error"
			variant="subtle"
			icon="i-ph-warning"
			:title="$t('dms_automation.data_nodes.loadError')"
			:description="loadError"
		/>

		<div
			class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,340px)_1fr] lg:items-start"
		>
			<DmsAutomationTypeList
				:types="items"
				:model-value="selectedId"
				:group-by="categoryOf"
				:title="$t('dms_automation.data_nodes.listLabel')"
				class="lg:max-h-[calc(100vh-12rem)]"
				@update:model-value="selectedId = $event"
			/>

			<DmsCard v-if="selectedType" :padded="false" class="flex flex-col">
				<div class="flex items-start gap-3 border-b border-default px-5 py-4 sm:px-6">
					<div
						class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring ring-primary/20"
					>
						<UIcon :name="selectedType.icon || 'i-ph-cube'" class="size-5" />
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="truncate text-lg font-semibold text-highlighted">
							{{ selectedType.name }}
						</h2>
						<p class="mt-1 font-mono text-xs text-dimmed">{{ selectedType.id }}</p>
					</div>
					<UBadge
						v-if="selectedType.category"
						color="neutral"
						variant="subtle"
						class="shrink-0"
					>
						{{ selectedType.category }}
					</UBadge>
				</div>

				<div class="flex flex-col gap-6 px-5 py-4 sm:px-6">
					<p v-if="selectedType.description" class="text-sm text-toned">
						{{ selectedType.description }}
					</p>

					<div class="flex flex-col gap-2">
						<div class="text-sm font-semibold text-highlighted">
							{{ $t('dms_automation.data_nodes.inputs') }}
						</div>
						<div v-if="inputs.length === 0" class="text-sm text-dimmed">
							{{ $t('dms_automation.data_nodes.noPorts') }}
						</div>
						<div
							v-else
							class="overflow-hidden rounded-lg border border-default"
						>
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-default bg-muted">
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.data_nodes.col.name') }}
										</th>
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.data_nodes.col.type') }}
										</th>
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.data_nodes.col.description') }}
										</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="row in inputs"
										:key="`in-${row.name}`"
										class="border-b border-default/60 last:border-0"
									>
										<td class="px-4 py-2.5 font-mono text-highlighted">
											{{ row.name }}
										</td>
										<td class="whitespace-nowrap px-4 py-2.5 font-mono text-primary">
											{{ row.type }}
										</td>
										<td class="px-4 py-2.5 text-muted">
											{{ row.description ?? '' }}
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<div class="text-sm font-semibold text-highlighted">
							{{ $t('dms_automation.data_nodes.outputs') }}
						</div>
						<div v-if="outputs.length === 0" class="text-sm text-dimmed">
							{{ $t('dms_automation.data_nodes.noPorts') }}
						</div>
						<div
							v-else
							class="overflow-hidden rounded-lg border border-default"
						>
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-default bg-muted">
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.data_nodes.col.name') }}
										</th>
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.data_nodes.col.type') }}
										</th>
										<th class="px-4 py-2.5 text-left text-xs font-semibold text-dimmed">
											{{ $t('dms_automation.data_nodes.col.description') }}
										</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="row in outputs"
										:key="`out-${row.name}`"
										class="border-b border-default/60 last:border-0"
									>
										<td class="px-4 py-2.5 font-mono text-highlighted">
											{{ row.name }}
										</td>
										<td class="whitespace-nowrap px-4 py-2.5 font-mono text-primary">
											{{ row.type }}
										</td>
										<td class="px-4 py-2.5 text-muted">
											{{ row.description ?? '' }}
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</DmsCard>

			<DmsCard
				v-else
				class="flex min-h-[16rem] items-center justify-center text-center"
			>
				<div class="flex flex-col items-center gap-3 text-dimmed">
					<UIcon name="i-ph-cube" class="size-8" />
					<p class="max-w-xs text-sm">
						{{ $t('dms_automation.data_nodes.empty') }}
					</p>
				</div>
			</DmsCard>
		</div>
	</div>
</template>
