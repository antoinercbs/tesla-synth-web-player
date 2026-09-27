<script setup lang="ts">
import { computed } from 'vue';
import { startTour, tour, type TourId } from '@/tour/tour';

/**
 * A page's ? beside its title: its own guided tour. It pulses until that tour has
 * been opened once on this device, so the help is not missed, then stays quiet.
 */
const props = defineProps<{ id: TourId }>();
const fresh = computed(() => !tour.seenPages.includes(props.id));
</script>

<template>
  <button class="icon-btn page-tour" :class="{ 'is-fresh': fresh }" type="button" :title="$t('tour.pageStart')"
    :aria-label="$t('tour.pageStart')" @click="startTour(id)">
    <i class="fas fa-circle-question"></i>
  </button>
</template>

<style scoped>
.page-tour {
  font-size: var(--fs-md);
  flex-shrink: 0;
}

.page-tour:hover {
  color: var(--volt);
  border-color: var(--volt);
}

.page-tour.is-fresh {
  color: var(--volt);
  border-color: var(--volt-50);
  animation: page-tour-pulse 1.8s ease-in-out infinite;
}

@keyframes page-tour-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--volt-30); }
  50% { box-shadow: 0 0 0 6px transparent; }
}

@media (prefers-reduced-motion: reduce) {
  .page-tour.is-fresh { animation: none; }
}
</style>
