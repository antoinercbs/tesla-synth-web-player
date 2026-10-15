<script setup lang="ts">
import { computed } from 'vue';
import type { CoilConfig } from '@/types/domain';
import { coilColor } from '@/ui/coil-colors';
import { useMidiStore } from '@/stores/midi';
import ChannelMaskSelector from '@/components/editor/ChannelMaskSelector.vue';
import CoilFigure from '@/components/editor/CoilFigure.vue';
import EnvelopeSelect from '@/envelopes/EnvelopeSelect.vue';
import { ICONS } from '@/ui/icons';
import { useI18n } from 'vue-i18n';
import { dutyNearLimit, limitLabel, ontimeNearLimit } from '@/devices/limits';
import type { LoadMark, NoteFate } from '@/devices/coil-sim';
import { crossoverHz, effectiveOntimeUs } from '@/devices/ontime-model';
import { nearestNote, noteFrequency, noteName } from '@/ui/piano-layout';
import { pctLabel } from '@/utils/format';

const props = withDefaults(defineProps<{
  index: number;
  showEnvelope?: boolean;
  availableChannels?: number[] | null;
  /** The coil's notes in the song, and what the board makes of them; none: no song. */
  fates?: NoteFate[] | null;
  /** The longest pulse the coil fires in the song (µs). */
  peakUs?: number | null;
  /** The notes drawn when there is no song. */
  span?: [number, number];
  /** Live: how much the board reduces the keys held right now (%), 0 when it does not. */
  liveCut?: number;
}>(), { fates: null, peakUs: null, span: () => [36, 96], liveCut: 0 });
const coil = defineModel<CoilConfig>({ required: true });
const emit = defineEmits<{
  (e: 'marks', marks: LoadMark[] | null): void;
}>();

const midiStore = useMidiStore();
const { t } = useI18n();
const color = computed(() => coilColor(props.index));
const name = computed(() => midiStore.coilName(props.index));
const limits = computed(() => midiStore.coilLimit(props.index));
const limitsSource = computed(() => midiStore.coilLimitSource(props.index));

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

// what the two fields rule: the duty under the crossover (the bass), the ontime above it (the treble)
const drive = computed(() => ({ ontimeUs: coil.value.ontimeUs, duty: coil.value.duty }));
const crossover = computed(() => {
  const n = nearestNote(crossoverHz(drive.value));
  return n < 0 ? t('ontime.allTreble') : n > 127 ? t('ontime.allBass') : noteName(n);
});
const range = computed<[number, number]>(() => {
  if (!props.fates?.length) return props.span;
  let lo = 127;
  let hi = 0;
  for (const f of props.fates) { lo = Math.min(lo, f.note.note); hi = Math.max(hi, f.note.note); }
  return [lo, hi];
});

// a warning, never a block: the thresholds are the board's typical ones (devices/limits.ts)
const limitWarn = computed(() => {
  const hw = midiStore.deviceProfile.hardwareLimits;
  if (!hw || midiStore.isSynthOutput) return '';
  // the longest pulse the coil fires: in the song, or its lowest note when there is none
  const peak = props.peakUs ?? effectiveOntimeUs(drive.value, noteFrequency(range.value[0]), limits.value);
  const over = [
    ontimeNearLimit(hw, peak) ? limitLabel(hw, 'ontime') : '',
    dutyNearLimit(hw, coil.value.duty) ? limitLabel(hw, 'duty') : '',
  ].filter(Boolean);
  return over.length ? t('board.nearLimit', { limit: over.join(' / ') }) : '';
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
      <h3 class="coil-card__title">{{ $t('label.coil') }} <span class="coil-card__no">{{ index }}</span><span v-if="name" class="coil-card__name"> · {{
          name }}</span></h3>
      <span v-if="liveCut" class="coil-card__live" :title="$t('ontime.live.cutHint')"><i class="fas fa-layer-group"></i>{{
        $t('ontime.live.cut', { pct: liveCut }) }}</span>
      <span class="coil-card__count">{{ activeChannels }} ch</span>
    </header>

    <span class="readout-label">{{ $t('label.midiChannels') }}</span>
    <ChannelMaskSelector v-model="channelMask" :color="color" :available-channels="availableChannels"
      :label="`${$t('label.coil')} ${index} · ${$t('label.midiChannels')}`" />

    <!-- the bass on the left, like on a keyboard, and where they hand over -->
    <div class="readout-row coil-drive">
      <div class="readout">
        <span class="readout__key" :title="$t('ontime.bassHint')">{{ $t('ontime.bass') }}<small class="readout__sub">duty</small></span>
        <label class="readout__field">
          <input type="number" min="0" max="100" step="0.1" v-model.number="dutyPercent">
          <i>%</i>
        </label>
      </div>
      <span class="coil-drive__xo" :title="$t('ontime.crossoverHint')">{{ $t('ontime.crossover') }}<b>{{ crossover }}</b></span>
      <div class="readout">
        <span class="readout__key" :title="$t('ontime.trebleHint')">{{ $t('ontime.treble') }}<small class="readout__sub">ontime</small></span>
        <label class="readout__field">
          <input type="number" min="0" step="1" v-model.number="ontimeUs">
          <i>µs</i>
        </label>
      </div>
    </div>

    <table class="coil-limits" :title="$t('ontime.limits.hint')">
      <caption v-if="limitsSource !== 'board'" class="coil-limits__source" :title="$t(`ontime.limits.${limitsSource}Hint`)">
        <i class="fas" :class="limitsSource === 'last' ? 'fa-clock-rotate-left' : 'fa-circle-info'"></i>{{
          $t(`ontime.limits.${limitsSource}`) }}
      </caption>
      <tbody>
        <tr>
          <th rowspan="2"><i class="fas fa-lock"></i></th>
          <th>{{ $t('ontime.limits.ontime') }}</th><th>{{ $t('ontime.limits.duty') }}</th>
          <th>{{ $t('ontime.limits.voices') }}</th><th>{{ $t('ontime.limits.minOntime') }}</th>
        </tr>
        <tr>
          <td>{{ limits.ontimeUs != null ? `${limits.ontimeUs} µs` : '–' }}</td>
          <td>{{ limits.duty != null ? `${pctLabel(limits.duty)} %` : '–' }}</td>
          <td>{{ limits.voices ?? '–' }}</td>
          <td>{{ limits.minOntimeUs != null ? `${limits.minOntimeUs} µs` : '–' }}</td>
        </tr>
      </tbody>
    </table>

    <CoilFigure :drive="drive" :limits="limits" :lo="range[0]" :hi="range[1]" :fates="fates"
      @marks="emit('marks', $event)" />

    <p v-if="limitWarn" class="coil-card__warn" role="status">
      <i class="fas fa-triangle-exclamation"></i>{{ limitWarn }}
    </p>

    <template v-if="showEnvelope">
      <span class="readout-label coil-env__label">
        <span class="icon"><i class="fas" :class="ICONS.instrument"></i></span>{{ $t('label.instrument') }}
      </span>
      <envelope-select v-model="program" class="coil-env" :none-label="$t('label.noOverride')" />
    </template>
  </article>
</template>
