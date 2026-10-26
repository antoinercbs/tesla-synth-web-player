<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CoilConfig } from '@/model/domain';
import { useCoilColor } from '@/ui/helpers/coil-colors';
import { useMidiStore } from '@/app/stores/midi';
import ChannelMaskSelector from '@/ui/components/editor/ChannelMaskSelector.vue';
import CoilFigure from '@/ui/components/editor/CoilFigure.vue';
import VFader from '@/ui/components/ui/VFader.vue';
import BaseModal from '@/ui/components/ui/BaseModal.vue';
import EnvelopeSelect from '@/ui/components/envelopes/EnvelopeSelect.vue';
import { ICONS } from '@/ui/helpers/icons';
import { useI18n } from 'vue-i18n';
import { DevHwLimits } from '@/model/devices/limits';
import type { DevNoteFate, LoadMark } from '@/model/devices/simulation';
import { DevOutput, type CoilDrive } from '@/model/devices/output';
import { MidNote } from '@/model/midi/note';
import { pctLabel } from '@/utils/format';
import { DevCoilLimits } from '@/model/devices/coil-limits';
import type { TeslaCoil } from '@/model/coils/inventory';
import { PhySpec } from '@/model/coils/spec';

const props = withDefaults(defineProps<{
  index: number;
  showEnvelope?: boolean;
  availableChannels?: number[] | null;
  /** Its channels' grid; off where another tool routes them (the song editor's Routing). */
  showChannels?: boolean;
  /** The coil's notes in the song, and what the board makes of them; none: no song. */
  fates?: DevNoteFate[] | null;
  /** The longest pulse the coil fires in the song (µs). */
  peakUs?: number | null;
  /** The notes drawn when there is no song. */
  span?: [number, number];
  /** Live: how much the board reduces the keys held right now (%), 0 when it does not. */
  liveCut?: number;
  /** The real coil at a song's place: its name, its sheet's limits, its physics. Absent: the coil on output `index`. */
  physical?: TeslaCoil | null;
  /**
   * Débutant (ui/helpers/ui-mode.ts, Live): its channels and one power instead of the
   * strip and the drawing: the ontime and the duty together, as shares of the
   * sheet's max (the duty half of it, the chords' room).
   */
  simple?: boolean;
}>(), { showChannels: true, fates: null, peakUs: null, span: () => [36, 96], liveCut: 0, physical: undefined, simple: false });
const coil = defineModel<CoilConfig>({ required: true });
const emit = defineEmits<{
  (e: 'marks', marks: LoadMark[] | null): void;
}>();

const coilColor = useCoilColor();
const midiStore = useMidiStore();
const { t } = useI18n();
const color = computed(() => coilColor(props.index));
const byPlace = computed(() => props.physical !== undefined);
const name = computed(() => (byPlace.value ? props.physical?.name ?? '' : midiStore.coilName(props.index)));
const limits = computed(() => (byPlace.value
  ? { ...DevCoilLimits.DEFAULT, ...midiStore.limitsOf(props.physical ?? null) }
  : midiStore.coilLimit(props.index)));
const limitsSource = computed(() => (byPlace.value ? (props.physical ? 'sheet' : 'default') : midiStore.coilLimitSource(props.index)));
// the sheet's limits apart, in a window from the card's head: the strip and the drawing
// only mark where they act (padlocked); the coil's full sheet a link away
const sheetOpen = ref(false);
const sheetCoil = computed(() => (byPlace.value ? props.physical ?? null : midiStore.wiredCoil(props.index)));
const limitRows = computed(() => [
  { key: 'ontime', v: limits.value.ontimeUs != null ? `${limits.value.ontimeUs} µs` : '–' },
  { key: 'duty', v: limits.value.duty != null ? `${pctLabel(limits.value.duty)} %` : '–' },
  { key: 'voices', v: limits.value.voices != null ? String(limits.value.voices) : '–' },
  { key: 'minOntime', v: `${limits.value.minOntimeUs ?? 0} µs` },
  ...(limits.value.minOfftimeUs != null ? [{ key: 'minOfftime', v: `${limits.value.minOfftimeUs} µs` }] : []),
]);
// the driver's, not the board's: its OCD, and the pulse past which it cuts every bang, on the notes drawn
const driver = computed(() => {
  const p = physics.value;
  if (!p || !sheetCoil.value) return null;
  const useful: number[] = [];
  for (let n = range.value[0]; n <= range.value[1]; n++) {
    const us = p.ocdFrom(MidNote.hz(n));
    if (Number.isFinite(us)) useful.push(us);
  }
  const a = Math.round(Math.min(...useful)), z = Math.round(Math.max(...useful));
  return {
    ocdA: PhySpec.resolve(sheetCoil.value.spec).ocd,
    useful: useful.length ? (a === z ? `${a} µs` : `${a}–${z} µs`) : null,
  };
});
const physics = computed(() => (byPlace.value ? midiStore.physicsOf(props.physical ?? null) : midiStore.coilResponses[props.index]));

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

// what the two settings rule: the duty under the crossover (the bass), the ontime above it (the treble)
const drive = computed(() => ({ ontimeUs: coil.value.ontimeUs, duty: coil.value.duty }));
function setDrive(d: CoilDrive): void {
  coil.value = { ...coil.value, ontimeUs: Math.max(0, Math.round(d.ontimeUs)), duty: Math.min(1, Math.max(0, d.duty)) };
}

// the strip's faders, as the player's: up to half past the sheet's limit, padlocked on it, hatched past it
const dutyLimit = computed(() => limits.value.duty ?? null);
const ontimeLimit = computed(() => limits.value.ontimeUs ?? null);
const dutyScale = computed(() => Math.round(Math.max((dutyLimit.value ?? 0.1) * 1.5, coil.value.duty * 1.1) * 1000));
const ontimeScale = computed(() => Math.round(Math.max((ontimeLimit.value ?? 200) * 1.5, coil.value.ontimeUs * 1.1)));
const dutyMille = computed({
  get: () => Math.round(coil.value.duty * 1000),
  set: (v: number) => { coil.value = { ...coil.value, duty: v / 1000 }; },
});
// a beginner's power: the ontime's share of the max ontime, the duty following it
const POWER_DUTY = 0.5;
const powerPct = computed({
  get: () => Math.round(Math.min(1, coil.value.ontimeUs / (ontimeLimit.value ?? 200)) * 100),
  set: (p: number) => {
    const share = Math.max(0, Math.min(100, p)) / 100;
    coil.value = {
      ...coil.value,
      ontimeUs: Math.round(share * (ontimeLimit.value ?? 200)),
      duty: Math.round(share * (dutyLimit.value ?? 0.1) * POWER_DUTY * 1e4) / 1e4,
    };
  },
});
const limitAt = (limit: number | null, scale: number): string => `${limit == null ? 100 : Math.min(100, (limit / scale) * 100)}%`;
// the song's notes each setting plays: under the crossover the duty, above it the ontime
const split = computed(() => {
  if (!props.fates) return null;
  const xo = new DevOutput(drive.value).crossoverHz;
  const bass = props.fates.filter((f) => MidNote.hz(f.note.note) < xo).length;
  return { bass, treble: props.fates.length - bass };
});
const range = computed<[number, number]>(() => {
  if (!props.fates?.length) return props.span;
  let lo = 127;
  let hi = 0;
  for (const f of props.fates) { lo = Math.min(lo, f.note.note); hi = Math.max(hi, f.note.note); }
  return [lo, hi];
});

// a warning, never a block: the thresholds are the board's typical ones (model/devices/limits.ts)
const limitWarn = computed(() => {
  const hw = midiStore.deviceProfile.hardwareLimits;
  if (!hw || midiStore.isSynthOutput) return '';
  // the longest pulse the coil fires: in the song, or its lowest note when there is none
  const peak = props.peakUs ?? new DevOutput(drive.value, limits.value).effective(MidNote.hz(range.value[0]));
  const over = [
    new DevHwLimits(hw).ontimeNear(peak) ? new DevHwLimits(hw).label('ontime') : '',
    new DevHwLimits(hw).dutyNear(coil.value.duty) ? new DevHwLimits(hw).label('duty') : '',
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
      <!-- its name when it has one: the operator knows the coils by it -->
      <h3 class="coil-card__title">
        <span v-if="name" class="coil-card__name">{{ name }}</span>
        <template v-else>{{ $t('label.coil') }} <span class="coil-card__no">{{ index }}</span></template>
      </h3>
      <span v-if="liveCut" class="coil-card__live" :title="$t('ontime.live.cutHint')"><i class="fas fa-layer-group"></i>{{
        $t('ontime.live.cut', { pct: liveCut }) }}</span>
      <span class="coil-card__count">{{ $t('ontime.channelCount', activeChannels) }}</span>
      <button class="icon-btn icon-btn--sm coil-card__sheet" :class="{ 'is-default': limitsSource === 'default' }" type="button"
        :title="limitsSource === 'default' ? `${$t('ontime.limits.open')} · ${$t('ontime.limits.defaultShort')}` : $t('ontime.limits.open')"
        :aria-label="$t('ontime.limits.open')" @click="sheetOpen = true"><i class="fas fa-file-lines"></i></button>
    </header>

    <template v-if="showChannels">
      <span class="readout-label">{{ $t('label.midiChannels') }}</span>
      <ChannelMaskSelector v-model="channelMask" :color="color" :available-channels="availableChannels"
        :label="`${$t('label.coil')} ${index} · ${$t('label.midiChannels')}`" />
    </template>

    <label v-if="simple" class="coil-power" :title="$t('label.coilPowerHint', { on: coil.ontimeUs, duty: pctLabel(coil.duty) })">
      <span class="coil-power__k">{{ $t('label.power') }}</span>
      <input v-model.number="powerPct" class="power-range power-range--plain" type="range" min="0" max="100" step="1" :aria-label="`${$t('label.power')} · ${name}`">
      <b class="coil-power__v">{{ powerPct }} %</b>
    </label>
    <div v-else class="coil-card__body">
      <!-- the strip, as in the player: the bass on the left, like on a keyboard; the sheet's limits padlocked -->
      <div class="coil-strip">
        <div class="coil-strip__ch" :class="{ 'is-idle': split && !split.bass }">
          <span class="coil-strip__key" :title="$t('ontime.bassHint')">{{ $t('ontime.bass') }}<small>duty</small></span>
          <label class="coil-strip__val"><input type="number" min="0" max="100" step="0.1" v-model.number="dutyPercent"
              :aria-label="`${$t('ontime.bass')} · duty (%)`"><i>%</i></label>
          <v-fader v-model="dutyMille" class="vfader--limit" :style="{ '--vf-limit': limitAt(dutyLimit != null ? dutyLimit * 1000 : null, dutyScale) }"
            :scale="dutyScale" :home="null" :value-text="`${dutyPercent} %`" :label="`${name || $t('label.coil')} · ${$t('ontime.bass')} (duty)`"
            :notch="dutyLimit != null ? dutyLimit * 1000 : null"
            :notch-title="dutyLimit != null ? $t('ontime.strip.limitTitle', { what: $t('ontime.limits.duty'), v: `${pctLabel(dutyLimit)} %` }) : undefined" />
          <span v-if="split" class="coil-strip__n" :title="$t('ontime.strip.bassNotesHint')">{{ $t('ontime.strip.notes', split.bass) }}</span>
        </div>
        <div class="coil-strip__ch" :class="{ 'is-idle': split && !split.treble }">
          <span class="coil-strip__key" :title="$t('ontime.trebleHint')">{{ $t('ontime.treble') }}<small>ontime</small></span>
          <label class="coil-strip__val"><input type="number" min="0" step="1" v-model.number="ontimeUs"
              :aria-label="`${$t('ontime.treble')} · ontime (µs)`"><i>µs</i></label>
          <v-fader v-model="ontimeUs" class="vfader--limit" :style="{ '--vf-limit': limitAt(ontimeLimit, ontimeScale) }"
            :scale="ontimeScale" :home="null" :value-text="`${ontimeUs} µs`" :label="`${name || $t('label.coil')} · ${$t('ontime.treble')} (ontime)`"
            :notch="ontimeLimit"
            :notch-title="ontimeLimit != null ? $t('ontime.strip.limitTitle', { what: $t('ontime.limits.ontime'), v: `${ontimeLimit} µs` }) : undefined" />
          <span v-if="split" class="coil-strip__n" :title="$t('ontime.strip.trebleNotesHint')">{{ $t('ontime.strip.notes', split.treble) }}</span>
        </div>
      </div>

      <CoilFigure :drive="drive" :limits="limits" :lo="range[0]" :hi="range[1]" :fates="fates"
        :physics="physics" editable @update:drive="setDrive" @marks="emit('marks', $event)" />
    </div>

    <p v-if="limitWarn" class="coil-card__warn" role="status">
      <i class="fas fa-triangle-exclamation"></i>{{ limitWarn }}
    </p>

    <base-modal :open="sheetOpen" :title="name ? $t('ontime.limits.title', { name }) : $t('ontime.limits.titleNone')"
      card-class="coil-sheet-modal" :close-label="$t('label.close')" @close="sheetOpen = false">
      <p class="coil-sheet-modal__lead">{{ $t('ontime.limits.hint') }}</p>
      <dl class="coil-sheet-modal__list">
        <div v-for="r in limitRows" :key="r.key"><dt><i class="fas fa-lock"></i>{{ $t(`ontime.limits.${r.key}`) }}</dt><dd>{{ r.v }}</dd></div>
      </dl>
      <template v-if="driver">
        <h3 class="coil-sheet-modal__sub">{{ $t('ontime.limits.driver') }}</h3>
        <dl class="coil-sheet-modal__list">
          <div><dt>{{ $t('ontime.limits.ocd') }}</dt><dd>{{ driver.ocdA }} A</dd></div>
          <div :title="$t('ontime.limits.usefulHint')"><dt>{{ $t('ontime.limits.useful') }}</dt>
            <dd>{{ driver.useful ?? $t('ontime.limits.usefulNever') }}</dd></div>
        </dl>
      </template>
      <p class="coil-sheet-modal__source" :class="{ 'is-default': limitsSource === 'default' }">
        <i class="fas" :class="limitsSource === 'last' ? 'fa-clock-rotate-left' : limitsSource === 'default' ? 'fa-triangle-exclamation' : 'fa-circle-info'"></i>
        <span><b>{{ $t(`ontime.limits.${limitsSource}`) }}</b> · {{ $t(`ontime.limits.${limitsSource}Hint`) }}</span>
      </p>
      <template #actions>
        <button class="btn" type="button" @click="sheetOpen = false">{{ $t('label.close') }}</button>
        <router-link v-if="sheetCoil" class="btn btn--volt" :to="{ name: 'coils', params: { id: String(sheetCoil.id) } }" @click="sheetOpen = false">
          <span class="icon"><i class="fas fa-up-right-from-square"></i></span>{{ $t('ontime.limits.openSheet') }}
        </router-link>
      </template>
    </base-modal>

    <template v-if="showEnvelope">
      <span class="readout-label coil-env__label">
        <span class="icon"><i class="fas" :class="ICONS.instrument"></i></span>{{ $t('label.instrument') }}
      </span>
      <envelope-select v-model="program" class="coil-env" :none-label="$t('label.noOverride')" />
    </template>
  </article>
</template>
