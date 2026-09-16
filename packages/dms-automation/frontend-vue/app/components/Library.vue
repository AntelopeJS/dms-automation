<script setup lang="ts">
import { computed, ref } from 'vue'

// The Library consolidates the former Triggers / Actions / Data Nodes /
// Templates pages into one tabbed page (per autov2-library). Each tab mounts
// the existing catalog component in `embedded` mode so it drops its own
// page-head — the Library owns the single page-head above the tabs.
type Tab = 'triggers' | 'actions' | 'dataNodes' | 'templates'

const { t } = useI18n()
const tab = ref<Tab>('triggers')

const tabs = computed<
	ReadonlyArray<{ value: Tab; label: string; icon: string }>
>(() => [
	{ value: 'triggers', label: t('dms_automation.library.tabs.triggers'), icon: 'i-ph-lightning' },
	{ value: 'actions', label: t('dms_automation.library.tabs.actions'), icon: 'i-ph-gear' },
	{ value: 'dataNodes', label: t('dms_automation.library.tabs.dataNodes'), icon: 'i-ph-cube' },
	{ value: 'templates', label: t('dms_automation.library.tabs.templates'), icon: 'i-ph-package' },
])
</script>

<template>
	<!--
		Title / icon / description come from the page's native dms header
		(src/pages/library.ts), so this component starts at its tabs.
	-->
	<div class="flex flex-col gap-5">
		<!-- Tabs -->
		<div class="border-b border-default">
			<div class="flex flex-wrap items-center gap-1">
				<button
					v-for="item in tabs"
					:key="item.value"
					type="button"
					class="-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors"
					:class="
						tab === item.value
							? 'border-primary text-primary'
							: 'border-transparent text-muted hover:text-highlighted'
					"
					@click="tab = item.value"
				>
					<UIcon :name="item.icon" class="size-4" />
					{{ item.label }}
				</button>
			</div>
		</div>

		<!-- Panels (catalog components, page-head suppressed via `embedded`).
		     Wrapped in Suspense because the catalog components use top-level
		     await (async setup); the local boundary also gives a skeleton while
		     a freshly-switched tab loads its data. -->
		<Suspense>
			<DmsAutomationTriggers v-if="tab === 'triggers'" embedded />
			<DmsAutomationActions v-else-if="tab === 'actions'" embedded />
			<DmsAutomationDataNodes v-else-if="tab === 'dataNodes'" embedded />
			<DmsAutomationTemplates v-else embedded />
			<template #fallback>
				<div class="flex flex-col gap-3">
					<USkeleton class="h-9 w-64" />
					<USkeleton class="h-64 w-full" />
				</div>
			</template>
		</Suspense>
	</div>
</template>
