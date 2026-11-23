<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
	NodeKind,
	TriggerType,
	ActionType,
	DataNodeType,
} from '../../composables/useGraphConnect'
import { PALETTE_DRAG_TYPE, type NodeKindEntry, type NodeKindUI, type PaletteBlock, type TemplateSummary } from '../../composables/useAutomationNodeKinds'

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

const { processI18n } = useTranslation()
const i18n = useI18n()
const { t } = i18n
const te = (key: string) => i18n.te(key)

interface PaletteItem {
	key: string
	label: string
	icon: string
	kind?: NodeKind
	typeId?: string
	template?: TemplateSummary
	/** Data category of a data node. */
	category?: string
	/** Switched off in the Library: its steps fail when they run. */
	off?: boolean
	/** Lower-cased text the search looks in. */
	keywords: string
}
interface PaletteSection {
	/** Sub-header: a data category, or the id of the module that registered the types. */
	label?: string
	module?: boolean
	items: PaletteItem[]
}
interface UiKind {
	entry: NodeKindEntry
	ui: NodeKindUI
}
interface PaletteGroup {
	key: string
	label: string
	icon: string
	sections: PaletteSection[]
}

const CATEGORY_ORDER = ['trigger', 'action', 'flow', 'helper', 'data'] as const
const CATEGORY_LABEL = {
	trigger: '$dms_automation.builder.palette.groups.trigger',
	action: '$dms_automation.builder.palette.groups.action',
	flow: '$dms_automation.builder.palette.groups.flow',
	helper: '$dms_automation.builder.palette.groups.helper',
	data: '$dms_automation.builder.palette.groups.data',
} satisfies Record<(typeof CATEGORY_ORDER)[number], string>
const CATEGORY_ICON = {
	trigger: 'i-ph-lightning',
	action: 'i-ph-gear',
	flow: 'i-ph-git-fork',
	helper: 'i-ph-toolbox',
	data: 'i-ph-function',
} satisfies Record<(typeof CATEGORY_ORDER)[number], string>

const BUILTIN_BUCKET = ''

const DATA_CATEGORY_ORDER = ['constant', 'math', 'compare', 'boolean', 'string', 'object', 'json']

function dataCategoryLabel(category: string): string {
	const key = `dms_automation.types.dataCategories.${category}`
	return te(key) ? t(key) : category
}

function keywordsOf(...parts: Array<string | undefined>): string {
	return parts.filter(Boolean).join(' ').toLowerCase()
}

function dataSections(items: PaletteItem[]): PaletteSection[] {
	const rank = (c: string) => {
		const i = DATA_CATEGORY_ORDER.indexOf(c)
		return i === -1 ? DATA_CATEGORY_ORDER.length : i
	}
	const categories = [...new Set(items.map((it) => it.category ?? ''))].sort(
		(a, b) => rank(a) - rank(b) || a.localeCompare(b),
	)
	return categories.map((category) => ({
		label: dataCategoryLabel(category),
		items: items.filter((it) => (it.category ?? '') === category),
	}))
}

type BucketedItem = [bucket: string, item: PaletteItem]

function kindsByCategoryOf(nodeKinds: NodeKindEntry[]): Map<string, UiKind[]> {
	const byCategory = new Map<string, UiKind[]>()
	for (const entry of nodeKinds) {
		const ui = entry.meta.ui
		const cat = ui?.category
		if (!ui || !cat) continue
		const arr = byCategory.get(cat) ?? []
		arr.push({ entry, ui })
		byCategory.set(cat, arr)
	}
	return byCategory
}

function typeItems(kind: string, types: Array<TriggerType | ActionType>, groupIcon: string): BucketedItem[] {
	return types.map((type) => {
		const label = processI18n(type.name)
		return [
			type.module ?? BUILTIN_BUCKET,
			{
				key: `${kind}:${type.id}`,
				label,
				icon: type.icon ?? groupIcon,
				kind,
				typeId: type.id,
				off: type.enabled === false,
				keywords: keywordsOf(label, type.id, type.description && processI18n(type.description), type.module),
			},
		]
	})
}

function dataNodeItems(kind: string, types: DataNodeType[], groupIcon: string): BucketedItem[] {
	return types.map((d) => {
		const label = processI18n(d.name)
		return [
			d.module ?? BUILTIN_BUCKET,
			{
				key: `${kind}:${d.id}`,
				label,
				icon: d.icon ?? groupIcon,
				kind,
				typeId: d.id,
				category: d.category,
				keywords: keywordsOf(label, d.id, d.category, dataCategoryLabel(d.category), processI18n(d.description), d.module),
			},
		]
	})
}

function itemsOfKind({ entry, ui }: UiKind, groupIcon: string): BucketedItem[] {
	const reg = ui.typeRegistry
	if (reg === 'triggers') return typeItems(entry.kind, props.triggerTypes ?? [], groupIcon)
	if (reg === 'actions') return typeItems(entry.kind, props.actionTypes ?? [], groupIcon)
	if (reg === 'dataNodes') return dataNodeItems(entry.kind, props.dataNodeTypes ?? [], groupIcon)
	const label = processI18n(ui.label)
	return [[BUILTIN_BUCKET, { key: entry.kind, label, icon: ui.icon ?? groupIcon, kind: entry.kind, keywords: keywordsOf(label, entry.kind) }]]
}

function sectionsOf(cat: string, kinds: UiKind[], groupIcon: string): PaletteSection[] {
	const byModule = new Map<string, PaletteItem[]>()
	for (const [bucket, item] of kinds.flatMap((kind) => itemsOfKind(kind, groupIcon))) {
		const arr = byModule.get(bucket) ?? []
		arr.push(item)
		byModule.set(bucket, arr)
	}

	const sections: PaletteSection[] = []
	const builtins = byModule.get(BUILTIN_BUCKET)
	if (builtins && builtins.length > 0) {
		if (cat === 'data') sections.push(...dataSections(builtins))
		else sections.push({ items: builtins })
	}
	const externalModules = [...byModule.keys()]
		.filter((m) => m !== BUILTIN_BUCKET)
		.sort()
	for (const mod of externalModules) {
		sections.push({ label: mod, module: true, items: byModule.get(mod) ?? [] })
	}
	return sections
}

function templatesGroup(templates: TemplateSummary[]): PaletteGroup {
	return {
		key: 'templates',
		label: processI18n('$dms_automation.builder.palette.groups.templates'),
		icon: 'i-ph-package',
		sections: [
			{
				items: templates.map((tpl) => {
					const label = tpl.name.trim() || t('dms_automation.builder.palette.untitledTemplate')
					return { key: `tpl:${tpl._id}`, label, icon: tpl.icon ?? 'i-ph-package', template: tpl, keywords: keywordsOf(label) }
				}),
			},
		],
	}
}

const groups = computed<PaletteGroup[]>(() => {
	const out: PaletteGroup[] = []
	const byCategory = kindsByCategoryOf(props.nodeKinds ?? [])

	for (const cat of CATEGORY_ORDER) {
		const kinds = byCategory.get(cat)
		if (!kinds || kinds.length === 0) continue
		const groupIcon = CATEGORY_ICON[cat]
		const sections = sectionsOf(cat, kinds, groupIcon)
		if (sections.length > 0) out.push({ key: cat, label: processI18n(CATEGORY_LABEL[cat]), icon: groupIcon, sections })
	}

	if (props.templates && props.templates.length > 0) out.push(templatesGroup(props.templates))

	return out
})

const filteredGroups = computed<PaletteGroup[]>(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return groups.value
	return groups.value
		.map((g) => ({
			...g,
			sections: g.sections
				.map((s) => ({ ...s, items: s.items.filter((it) => it.keywords.includes(q)) }))
				.filter((s) => s.items.length > 0),
		}))
		.filter((g) => g.sections.length > 0)
})

function onItem(item: PaletteItem) {
	if (item.template) emit('add-template', item.template)
	else if (item.kind) emit('add-node', { kind: item.kind, typeId: item.typeId })
}

function onDragStart(event: DragEvent, item: PaletteItem) {
	if (!event.dataTransfer) return
	const block: PaletteBlock = item.template ? { template: item.template } : { kind: item.kind, typeId: item.typeId }
	event.dataTransfer.setData(PALETTE_DRAG_TYPE, JSON.stringify(block))
	event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
	<div
		class="flex h-full flex-col overflow-hidden bg-elevated/40"
	>
		<div class="border-b border-default p-2.5">
			<DmsSearchInput
				v-model="search"
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
					<span class="ml-1 text-dimmed/70">{{ group.sections.reduce((n, s) => n + s.items.length, 0) }}</span>
				</div>
				<template v-for="section in group.sections" :key="section.label ?? ''">
					<div
						v-if="section.label"
						class="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-dimmed"
					>
						<UIcon v-if="section.module" name="i-ph-puzzle-piece" class="size-3 shrink-0" />
						<span class="truncate">{{ section.label }}</span>
					</div>
					<button
						v-for="item in section.items"
						:key="item.key"
						type="button"
						draggable="true"
						:title="item.off ? $t('dms_automation.builder.palette.offHint') : undefined"
						class="group flex w-full cursor-grab items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm text-toned transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-highlighted"
						@click="onItem(item)"
						@dragstart="onDragStart($event, item)"
					>
						<UIcon :name="item.icon" class="size-4 shrink-0" :class="item.off ? 'text-dimmed' : 'text-primary'" />
						<span class="min-w-0 flex-1 truncate" :class="{ 'text-dimmed': item.off }">{{ item.label }}</span>
						<UBadge v-if="item.off" size="sm" color="neutral" variant="subtle">{{ $t('dms_automation.builder.palette.off') }}</UBadge>
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
		<p class="border-t border-default px-3 py-2 text-[11px] text-dimmed">
			{{ $t('dms_automation.builder.palette.hintDrag') }}
		</p>
	</div>
</template>
