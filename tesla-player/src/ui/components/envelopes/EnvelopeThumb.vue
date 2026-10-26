<script setup lang="ts">
import { computed } from 'vue';
import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { SndEnvelope } from '@/model/envelopes';

/** A thumbnail of the envelope: the same note length for every shape, so they compare. */
const props = defineProps<{ steps: readonly EnvStep[] }>();

const W = 54;
const H = 22;
const NOTE_MS = 700;

const path = computed(() => {
  const span = Math.min(2600, NOTE_MS + props.steps[SndEnvPrograms.RELEASE_STEP].durMs + 60);
  const top = new SndEnvelope(props.steps).peak;
  let d = '';
  for (let i = 0; i <= W; i++) {
    const a = new SndEnvelope(props.steps).amplitude((i / W) * span, NOTE_MS);
    d += `${i ? 'L' : 'M'}${i},${(H - 2 - (a / top) * (H - 4)).toFixed(1)}`;
  }
  return d;
});
</script>

<template>
  <svg class="env-thumb" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true"><path :d="path" /></svg>
</template>
