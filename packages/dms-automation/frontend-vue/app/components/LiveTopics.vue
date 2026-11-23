<script setup lang="ts">
import { toRef } from 'vue'

const props = defineProps<{
	realtimeTopic: string[]
}>()

const topics = toRef(props, 'realtimeTopic')

for (const topic of topics.value) {
	useRealtimeTopic(topic, (event) => {
		if ('type' in event) refreshLivePageBlocks()
	})
}
</script>

<template>
	<span hidden />
</template>
