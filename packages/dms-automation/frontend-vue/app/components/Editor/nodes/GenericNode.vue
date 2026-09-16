<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

interface PortRef {
	name: string
	type?: string
}

interface NodeData {
	label?: string
	icon?: string
	/** Small uppercase badge in the top-right of the header (data nodes). */
	category?: string
	/** Render the trigger-in handle on the header's left. Default true. */
	hasTriggerIn?: boolean
	/** Render the trigger-out `main` handle on the header's right. Default true. */
	hasMainTriggerOut?: boolean
	/**
	 * Non-main trigger-out ports. Rendered as body rows top-to-bottom,
	 * paired with `dataIns` left-to-right (per the asserted port
	 * convention: trigger ports first, no gap from data-ins on same row).
	 */
	triggerOuts?: string[]
	/** Data inputs. Left-aligned. Paired with trigger-outs / data-outs. */
	dataIns?: PortRef[]
	/** Data outputs. Right-aligned. Render below all trigger-outs. */
	dataOuts?: PortRef[]
}

const props = defineProps<{
	id: string
	data: NodeData
	selected?: boolean
}>()

const hasTriggerIn = computed(() => props.data?.hasTriggerIn !== false)
const hasMainTriggerOut = computed(() => props.data?.hasMainTriggerOut !== false)
const triggerOuts = computed<string[]>(() => props.data?.triggerOuts ?? [])
const dataIns = computed<PortRef[]>(() => props.data?.dataIns ?? [])
const dataOuts = computed<PortRef[]>(() => props.data?.dataOuts ?? [])

import { dataStyle, triggerStyle } from './styles'

interface BodyRow {
	leftDataIn?: PortRef
	rightTriggerOut?: string
	rightDataOut?: PortRef
}

// Body layout (per the convention):
//   Phase 1: each trigger-out, top-to-bottom, paired with the next available
//            data-in on the same row (left-aligned). No gap.
//   Phase 2: data-outs (and any leftover data-ins) row-by-row, action-style
//            (input[i] left, output[i] right), filling remaining space.
const rows = computed<BodyRow[]>(() => {
	const r: BodyRow[] = []
	const ti = [...triggerOuts.value]
	const di = [...dataIns.value]
	const dout = [...dataOuts.value]

	// Phase 1
	while (ti.length > 0) {
		r.push({
			leftDataIn: di.shift(),
			rightTriggerOut: ti.shift(),
		})
	}

	// Phase 2 — pair any leftover data-ins with data-outs.
	const remaining = Math.max(di.length, dout.length)
	for (let i = 0; i < remaining; i++) {
		r.push({ leftDataIn: di[i], rightDataOut: dout[i] })
	}

	return r
})
</script>

<template>
	<div
		class="dms-automation-node generic-node relative min-w-[180px] rounded-lg border bg-default shadow-sm"
		:class="
			selected
				? 'border-primary ring-1 ring-primary'
				: 'border-default'
		"
	>
		<div
			class="relative flex items-center gap-2 rounded-t-lg border-b border-default bg-elevated px-3 py-2"
		>
			<Handle
				v-if="hasTriggerIn"
				id="trigger-in"
				type="target"
				:position="Position.Left"
				:style="triggerStyle"
			/>
			<UIcon
				:name="data.icon || 'i-ph-circle'"
				class="size-4 text-primary"
			/>
			<div class="truncate text-sm font-medium text-highlighted">
				{{ data.label || 'Node' }}
			</div>
			<div
				v-if="data.category"
				class="ml-auto text-[10px] uppercase text-dimmed"
			>
				{{ data.category }}
			</div>
			<Handle
				v-if="hasMainTriggerOut"
				id="trigger-out-main"
				type="source"
				:position="Position.Right"
				:style="triggerStyle"
			/>
		</div>

		<div v-if="rows.length > 0" class="py-2 text-xs text-dimmed">
			<div
				v-for="(row, i) in rows"
				:key="i"
				class="relative flex items-stretch py-1"
			>
				<div class="flex-1 flex items-center gap-1 pl-3">
					<template v-if="row.leftDataIn">
						<Handle
							:id="`data-in-${row.leftDataIn.name}`"
							type="target"
							:position="Position.Left"
							:style="dataStyle"
						/>
						<span>{{ row.leftDataIn.name }}</span>
					</template>
				</div>
				<div class="flex-1 flex items-center justify-end gap-1 pr-3">
					<template v-if="row.rightTriggerOut">
						<span>{{ row.rightTriggerOut }}</span>
						<Handle
							:id="`trigger-out-${row.rightTriggerOut}`"
							type="source"
							:position="Position.Right"
							:style="triggerStyle"
						/>
					</template>
					<template v-else-if="row.rightDataOut">
						<span>{{ row.rightDataOut.name }}</span>
						<Handle
							:id="`data-out-${row.rightDataOut.name}`"
							type="source"
							:position="Position.Right"
							:style="dataStyle"
						/>
					</template>
				</div>
			</div>
		</div>
	</div>
</template>
