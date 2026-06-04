<script setup lang="ts">
import { computed } from 'vue';
import type { CoilConfig } from '@/types/domain';
import { coilColor } from '@/ui/coil-colors';
import { ENVELOPES } from '@/sysex/envelopes';
import { useMidiStore } from '@/stores/midi';
import ChannelMaskSelector from '@/components/editor/ChannelMaskSelector.vue';

const props = defineProps<{ index: number; showEnvelope?: boolean; availableChannels?: number[] | null }>();
const coil = defineModel<CoilConfig>({ required: true });

const midiStore = useMidiStore();
const color = computed(() => coilColor(props.index));
const name = computed(() => midiStore.coilName(props.index));

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

// envelope ("instrument") override — null means "don't override / passthrough"
const program = computed<number | null>({
  get: () => coil.value.program ?? null,
  set: (v) => { coil.value = { ...coil.value, program: v }; },
});

</script>

<template>
  <article class="coil-card" :style="{ '--coil': color }">
    <header class="coil-card__head">
      <span class="coil-card__badge">{{ index }}</span>
      <h3 class="coil-card__title">{{ $t('label.coil') }} {{ index }}<span v-if="name" class="coil-card__name"> · {{ name }}</span></h3>
      <span class="coil-card__count">{{ activeChannels }} ch</span>
    </header>

    <span class="readout-label">{{ $t('label.midiChannels') }}</span>
    <ChannelMaskSelector v-model="channelMask" :color="color" :available-channels="availableChannels"
      :label="`${$t('label.coil')} ${index} · ${$t('label.midiChannels')}`" />

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

    <template v-if="showEnvelope">
      <span class="readout-label coil-env__label">
        <span class="icon"><i class="fas fa-sliders"></i></span>{{ $t('label.instrument') }}
      </span>
      <div class="select-field coil-env">
        <select v-model="program">
          <option :value="null">{{ $t('label.noOverride') }}</option>
          <option v-for="e in ENVELOPES" :key="e.program" :value="e.program">{{ e.program }} · {{ e.name }}</option>
        </select>
      </div>
    </template>
  </article>
</template>

<style scoped>
.coil-card__name { color: var(--text-mute); font-weight: 400; }
.coil-env__label { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.85rem; }
.coil-env__label .icon { color: var(--coil, var(--volt)); font-size: 0.8rem; }
.coil-env { margin-top: 0.4rem; }
</style>
