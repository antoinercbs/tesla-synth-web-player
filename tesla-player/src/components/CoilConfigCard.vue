<script setup lang="ts">
import { computed } from 'vue';
import type { CoilConfig } from '@/types/domain';
import { coilColor } from '@/ui/coil-colors';
import ChannelMaskSelector from './ChannelMaskSelector.vue';

const props = defineProps<{ index: number }>();
const coil = defineModel<CoilConfig>({ required: true });

const color = computed(() => coilColor(props.index));

const channelMask = computed({
  get: () => coil.value.channelMask,
  set: (v: number) => { coil.value = { ...coil.value, channelMask: v }; },
});
const ontimeUs = computed({
  get: () => coil.value.ontimeUs,
  set: (v: number) => { coil.value = { ...coil.value, ontimeUs: Math.max(0, Math.round(v || 0)) }; },
});
const dutyPercent = computed({
  get: () => Math.round(coil.value.duty * 1e4) / 100,
  set: (v: number) => { coil.value = { ...coil.value, duty: Math.min(1, Math.max(0, (v || 0) / 100)) }; },
});

const activeChannels = computed(() => {
  let n = 0;
  let m = coil.value.channelMask;
  while (m) { n += m & 1; m >>>= 1; }
  return n;
});
</script>

<template>
  <article class="coil-card" :style="{ '--coil': color }">
    <header class="coil-card__head">
      <span class="coil-card__badge">{{ index }}</span>
      <h3 class="coil-card__title">{{ $t('label.coil') }} {{ index }}</h3>
      <span class="coil-card__count">{{ activeChannels }} ch</span>
    </header>

    <span class="readout-label">{{ $t('label.midiChannels') }}</span>
    <ChannelMaskSelector v-model="channelMask" :color="color" :label="`${$t('label.coil')} ${index} — ${$t('label.midiChannels')}`" />

    <div class="readout-row">
      <div class="readout">
        <span class="readout__key">{{ $t('label.ontime') }}</span>
        <label class="readout__field">
          <input type="number" min="0" step="1" v-model.number="ontimeUs">
          <i>µs</i>
        </label>
      </div>
      <div class="readout">
        <span class="readout__key">{{ $t('label.duty') }}</span>
        <label class="readout__field">
          <input type="number" min="0" max="100" step="0.1" v-model.number="dutyPercent">
          <i>%</i>
        </label>
      </div>
    </div>
  </article>
</template>
