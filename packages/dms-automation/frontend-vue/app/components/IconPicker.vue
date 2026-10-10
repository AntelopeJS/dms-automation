<script setup lang="ts">
import { computed, ref } from 'vue'

// A grid of icons to pick from, with a search, in place of typing an Iconify
// name. "More…" keeps the free text for an icon outside the grid.

const ICONS = [
	'i-ph-package', 'i-ph-stack', 'i-ph-flow-arrow', 'i-ph-lightning', 'i-ph-webhooks-logo',
	'i-ph-clock', 'i-ph-calendar', 'i-ph-envelope', 'i-ph-paper-plane-tilt', 'i-ph-bell',
	'i-ph-chat-circle', 'i-ph-database', 'i-ph-cloud-arrow-up', 'i-ph-globe', 'i-ph-plugs',
	'i-ph-arrows-clockwise', 'i-ph-shield-check', 'i-ph-warning', 'i-ph-bug', 'i-ph-receipt',
	'i-ph-invoice', 'i-ph-credit-card', 'i-ph-shopping-cart', 'i-ph-user', 'i-ph-users',
	'i-ph-file-text', 'i-ph-table', 'i-ph-chart-bar', 'i-ph-funnel', 'i-ph-magic-wand',
	'i-ph-robot', 'i-ph-gear', 'i-ph-key', 'i-ph-lock', 'i-ph-map-pin', 'i-ph-truck',
]

const model = defineModel<string>({ default: 'i-ph-package' })

const query = ref('')
const custom = ref(false)

const visible = computed(() => {
	const q = query.value.trim().toLowerCase()
	return q ? ICONS.filter((icon) => icon.includes(q)) : ICONS
})

function label(icon: string): string {
	return icon.replace(/^i-ph-/, '').replace(/-/g, ' ')
}
</script>

<template>
	<div class="flex flex-col gap-2">
		<div class="flex items-center gap-2">
			<UInput v-model="query" size="sm" icon="i-ph-magnifying-glass" :placeholder="$t('dms_automation.iconPicker.search')" class="flex-1" />
			<UButton size="sm" variant="ghost" color="neutral" @click="custom = !custom">
				{{ $t('dms_automation.iconPicker.more') }}
			</UButton>
		</div>
		<div class="grid grid-cols-9 gap-1" role="listbox" :aria-label="$t('dms_automation.iconPicker.label')">
			<UTooltip v-for="icon in visible" :key="icon" :text="label(icon)">
				<button
					type="button"
					role="option"
					:aria-selected="model === icon"
					:aria-label="label(icon)"
					class="grid size-8 place-items-center rounded-md border transition-colors"
					:class="model === icon ? 'border-primary bg-primary/10 text-primary' : 'border-default text-muted hover:bg-elevated'"
					@click="model = icon"
				>
					<UIcon :name="icon" class="size-4" />
				</button>
			</UTooltip>
		</div>
		<UInput v-if="custom" v-model="model" size="sm" placeholder="i-ph-package" class="font-mono" />
	</div>
</template>
