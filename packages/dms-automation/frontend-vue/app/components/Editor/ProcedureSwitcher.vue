<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// ⌘P: jump to another procedure, by name, with its state; or create one.

export interface ProcedureSummaryRow {
	procedureId: string
	name: string
	description: string
	status: 'failing' | 'degraded' | 'healthy' | 'paused' | 'draft'
}

const props = defineProps<{
	procedures: ProcedureSummaryRow[]
	currentId: string | null
	proceduresUrl: string
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
	(e: 'pick', id: string): void
	(e: 'create'): void
}>()

const STATE_TONES = {
	failing: 'error',
	degraded: 'warning',
	healthy: 'success',
	paused: 'neutral',
	draft: 'info',
} as const

const query = ref('')
const active = ref(0)

const visible = computed(() => {
	const q = query.value.trim().toLowerCase()
	return props.procedures.filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
})

watch(open, (isOpen) => {
	if (isOpen) {
		query.value = ''
		active.value = 0
	}
})
watch(query, () => (active.value = 0))

// The pick is announced once the switcher has closed: the builder may open
// its "Save changes?" dialog in answer, which a closing modal would dismiss.
let pending: (() => void) | null = null

function pick(id: string) {
	if (id !== props.currentId) pending = () => emit('pick', id)
	open.value = false
}

function create() {
	pending = () => emit('create')
	open.value = false
}

function afterLeave() {
	const action = pending
	pending = null
	action?.()
}

function onKey(ev: KeyboardEvent) {
	if (ev.key === 'ArrowDown') {
		ev.preventDefault()
		active.value = Math.min(active.value + 1, visible.value.length - 1)
	} else if (ev.key === 'ArrowUp') {
		ev.preventDefault()
		active.value = Math.max(active.value - 1, 0)
	} else if (ev.key === 'Enter') {
		const row = visible.value[active.value]
		if (row) pick(row.procedureId)
	}
}
</script>

<template>
	<UModal v-model:open="open" :title="$t('dms_automation.editor.switcher.title')" :ui="{ content: 'max-w-lg' }" @after:leave="afterLeave">
		<template #body>
			<div class="flex flex-col gap-2" @keydown="onKey">
				<UInput
					v-model="query"
					autofocus
					icon="i-ph-magnifying-glass"
					:placeholder="$t('dms_automation.editor.switcher.search')"
					class="w-full"
				/>
				<ul class="flex max-h-80 flex-col overflow-y-auto" role="listbox">
					<li v-for="(row, index) in visible" :key="row.procedureId">
						<button
							type="button"
							role="option"
							:aria-selected="index === active"
							class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left"
							:class="index === active ? 'bg-elevated' : 'hover:bg-elevated/60'"
							@mouseenter="active = index"
							@click="pick(row.procedureId)"
						>
							<DmsStatusPill :tone="STATE_TONES[row.status]" :label="$t(`dms_automation.procedures.status.${row.status}`)" size="sm" />
							<span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ row.name }}</span>
							<UBadge v-if="row.procedureId === currentId" size="sm" variant="subtle" color="neutral">
								{{ $t('dms_automation.editor.switcher.current') }}
							</UBadge>
						</button>
					</li>
				</ul>
				<p v-if="visible.length === 0" class="py-4 text-center text-xs text-dimmed">{{ $t('dms_automation.editor.switcher.none') }}</p>
			</div>
		</template>
		<template #footer>
			<div class="flex w-full items-center justify-between gap-2">
				<UButton variant="ghost" color="neutral" size="sm" :to="proceduresUrl" @click="open = false">
					{{ $t('dms_automation.editor.switcher.all', { count: procedures.length }) }}
				</UButton>
				<UButton color="primary" size="sm" icon="i-ph-plus" @click="create">
					{{ $t('dms_automation.newProcedure.title') }}
				</UButton>
			</div>
		</template>
	</UModal>
</template>
