<script setup lang="ts">
import { computed } from 'vue';
import { parseRich } from '@/tour/rich';

/** A tour card's text, with its bold and its keys (see tour/rich.ts). */
const props = defineProps<{ text: string }>();
const parts = computed(() => parseRich(props.text));
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <b v-if="p.kind === 'bold'">{{ p.value }}</b>
    <kbd v-else-if="p.kind === 'key'">{{ p.value }}</kbd>
    <template v-else>{{ p.value }}</template>
  </template>
</template>
