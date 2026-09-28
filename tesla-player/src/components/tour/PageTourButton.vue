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
