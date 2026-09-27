<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MidiAnalysis } from '@/midi/analyze';
import { MAX_RATIO, curveAt, curvePoints, snapToBeat } from '@/midi/automation';
import { coilColor } from '@/ui/coil-colors';
import { SONG_WIDE, type CoilEvent, type CoilParam } from '@/types/domain';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import DynamicsTracks from '@/components/editor/DynamicsTracks.vue';

/**
 * A song's power over time: the song-wide curve (every coil), and optionally
 * each coil's own ontime or duty curve, which multiply. The player's live power
 * applies on top of both.
 */
const events = defineModel<CoilEvent[]>({ required: true });
const props = defineProps<{
  coilCount: number;
  analysis: MidiAnalysis | null;
  /** Where the embedded player is (ms): new points land there. */
  playerPosition: number;
  /** Changes when another song is opened: the section's own state starts over. */
  songKey: number | null;
}>();
const { t } = useI18n();

const hasCoilPoints = (list: CoilEvent[]): boolean => list.some((e) => e.coilIndex !== SONG_WIDE);
const enabled = ref(events.value.length > 0);
const perCoil = ref(hasCoilPoints(events.value));
const param = ref<CoilParam>('ontime');
const selected = ref<number | null>(null);
const cursorMs = ref(props.playerPosition);
// switching off and on again in the same session brings the points back
const lastOff = ref<CoilEvent[] | null>(null);
watch(() => props.songKey, () => {
  enabled.value = events.value.length > 0;
  perCoil.value = hasCoilPoints(events.value);
  selected.value = null;
  lastOff.value = null;
});
watch(() => props.playerPosition, (ms) => { cursorMs.value = ms; });

const durationMs = computed(() =>
  props.analysis?.durationMs || Math.max(60000, ...events.value.map((e) => e.atMs + 5000)));
const beats = computed(() => props.analysis?.beats ?? []);

/* ------------------------------ switching off ------------------------------ */
const confirming = ref<'all' | 'perCoil' | null>(null);
const coilPointCount = computed(() => events.value.filter((e) => e.coilIndex !== SONG_WIDE).length);
function toggle(on: boolean): void {
  if (on) {
    enabled.value = true;
    if (lastOff.value && !events.value.length) events.value = lastOff.value;
    lastOff.value = null;
  } else if (events.value.length) confirming.value = 'all';
  else enabled.value = false;
}
function togglePerCoil(on: boolean): void {
  if (on) perCoil.value = true;
  else if (coilPointCount.value) confirming.value = 'perCoil';
  else perCoil.value = false;
}
function confirmOff(): void {
  if (confirming.value === 'all') {
    lastOff.value = events.value;
    events.value = [];
    enabled.value = false;
  } else {
    events.value = events.value.filter((e) => e.coilIndex === SONG_WIDE);
    perCoil.value = false;
  }
  selected.value = null;
  confirming.value = null;
}

/* ------------------------------ quick actions ------------------------------ */
const songPoints = computed(() => curvePoints(events.value, SONG_WIDE, 'power'));
const roundRatio = (v: number): number => Math.round(v * 20) / 20;
const hereMs = computed(() => snapToBeat(beats.value, Math.min(durationMs.value, Math.max(0, cursorMs.value))));
function addHere(): void {
  const at = hereMs.value;
  const existing = events.value.findIndex((e) => e.coilIndex === SONG_WIDE && e.atMs === at);
  if (existing !== -1) {
    selected.value = existing;
    return;
  }
  events.value = [...events.value, { coilIndex: SONG_WIDE, param: 'power', atMs: at, value: roundRatio(curveAt(songPoints.value, at)) }];
  selected.value = events.value.length - 1;
}
const FADE_MS = 6000;
function fadeLength(): number {
  return snapToBeat(beats.value, Math.min(FADE_MS, durationMs.value / 4));
}
function fadeIn(): void {
  const len = fadeLength();
  events.value = [
    ...events.value.filter((e) => e.coilIndex !== SONG_WIDE || e.atMs > len),
    { coilIndex: SONG_WIDE, param: 'power', atMs: 0, value: 0.4 },
    { coilIndex: SONG_WIDE, param: 'power', atMs: len, value: 1, ramp: true },
  ];
  selected.value = null;
}
function fadeOut(): void {
  const end = Math.round(durationMs.value);
  const start = snapToBeat(beats.value, end - fadeLength());
  const level = roundRatio(curveAt(songPoints.value, start));
  events.value = [
    ...events.value.filter((e) => e.coilIndex !== SONG_WIDE || e.atMs < start),
    { coilIndex: SONG_WIDE, param: 'power', atMs: start, value: level },
    { coilIndex: SONG_WIDE, param: 'power', atMs: end, value: 0, ramp: true },
  ];
  selected.value = null;
}

/* -------------------------------- the list --------------------------------- */
const rows = computed(() =>
  events.value
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.coilIndex === SONG_WIDE || perCoil.value)
    .sort((a, b) => a.e.atMs - b.e.atMs || a.e.coilIndex - b.e.coilIndex),
);
function patch(i: number, change: Partial<CoilEvent>): void {
  const next = events.value.slice();
  next[i] = { ...next[i], ...change };
  events.value = next;
}
function remove(i: number): void {
  events.value = events.value.filter((_, k) => k !== i);
  selected.value = null;
}
const fmtTime = (ms: number): string =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms / 100) % 10}`;
// a typo goes back to the current value rather than lingering in the field
function onTime(i: number, input: HTMLInputElement): void {
  const m = /^(\d+):(\d{1,2})(?:[.,](\d))?$/.exec(input.value.trim());
  if (!m) {
    input.value = fmtTime(events.value[i].atMs);
    return;
  }
  patch(i, { atMs: Math.min(durationMs.value, (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number(m[3] ?? 0) * 100) });
}
function onValue(i: number, input: HTMLInputElement): void {
  const v = Number(input.value.replace(',', '.'));
  if (input.value.trim() === '' || !Number.isFinite(v)) {
    input.value = String(Math.round(events.value[i].value * 100));
    return;
  }
  const ratio = Math.min(MAX_RATIO, Math.max(0, v / 100));
  input.value = String(Math.round(ratio * 100));
  patch(i, { value: ratio });
}
const paramOptions = computed(() => [
  { value: 'ontime' as const, label: t('dynamics.param.ontime') },
  { value: 'duty' as const, label: t('dynamics.param.duty') },
]);
</script>

<template>
  <section class="editor-section dyn">
    <div class="dyn__head">
      <h2 class="editor-section__title">
        <span class="icon"><i class="fas fa-chart-area"></i></span>{{ $t('dynamics.title') }}
      </h2>
      <label class="switch">
        <input type="checkbox" :checked="enabled" @change="toggle(($event.target as HTMLInputElement).checked)" />
        <span class="switch__track"></span>
        <span class="switch__text">{{ $t('dynamics.enable') }}</span>
      </label>
    </div>
    <p class="dyn__intro">{{ $t('dynamics.intro') }}</p>

    <template v-if="enabled">
      <div class="dyn__bar">
        <button class="btn btn--volt dyn__btn" type="button" @click="addHere">
          <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('dynamics.addAt', { t: fmtTime(hereMs) }) }}
        </button>
        <button class="btn dyn__btn" type="button" :title="$t('dynamics.fadeInHint')" @click="fadeIn">
          <span class="icon"><i class="fas fa-arrow-trend-up"></i></span>{{ $t('dynamics.fadeIn') }}
        </button>
        <button class="btn dyn__btn" type="button" :title="$t('dynamics.fadeOutHint')" @click="fadeOut">
          <span class="icon"><i class="fas fa-arrow-trend-down"></i></span>{{ $t('dynamics.fadeOut') }}
        </button>
        <span class="dyn__spacer"></span>
        <segmented-control v-if="perCoil" v-model="param" :options="paramOptions" :aria-label="$t('dynamics.perCoilParam')" />
        <label class="switch" :title="$t('dynamics.perCoilHint')">
          <input type="checkbox" :checked="perCoil" @change="togglePerCoil(($event.target as HTMLInputElement).checked)" />
          <span class="switch__track"></span>
          <span class="switch__text">{{ $t('dynamics.perCoil') }}</span>
        </label>
      </div>

      <dynamics-tracks v-model:events="events" v-model:selected="selected" v-model:cursor-ms="cursorMs"
        :coil-count="coilCount" :analysis="analysis" :per-coil="perCoil" :param="param" :duration-ms="durationMs" />
      <p class="dyn__hint"><i class="fas fa-hand-pointer"></i>{{ $t('dynamics.gestures') }}</p>

      <div v-if="rows.length" class="dyn__list">
        <div v-for="{ e, i } in rows" :key="i" class="dyn-row" :class="{ 'is-selected': selected === i }"
          @click="selected = i">
          <input class="text-field dyn-row__time" :value="fmtTime(e.atMs)" :aria-label="$t('dynamics.time')"
            @change="onTime(i, $event.target as HTMLInputElement)">
          <span class="dyn-row__target">
            <span class="dyn-row__dot" :style="{ '--c': e.coilIndex === SONG_WIDE ? 'var(--volt)' : coilColor(e.coilIndex) }"></span>
            <template v-if="e.coilIndex === SONG_WIDE">{{ $t('dynamics.songTrack') }}</template>
            <template v-else>
              {{ $t('label.coil') }} {{ e.coilIndex }} ·
              <span class="select-field dyn-row__param">
                <select :value="e.param" :aria-label="$t('dynamics.perCoilParam')"
                  @change="patch(i, { param: ($event.target as HTMLSelectElement).value as CoilParam })">
                  <option value="ontime">{{ $t('dynamics.param.ontime') }}</option>
                  <option value="duty">{{ $t('dynamics.param.duty') }}</option>
                </select>
              </span>
            </template>
          </span>
          <span class="dyn-row__value">
            <input class="text-field" :value="Math.round(e.value * 100)" inputmode="decimal"
              :aria-label="$t('dynamics.level')" @change="onValue(i, $event.target as HTMLInputElement)">
            <span>%</span>
          </span>
          <span class="select-field dyn-row__ramp">
            <select :value="e.ramp ? 'ramp' : 'step'" :aria-label="$t('dynamics.transition')"
              @change="patch(i, { ramp: ($event.target as HTMLSelectElement).value === 'ramp' || undefined })">
              <option value="step">{{ $t('dynamics.step') }}</option>
              <option value="ramp">{{ $t('dynamics.ramp') }}</option>
            </select>
          </span>
          <button type="button" class="dyn-row__remove" :title="$t('dynamics.remove')" :aria-label="$t('dynamics.remove')"
            @click.stop="remove(i)"><i class="fas fa-xmark"></i></button>
        </div>
      </div>
      <p v-else class="dyn__empty">{{ $t('dynamics.empty') }}</p>
    </template>

    <ConfirmModal :open="confirming != null" :title="$t('dynamics.offTitle')"
      :message="confirming === 'all' ? $t('dynamics.offAll', events.length) : $t('dynamics.offPerCoil', coilPointCount)"
      :confirm-label="$t('dynamics.offConfirm')" :cancel-label="$t('label.cancel')" @confirm="confirmOff"
      @close="confirming = null" />
  </section>
</template>

<style scoped>
.dyn__head { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.dyn__head .editor-section__title { margin: 0; }
.dyn__intro { margin: 0.4rem 0 0; font-size: var(--fs-sm); color: var(--text-mute); line-height: 1.5; max-width: 50rem; }
.dyn__bar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin: 0.9rem 0 0.5rem; }
.dyn__btn { padding: 0.35rem 0.8rem; font-size: var(--fs-sm); }
.dyn__spacer { flex: 1; }
.dyn__bar :deep(.segmented button) { padding: 0.25rem 0.7rem; font-size: var(--fs-sm); }
.dyn__hint { display: flex; align-items: center; gap: 0.4rem; margin: 0.4rem 0 0; font-size: var(--fs-xs); color: var(--text-mute); }
.dyn__empty { margin: 0.7rem 0 0; font-size: var(--fs-sm); color: var(--text-mute); }

.dyn__list { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.8rem; }
.dyn-row {
  display: grid; grid-template-columns: 5.2rem 12rem 5.5rem minmax(10rem, 17rem) 1.6rem; justify-content: start; align-items: center; gap: 0.6rem;
  padding: 0.35rem 0.5rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-2);
  font-size: var(--fs-sm); cursor: pointer;
}
.dyn-row.is-selected { border-color: var(--volt-30); background: var(--volt-08); }
.dyn-row .text-field { padding: 0.25rem 0.45rem; font-size: var(--fs-sm); font-family: var(--font-mono); }
.dyn-row select { padding: 0.25rem 1.7rem 0.25rem 0.5rem; font-size: var(--fs-sm); }
.dyn-row__target { display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap; min-width: 0; }
.dyn-row__dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--c); flex: none; }
.dyn-row__param select { padding-right: 1.5rem; }
.dyn-row__value { display: flex; align-items: center; gap: 0.3rem; color: var(--text-mute); }
.dyn-row__remove { border: 0; background: transparent; color: var(--text-mute); cursor: pointer; border-radius: 4px; height: 1.6rem; }
.dyn-row__remove:hover { color: #ff8a96; background: rgb(255 84 104 / 0.1); }

@media (max-width: 700px) {
  .dyn-row { grid-template-columns: 5.2rem 1fr 5.5rem 1.6rem; }
  .dyn-row__ramp { grid-column: 1 / -2; }
}
</style>
