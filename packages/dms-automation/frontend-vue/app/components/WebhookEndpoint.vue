<script lang="ts">
interface WebhookBase {
	url: string
	configured: boolean
}

// Every endpoint shown is on the same origin: it is asked for once.
let baseRequest: Promise<WebhookBase | null> | undefined
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

// The full URL a webhook trigger is called on — the API server's public
// origin and the trigger's path — with a copy button, and a curl example.
// `compact` keeps the URL and its copy button only, for a line in a list.
// Until the origin is known, or if it can't be, no URL is offered to copy:
// the path alone would be a wrong address to hand to another service.

const props = withDefaults(
	defineProps<{
		path: string
		method?: string
		apiUrl?: string
		compact?: boolean
	}>(),
	{ method: 'POST', apiUrl: '/api/automation', compact: false },
)

const { $authFetch } = useAuthFetch()

const base = ref<WebhookBase | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')

onMounted(async () => {
	baseRequest ??= $authFetch<WebhookBase>(`${props.apiUrl}/library/webhook-base`).catch(() => {
		baseRequest = undefined
		return null
	})
	base.value = await baseRequest
	status.value = base.value ? 'ready' : 'error'
})

const url = computed(() => `${base.value?.url ?? ''}${props.path}`)
const method = computed(() => (props.method || 'POST').toUpperCase())

const curl = computed(() => {
	if (method.value === 'GET') return `curl '${url.value}'`
	if (method.value === 'DELETE') return `curl -X DELETE '${url.value}'`
	return [`curl -X ${method.value} '${url.value}'`, `  -H 'content-type: application/json'`, `  -d '{}'`].join(' \\\n')
})
</script>

<template>
	<span v-if="compact" class="flex min-w-0 items-center gap-1">
		<span class="min-w-0 truncate font-mono text-xs text-muted" :title="status === 'ready' ? url : undefined">
			{{ method }} {{ status === 'ready' ? url : path }}
		</span>
		<DmsCopyButton v-if="status === 'ready'" :value="url" />
		<UIcon v-else-if="status === 'loading'" name="i-ph-circle-notch" class="size-3.5 shrink-0 animate-spin text-dimmed" :aria-label="$t('dms_automation.library.webhookLoading')" />
		<UTooltip v-else :text="$t('dms_automation.library.webhookBaseError')">
			<UIcon name="i-ph-warning" class="size-3.5 shrink-0 text-warning" :aria-label="$t('dms_automation.library.webhookBaseError')" />
		</UTooltip>
	</span>
	<div v-else class="flex flex-col gap-2">
		<p class="text-xs text-muted">{{ $t('dms_automation.library.webhook.hint') }}</p>
		<template v-if="status === 'ready'">
			<div class="flex min-w-0 items-center gap-2 rounded-md border border-default bg-elevated/40 py-1 ps-2.5 pe-1">
				<UBadge size="sm" color="neutral" variant="subtle" class="font-mono">{{ method }}</UBadge>
				<span class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted" :title="url">{{ url }}</span>
				<DmsCopyButton :value="url" />
			</div>
			<DmsCodeSnippet :code="curl" language="shell" :title="$t('dms_automation.library.webhook.example')" wrap />
			<p v-if="!base?.configured" class="text-[11px] text-dimmed">
				{{ $t('dms_automation.library.webhook.unconfigured') }}
			</p>
		</template>
		<USkeleton v-else-if="status === 'loading'" class="h-9 w-full" :aria-label="$t('dms_automation.library.webhookLoading')" />
		<p v-else class="text-xs text-warning">{{ $t('dms_automation.library.webhookBaseError') }}</p>
	</div>
</template>
