<script setup lang="ts">
import { computed } from 'vue';
import { RELEASE_STEP, stepsAmplitude, type EnvStep } from '@/sysex/envelopes';
import { peakAmplitude } from '@/envelopes/chain';

/** A thumbnail of the envelope: the same note length for every shape, so they compare. */
const props = defineProps<{ steps: readonly EnvStep[] }>();

const W = 54;
const H = 22;
const NOTE_MS = 700;

const path = computed(() => {
  const span = Math.min(2600, NOTE_MS + props.steps[RELEASE_STEP].durMs + 60);
  const top = peakAmplitude(props.steps);
  let d = '';
  for (let i = 0; i <= W; i++) {
    const a = stepsAmplitude(props.steps, (i / W) * span, NOTE_MS);
    d += `${i ? 'L' : 'M'}${i},${(H - 2 - (a / top) * (H - 4)).toFixed(1)}`;
  }
  return d;
});
</script>

<template>
  <svg class="env-thumb" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true"><path :d="path" /></svg>
</template>
