<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
	NodeKind,
	TriggerType,
	ActionType,
	DataNodeType,
	GroupPort,
} from '../../composables/useGraphConnect'
import type { NodeKindEntry } from '../../composables/useAutomationNodeKinds'

interface TemplateSummary {
	_id: string
	name: string
	icon?: string
	ports: GroupPort[]
}

const props = defineProps<{
	nodeKinds: NodeKindEntry[]
	triggerTypes: TriggerType[]
	actionTypes: ActionType[]
	dataNodeTypes: DataNodeType[]
	templates?: TemplateSummary[]
}>()

const emit = defineEmits<{
	(e: 'add-node', payload: { kind: NodeKind; typeId?: string }): void
	(e: 'add-template', template: TemplateSummary): void
}>()

const search = ref('')

interface PaletteItem {
	key: string
	label: string
	icon: string
	kind?: NodeKind
	typeId?: string
	template?: TemplateSummary
}
// Items inside a category are bucketed by the module that registered them:
// one unlabeled leading section for our own built-ins (types the backend left
// unattributed, plus plain node kinds), then one labeled section per external
// module.
interface PaletteSection {
	/** Module id shown as a sub-header; undefined for the built-in section. */
	label?: string
	items: PaletteItem[]
}
interface PaletteGroup {
	key: string
	label: string
	icon: string
	sections: PaletteSection[]
}

// Same category ordering / labels / icons the old "Add node" dropdown used —
// reproduced here as a grouped, searchable left sidebar per autov2-builder.
const CATEGORY_ORDER = ['trigger', 'action', 'flow', 'helper', 'data'] as const
const CATEGORY_LABEL: Record<string, string> = {
	trigger: 'Triggers',
	action: 'Actions',
	flow: 'Flow',
	helper: 'Helpers',
	data: 'Data',
}
const CATEGORY_ICON: Record<string, string> = {
	trigger: 'i-ph-lightning',
	action: 'i-ph-gear',
	flow: 'i-ph-git-fork',
	helper: 'i-ph-toolbox',
	data: 'i-ph-function',
}

// Bucket key for the unlabeled built-in section. The backend omits `module`
// for our own types and for any it couldn't attribute, so both land here
// rather than under an invented "unknown" sub-header.
const BUILTIN_BUCKET = ''

const groups = computed<PaletteGroup[]>(() => {
	const out: PaletteGroup[] = []

	const kindsByCategory = new Map<string, NodeKindEntry[]>()
	for (const k of props.nodeKinds ?? []) {
		const cat = k.meta.ui?.category
		if (!cat) continue
		const arr = kindsByCategory.get(cat) ?? []
		arr.push(k)
		kindsByCategory.set(cat, arr)
	}

	for (const cat of CATEGORY_ORDER) {
		const kinds = kindsByCategory.get(cat)
		if (!kinds || kinds.length === 0) continue
		const groupIcon = CATEGORY_ICON[cat] ?? 'i-ph-circle'
		const byModule = new Map<string, PaletteItem[]>()
		const push = (bucket: string, item: PaletteItem) => {
			const arr = byModule.get(bucket) ?? []
			arr.push(item)
			byModule.set(bucket, arr)
		}

		for (const k of kinds) {
			const ui = k.meta.ui!
			const reg = ui.typeRegistry
			if (reg === 'triggers') {
				for (const t of props.triggerTypes ?? []) {
					push(t.module ?? BUILTIN_BUCKET, { key: `${k.kind}:${t.id}`, label: t.name, icon: t.icon ?? groupIcon, kind: k.kind, typeId: t.id })
				}
			} else if (reg === 'actions') {
				for (const a of props.actionTypes ?? []) {
					push(a.module ?? BUILTIN_BUCKET, { key: `${k.kind}:${a.id}`, label: a.name, icon: a.icon ?? groupIcon, kind: k.kind, typeId: a.id })
				}
			} else if (reg === 'dataNodes') {
				// Flatten data-node sub-categories into the single "Data" group.
				for (const d of props.dataNodeTypes ?? []) {
					push(d.module ?? BUILTIN_BUCKET, { key: `${k.kind}:${d.id}`, label: d.name, icon: d.icon ?? groupIcon, kind: k.kind, typeId: d.id })
				}
			} else {
				// Plain node kinds (flow / helpers) are built into this module.
				push(BUILTIN_BUCKET, { key: k.kind, label: ui.label, icon: ui.icon ?? groupIcon, kind: k.kind })
			}
		}

		// Built-ins first (they're the defaults shipped with the module), then
		// one labeled section per external module, alphabetically.
		const sections: PaletteSection[] = []
		const builtins = byModule.get(BUILTIN_BUCKET)
		if (builtins && builtins.length > 0) sections.push({ items: builtins })
		const externalModules = [...byModule.keys()]
			.filter((m) => m !== BUILTIN_BUCKET)
			.sort()
		for (const mod of externalModules) {
			sections.push({ label: mod, items: byModule.get(mod)! })
		}

		if (sections.length > 0) out.push({ key: cat, label: CATEGORY_LABEL[cat] ?? cat, icon: groupIcon, sections })
	}

	if (props.templates && props.templates.length > 0) {
		out.push({
			key: 'templates',
			label: 'Templates',
			icon: 'i-ph-package',
			sections: [
				{
					items: props.templates.map((t) => ({
						key: `tpl:${t._id}`,
						label: t.name,
						icon: t.icon ?? 'i-ph-package',
						template: t,
					})),
				},
			],
		})
	}

	return out
})

const filteredGroups = computed<PaletteGroup[]>(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return groups.value
	return groups.value
		.map((g) => ({
			...g,
			sections: g.sections
				.map((s) => ({ ...s, items: s.items.filter((it) => it.label.toLowerCase().includes(q)) }))
				.filter((s) => s.items.length > 0),
		}))
		.filter((g) => g.sections.length > 0)
})

function onItem(item: PaletteItem) {
	if (item.template) emit('add-template', item.template)
	else if (item.kind) emit('add-node', { kind: item.kind, typeId: item.typeId })
}
</script>

<template>
	<div
		class="flex h-full flex-col overflow-hidden rounded-lg border border-default bg-elevated/40"
	>
		<div class="border-b border-default p-2.5">
			<UInput
				v-model="search"
				icon="i-ph-magnifying-glass"
				size="sm"
				:placeholder="$t('dms_automation.builder.palette.search')"
				class="w-full"
			/>
		</div>
		<div class="flex-1 overflow-y-auto p-2">
			<div v-for="group in filteredGroups" :key="group.key" class="mb-2 last:mb-0">
				<div
					class="px-2 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dimmed"
				>
					{{ group.label }}
				</div>
				<template v-for="section in group.sections" :key="section.label ?? ''">
					<div
						v-if="section.label"
						class="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-dimmed"
					>
						<UIcon name="i-ph-puzzle-piece" class="size-3 shrink-0" />
						<span class="truncate">{{ section.label }}</span>
					</div>
					<button
						v-for="item in section.items"
						:key="item.key"
						type="button"
						draggable="false"
						class="group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm text-toned transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-highlighted"
						@click="onItem(item)"
					>
						<UIcon :name="item.icon" class="size-4 shrink-0 text-primary" />
						<span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
						<UIcon
							name="i-ph-plus"
							class="size-3.5 shrink-0 text-dimmed opacity-0 transition-opacity group-hover:opacity-100"
						/>
					</button>
				</template>
			</div>
			<div
				v-if="filteredGroups.length === 0"
				class="px-2 py-6 text-center text-xs text-dimmed"
			>
				{{ $t('dms_automation.builder.palette.empty') }}
			</div>
		</div>
	</div>
</template>
