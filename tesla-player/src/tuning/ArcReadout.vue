<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** Under the picture: the arc length now, its P90 over the last second, and what spoils it, if anything. */
defineProps<{
  live: { L: number; p90: number; moved: boolean; edge: 'frame' | 'zone' | null };
  state: string;
  /** Lit while something is being recorded. */
  active?: boolean;
}>();
const { t } = useI18n();
</script>

<template>
  <div class="cam__readout" :class="{ 'is-measuring': active }">
    <span class="cam__value">{{ live.L.toFixed(0) }}</span>
    <span class="cam__unit">px</span>
    <span class="cam__p90 mono">P90 {{ live.p90.toFixed(0) }}</span>
    <span class="cam__state">{{ state }}</span>
  </div>
  <div v-if="live.moved || live.edge" class="cam__meta">
    <span v-if="live.moved" class="cam__warn"><i class="fas fa-triangle-exclamation"></i>{{ t('tune.cam.moved') }}</span>
    <span v-if="live.edge" class="cam__warn"><i class="fas fa-scissors"></i>{{ live.edge === 'frame' ? t('tune.cam.edgeFrame') : t('tune.cam.edgeWall') }}</span>
  </div>
</template>
