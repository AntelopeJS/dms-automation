<script setup lang="ts">
import { computed } from 'vue'

// The properties of a JSON schema as a typed table: name, type (with its enum
// values or default), description. Used for a type's settings, inputs and
// outputs in the library.

interface JsonSchemaProperty {
	type?: string | string[]
	title?: string
	description?: string
	enum?: unknown[]
	default?: unknown
	format?: string
}

const props = defineProps<{
	schema?: { properties?: Record<string, JsonSchemaProperty>; required?: string[] } | null
	emptyLabel?: string
}>()

const { processI18n } = useTranslation()

const rows = computed(() => {
	const required = new Set(props.schema?.required ?? [])
	return Object.entries(props.schema?.properties ?? {}).map(([name, p]) => {
		const type = Array.isArray(p.type) ? p.type.join(' | ') : (p.type ?? (p.enum ? 'enum' : 'any'))
		const details: string[] = []
		if (p.enum) details.push(p.enum.map(String).join(' · '))
		if (p.default !== undefined && p.default !== '') details.push(`default ${JSON.stringify(p.default)}`)
		return {
			name,
			type: p.format ? `${type} (${p.format})` : type,
			required: required.has(name),
			description: [p.title, p.description].filter(Boolean).map((t) => processI18n(String(t))).join(' — '),
			details: details.join(', '),
		}
	})
})
</script>

<template>
	<div v-if="rows.length" class="overflow-hidden rounded-md border border-default">
		<table class="w-full text-left text-xs">
			<thead class="bg-elevated/60 font-mono text-[10.5px] text-dimmed uppercase">
				<tr>
					<th class="px-3 py-1.5 font-normal">{{ $t('dms_automation.library.schema.name') }}</th>
					<th class="px-3 py-1.5 font-normal">{{ $t('dms_automation.library.schema.type') }}</th>
					<th class="px-3 py-1.5 font-normal">{{ $t('dms_automation.library.schema.description') }}</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-default">
				<tr v-for="row in rows" :key="row.name">
					<td class="px-3 py-1.5 font-mono text-highlighted">{{ row.name }}</td>
					<td class="px-3 py-1.5 font-mono text-muted">
						{{ row.type }}
						<span v-if="row.required" class="text-warning">· {{ $t('dms_automation.library.schema.required') }}</span>
					</td>
					<td class="px-3 py-1.5 text-toned">
						{{ row.description }}
						<span v-if="row.details" class="block font-mono text-[11px] text-dimmed">{{ row.details }}</span>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
	<p v-else class="text-xs text-dimmed">{{ emptyLabel ?? $t('dms_automation.library.schema.none') }}</p>
</template>
