<script lang="ts">
// The `generic` attribute is compiled into the component's module scope, where
// a type declared inside `<script setup>` does not exist yet. Catalog entries
// therefore describe themselves here.
export interface CatalogType {
	id: string
	name: string
	description?: string
	icon?: string
}
</script>

<script setup lang="ts" generic="T extends CatalogType">
import { computed, ref } from 'vue'

const props = withDefaults(
	defineProps<{
		types: T[]
		modelValue: string | null
		groupBy?: (t: T) => string
		title?: string
		/** Show the inline search box (on by default). */
		searchable?: boolean
		/** Placeholder for the search box; falls back to a generic label. */
		searchPlaceholder?: string
	}>(),
	// A bare `boolean` prop defaults to `false` when omitted, which would
	// silently hide search on every catalog; pin the intended on-by-default.
	{ searchable: true },
)

const emit = defineEmits<{
	(e: 'update:modelValue', value: string): void
}>()

function select(id: string) {
	emit('update:modelValue', id)
}

const isSelected = (id: string) => props.modelValue === id

// Search defaults to on; pass `:searchable="false"` to opt out.
const searchEnabled = computed(() => props.searchable !== false)
const query = ref('')

// Case-insensitive substring filter over name / description / id. Catalogs hold
// at most a few hundred registered types, so a per-keystroke scan is cheap and
// avoids pulling in a fuzzy-match dependency.
const visibleTypes = computed<T[]>(() => {
	const q = query.value.trim().toLowerCase()
	if (!searchEnabled.value || !q) return props.types
	return props.types.filter(
		(t) =>
			t.name?.toLowerCase().includes(q) ||
			t.description?.toLowerCase().includes(q) ||
			t.id?.toLowerCase().includes(q),
	)
})

// Group the types by the optional groupBy callback. Preserve insertion order:
// groups appear in the order of their first-seen member.
const grouped = computed<Array<{ key: string; items: T[] }> | null>(() => {
	if (!props.groupBy) return null
	const order: string[] = []
	const byKey = new Map<string, T[]>()
	for (const t of visibleTypes.value) {
		const key = props.groupBy(t)
		const bucket = byKey.get(key)
		if (bucket) {
			bucket.push(t)
		} else {
			byKey.set(key, [t])
			order.push(key)
		}
	}
	return order.map((key) => ({ key, items: byKey.get(key) as T[] }))
})

const itemClass = (id: string) =>
	isSelected(id)
		? 'bg-primary/10 text-primary ring-1 ring-primary/20'
		: 'text-toned hover:bg-elevated/60'
</script>

<template>
	<DmsCard :padded="false" class="flex flex-col overflow-hidden">
		<div
			v-if="title"
			class="flex items-center justify-between gap-2 border-b border-default px-4 py-3"
		>
			<h2 class="text-sm font-semibold text-highlighted">{{ title }}</h2>
			<UBadge color="neutral" variant="subtle" size="sm" class="tabular-nums">
				{{ visibleTypes.length }}
			</UBadge>
		</div>

		<div
			v-if="searchEnabled && types.length"
			class="border-b border-default px-3 py-2"
		>
			<UInput
				v-model="query"
				:placeholder="searchPlaceholder || $t('dms_automation.catalog.search')"
				icon="i-ph-magnifying-glass"
				size="sm"
				autocomplete="off"
				class="w-full"
			/>
		</div>

		<div class="flex-1 overflow-y-auto p-2">
			<div
				v-if="!types || types.length === 0"
				class="px-3 py-6 text-center text-sm text-dimmed"
			>
				{{ $t('dms_automation.catalog.empty') }}
			</div>

			<div
				v-else-if="visibleTypes.length === 0"
				class="px-3 py-6 text-center text-sm text-dimmed"
			>
				{{ $t('dms_automation.catalog.noResults') }}
			</div>

			<template v-else-if="grouped">
				<div
					v-for="group in grouped"
					:key="group.key"
					class="mb-2 flex flex-col gap-1 last:mb-0"
				>
					<div
						class="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-dimmed"
					>
						{{ group.key }}
					</div>
					<ul class="flex flex-col gap-1">
						<li v-for="t in group.items" :key="t.id">
							<button
								type="button"
								class="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors"
								:class="itemClass(t.id)"
								@click="select(t.id)"
							>
								<UIcon
									v-if="t.icon"
									:name="t.icon"
									class="mt-0.5 size-4 shrink-0"
									:class="isSelected(t.id) ? 'text-primary' : 'text-dimmed'"
								/>
								<div class="min-w-0 flex-1">
									<div
										class="truncate text-sm font-medium"
										:class="isSelected(t.id) ? 'text-primary' : 'text-highlighted'"
									>
										{{ t.name }}
									</div>
									<div v-if="t.description" class="truncate text-xs text-muted">
										{{ t.description }}
									</div>
								</div>
							</button>
						</li>
					</ul>
				</div>
			</template>

			<ul v-else class="flex flex-col gap-1">
				<li v-for="t in visibleTypes" :key="t.id">
					<button
						type="button"
						class="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors"
						:class="itemClass(t.id)"
						@click="select(t.id)"
					>
						<UIcon
							v-if="t.icon"
							:name="t.icon"
							class="mt-0.5 size-4 shrink-0"
							:class="isSelected(t.id) ? 'text-primary' : 'text-dimmed'"
						/>
						<div class="min-w-0 flex-1">
							<div
								class="truncate text-sm font-medium"
								:class="isSelected(t.id) ? 'text-primary' : 'text-highlighted'"
							>
								{{ t.name }}
							</div>
							<div v-if="t.description" class="truncate text-xs text-muted">
								{{ t.description }}
							</div>
						</div>
					</button>
				</li>
			</ul>
		</div>
	</DmsCard>
</template>
