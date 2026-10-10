<script setup lang="ts">
import { computed } from 'vue'
import type { GraphLite, TraceStep } from '../../composables/useAutomationRuns'

// The procedure's graph in miniature, the path the run took drawn over it:
// steps that ran in green, the failing one in red, the rest greyed. Data nodes
// are left out: they are evaluated on demand and never "on a path".

const props = defineProps<{
	graph: GraphLite | null
	steps: TraceStep[]
	failedNodeId?: string | null
}>()

const NODE_W = 120
const NODE_H = 28
const PAD = 16
// Positions are drawn closer than on the canvas, so the boxes stay readable
// once the graph is scaled down to the card.
const POS_SCALE = 0.55
// A small graph is drawn at most this much larger than its own size.
const MAX_UPSCALE = 1.2
const HIDDEN_KINDS = new Set(['data', 'groupInput', 'groupOutput'])

const topLevel = (id: string) => id.split('__')[0] ?? id

const ran = computed(() => new Set(props.steps.map((s) => topLevel(s.nodeId))))
const failed = computed(() => (props.failedNodeId ? topLevel(props.failedNodeId) : null))

const nodes = computed(() =>
	(props.graph?.nodes ?? [])
		.filter((n) => !HIDDEN_KINDS.has(n.kind))
		.map((n) => ({ ...n, position: { x: n.position.x * POS_SCALE, y: n.position.y * POS_SCALE } })),
)

const box = computed(() => {
	const xs = nodes.value.map((n) => n.position.x)
	const ys = nodes.value.map((n) => n.position.y)
	const minX = Math.min(...xs, 0)
	const minY = Math.min(...ys, 0)
	const maxX = Math.max(...xs, 0) + NODE_W
	const maxY = Math.max(...ys, 0) + NODE_H
	return { minX: minX - PAD, minY: minY - PAD, width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 }
})

const byId = computed(() => new Map(nodes.value.map((n) => [n.id, n])))

const edges = computed(() =>
	(props.graph?.triggerEdges ?? [])
		.map((e) => ({ id: e.id, from: byId.value.get(e.from.node), to: byId.value.get(e.to.node) }))
		.filter((e) => e.from && e.to)
		.map((e) => ({
			id: e.id,
			x1: e.from!.position.x + NODE_W,
			y1: e.from!.position.y + NODE_H / 2,
			x2: e.to!.position.x,
			y2: e.to!.position.y + NODE_H / 2,
			taken: ran.value.has(e.from!.id) && ran.value.has(e.to!.id),
			failing: e.to!.id === failed.value,
		})),
)

function stateOf(id: string): 'failed' | 'ran' | 'idle' {
	if (id === failed.value) return 'failed'
	return ran.value.has(id) ? 'ran' : 'idle'
}

const FILL = { failed: 'var(--ui-error)', ran: 'var(--ui-success)', idle: 'var(--ui-border)' } as const

const namesById = computed(() => new Map(props.steps.map((s) => [s.nodeId, s.name])))
const { processI18n } = useTranslation()

function labelOf(node: GraphLite['nodes'][number]): string {
	const name = namesById.value.get(node.id)
	const label = node.label ?? (name?.typeName ? processI18n(name.typeName) : undefined) ?? node.typeId ?? node.kind
	return label.length > 16 ? `${label.slice(0, 15)}…` : label
}
</script>

<template>
	<div class="overflow-hidden rounded-md border border-default bg-elevated/40">
		<svg
			v-if="nodes.length"
			:viewBox="`${box.minX} ${box.minY} ${box.width} ${box.height}`"
			class="mx-auto block max-h-56 w-full"
			:style="{ maxWidth: `${box.width * MAX_UPSCALE}px` }"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			:aria-label="$t('dms_automation.trace.pathTaken')"
		>
			<path
				v-for="edge in edges"
				:key="edge.id"
				:d="`M ${edge.x1} ${edge.y1} C ${edge.x1 + 40} ${edge.y1}, ${edge.x2 - 40} ${edge.y2}, ${edge.x2} ${edge.y2}`"
				fill="none"
				:stroke="edge.failing && edge.taken ? 'var(--ui-error)' : edge.taken ? 'var(--ui-success)' : 'var(--ui-border-accented)'"
				:stroke-width="edge.taken ? 2.5 : 1.5"
				:stroke-dasharray="edge.taken ? undefined : '4 4'"
			/>
			<g v-for="node in nodes" :key="node.id">
				<rect
					:x="node.position.x"
					:y="node.position.y"
					:width="NODE_W"
					:height="NODE_H"
					rx="6"
					fill="var(--ui-bg)"
					:stroke="FILL[stateOf(node.id)]"
					:stroke-width="stateOf(node.id) === 'idle' ? 1 : 2"
					:opacity="stateOf(node.id) === 'idle' ? 0.6 : 1"
				/>
				<circle :cx="node.position.x + 12" :cy="node.position.y + NODE_H / 2" r="4" :fill="FILL[stateOf(node.id)]" />
				<text
					:x="node.position.x + 22"
					:y="node.position.y + NODE_H / 2 + 4"
					font-size="11"
					fill="var(--ui-text-toned)"
				>
					{{ labelOf(node) }}
				</text>
			</g>
		</svg>
		<p v-else class="p-4 text-center text-xs text-dimmed">{{ $t('dms_automation.trace.noGraph') }}</p>
	</div>
</template>
