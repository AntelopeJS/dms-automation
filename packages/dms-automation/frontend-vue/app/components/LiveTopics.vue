<script setup lang="ts">
const props = defineProps<{
	realtimeTopic: string[]
}>()

for (const topic of props.realtimeTopic) {
	useRealtimeTopic(topic, (event) => {
		if ('type' in event) refreshLivePageBlocks()
	})
}
</script>

<template>
	<span hidden />
</template>
