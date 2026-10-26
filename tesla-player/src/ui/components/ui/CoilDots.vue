<script setup lang="ts">
import { coilColor } from '@/ui/helpers/coil-colors';

/**
 * One dot per coil, by index: a playlist's coil count on a server that predates
 * the inventory, a song's in the player's drawer.
 */
defineProps<{ count: number }>();
</script>

<template>
  <span class="coil-dots">
    <span v-for="i in count" :key="i" class="coil-dot" :style="{ '--c': coilColor(i - 1) }"></span>
    <slot />
  </span>
</template>
