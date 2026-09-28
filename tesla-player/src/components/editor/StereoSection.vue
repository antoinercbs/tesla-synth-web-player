<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MidiAnalysis } from '@/midi/analyze';
import { defaultStereo, filePanOf, fitCoils, noteCoilVolumes, notePans, spreadCoils } from '@/midi/stereo';
import { noteName } from '@/ui/piano-layout';
import type { ChannelPlacement, CoilConfig, PanFollow, SongStereo, StereoBlend } from '@/types/domain';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import StereoStage from '@/components/editor/StereoStage.vue';

/**
 * A song's spatialisation: where its coils stand, how far each reaches, and
 * where each channel's notes sit (the file's pan by default, their pitch, or
 * everywhere). null = off.
 */
const stereo = defineModel<SongStereo | null>({ required: true });
const props = defineProps<{ coilCount: number; coils: CoilConfig[]; analysis: MidiAnalysis | null }>();
const { t } = useI18n();

// switching off and on again in the same session brings the settings back
const lastOn = ref<SongStereo | null>(null);
function toggle(on: boolean): void {
  if (on) stereo.value = fitCoils(lastOn.value ?? defaultStereo(props.coilCount), props.coilCount);
  else {
    lastOn.value = stereo.value;
    stereo.value = null;
  }
}
watch(() => props.coilCount, (n) => { if (stereo.value) stereo.value = fitCoils(stereo.value, n); });

const set = (patch: Partial<SongStereo>): void => { if (stereo.value) stereo.value = { ...stereo.value, ...patch }; };
const blend = computed<StereoBlend>({
  get: () => stereo.value?.blend ?? 'fade',
  set: (b) => set({ blend: b }),
});
const blendOptions = computed(() => [
  { value: 'fade' as const, label: t('stereo.blendFade'), title: t('stereo.blendFadeHint') },
  { value: 'single' as const, label: t('stereo.blendSingle'), title: t('stereo.blendSingleHint') },
]);
const stageCoils = computed<SongStereo['coils']>({
  get: () => stereo.value?.coils ?? [],
  set: (coils) => set({ coils }),
});
function spread(): void {
  set({ coils: spreadCoils(props.coilCount, blend.value) });
}

const placedPans = computed(() => {
  if (!stereo.value || !props.analysis) return [];
  return notePans(props.analysis, stereo.value).filter((p): p is number => p != null);
});

/* -------------------------------- channels -------------------------------- */
type Source = 'file' | 'pitch' | 'omni';
const sourceOptions = computed(() => [
  { value: 'file' as const, label: t('stereo.sourceFile'), icon: 'fa-file-audio', title: t('stereo.sourceFileHint') },
  { value: 'pitch' as const, label: t('stereo.sourcePitch'), icon: 'fa-music', title: t('stereo.sourcePitchHint') },
  { value: 'omni' as const, label: t('stereo.sourceOmni'), icon: 'fa-circle-nodes', title: t('stereo.sourceOmniHint') },
]);
const FOLLOWS: PanFollow[] = ['each', 'lowest', 'highest', 'loudest'];

// notes that no coil of theirs plays: placed out of reach of the coils assigned their channel
const silentByChannel = computed(() => {
  const counts = new Map<number, number>();
  const a = props.analysis;
  if (!a || !stereo.value) return counts;
  const vols = noteCoilVolumes(a, props.coils.slice(0, props.coilCount), stereo.value);
  a.notes.forEach((n, i) => {
    if (Math.max(0, ...vols[i]) <= 0.01) counts.set(n.channel, (counts.get(n.channel) ?? 0) + 1);
  });
  return counts;
});

const channels = computed(() => {
  const a = props.analysis;
  if (!a) return [];
  return a.channels.map((ch) => {
    const pitches = a.notes.filter((n) => n.channel === ch).map((n) => n.note);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    const placement = stereo.value?.channels[ch];
    const assigned = props.coils.slice(0, props.coilCount).filter((c) => c.channelMask & (1 << ch)).length;
    return {
      ch,
      count: pitches.length,
      low,
      high,
      placement,
      source: (placement?.source ?? 'file') as Source,
      filePan: filePanOf(a, ch),
      assigned,
      silent: silentByChannel.value.get(ch) ?? 0,
    };
  });
});

function setPlacement(ch: number, placement: ChannelPlacement | null): void {
  if (!stereo.value) return;
  const next = { ...stereo.value.channels };
  if (placement) next[ch] = placement;
  else delete next[ch];
  set({ channels: next });
}
function setSource(row: (typeof channels.value)[number], source: Source): void {
  if (source === 'file') setPlacement(row.ch, null);
  else if (source === 'omni') setPlacement(row.ch, { source: 'omni' });
  else setPlacement(row.ch, { source: 'pitch', follow: 'each', noteLow: row.low, noteHigh: row.high, lowOn: 'left' });
}
function patchPitch(ch: number, patch: Partial<Extract<ChannelPlacement, { source: 'pitch' }>>): void {
  const p = stereo.value?.channels[ch];
  if (p?.source !== 'pitch') return;
  const next = { ...p, ...patch };
  if (next.noteLow > next.noteHigh) [next.noteLow, next.noteHigh] = [next.noteHigh, next.noteLow];
  setPlacement(ch, next);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** "C4", "f#3", "Bb2" → a note number; null when it is not a note name. */
function parseNote(text: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(text.trim());
  if (!m) return null;
  const base = NOTE_NAMES.indexOf(m[1].toUpperCase()) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const n = base + (Number(m[3]) + 1) * 12;
  return n >= 0 && n <= 127 ? n : null;
}
// a typo goes back to the current note rather than lingering in the field
function onNote(ch: number, key: 'noteLow' | 'noteHigh', input: HTMLInputElement, current: number): void {
  const n = parseNote(input.value);
  if (n == null) {
    input.value = noteName(current);
    return;
  }
  patchPitch(ch, { [key]: n });
}

const pct = (v: number): number => Math.round((v / 127) * 100);
function filePanText(row: (typeof channels.value)[number]): string {
  const f = row.filePan;
  if (f.kind === 'none') return t('stereo.fileNone');
  if (f.kind === 'fixed') return t('stereo.fileFixed', { p: pct(f.value) });
  return t('stereo.fileMoving', { from: pct(f.min), to: pct(f.max) });
}
</script>

<template>
  <section class="editor-section stereo">
    <div class="stereo__head">
      <h2 class="editor-section__title">
        <span class="icon"><i class="fas fa-arrows-left-right"></i></span>{{ $t('stereo.title') }}
      </h2>
      <label class="switch">
        <input type="checkbox" :checked="!!stereo" @change="toggle(($event.target as HTMLInputElement).checked)" />
        <span class="switch__track"></span>
        <span class="switch__text">{{ $t('stereo.enable') }}</span>
      </label>
    </div>
    <p class="stereo__intro">{{ $t('stereo.intro') }}</p>

    <template v-if="stereo">
      <div class="stereo__bar">
        <span class="stereo__bar-label">{{ $t('stereo.blend') }}</span>
        <segmented-control v-model="blend" :options="blendOptions" :aria-label="$t('stereo.blend')" />
        <span class="stereo__spacer"></span>
        <button class="btn stereo__spread" type="button" :title="$t('stereo.spreadHint')" @click="spread">
          <span class="icon"><i class="fas fa-arrows-left-right-to-line"></i></span>{{ $t('stereo.spread') }}
        </button>
      </div>
      <stereo-stage v-model:coils="stageCoils" :blend="blend" :note-pans="placedPans" />

      <p v-if="!analysis" class="stereo__none">{{ $t('stereo.noFile') }}</p>
      <div v-else class="stereo__channels">
        <div v-for="row in channels" :key="row.ch" class="stereo-ch">
          <div class="stereo-ch__name">
            {{ $t('label.channel') }} {{ row.ch }}
            <span class="stereo-ch__meta">{{ $t('stereo.notes', { n: row.count }) }} · {{ noteName(row.low) }}–{{
              noteName(row.high) }}</span>
          </div>
          <segmented-control :model-value="row.source" :options="sourceOptions"
            :aria-label="`${$t('stereo.source')} ${row.ch}`" @update:model-value="setSource(row, $event)" />
          <div class="stereo-ch__opts">
            <template v-if="row.placement?.source === 'pitch'">
              <span>{{ $t('stereo.follow') }}</span>
              <span class="select-field">
                <select :value="row.placement.follow" :aria-label="$t('stereo.follow')"
                  @change="patchPitch(row.ch, { follow: ($event.target as HTMLSelectElement).value as PanFollow })">
                  <option v-for="f in FOLLOWS" :key="f" :value="f">{{ $t('stereo.followOpt.' + f) }}</option>
                </select>
              </span>
              <span>{{ $t('stereo.from') }}</span>
              <input class="text-field stereo-ch__note" :value="noteName(row.placement.noteLow)"
                :aria-label="$t('stereo.lowNote')"
                @change="onNote(row.ch, 'noteLow', $event.target as HTMLInputElement, row.placement.noteLow)">
              <span>{{ $t('stereo.to') }}</span>
              <input class="text-field stereo-ch__note" :value="noteName(row.placement.noteHigh)"
                :aria-label="$t('stereo.highNote')"
                @change="onNote(row.ch, 'noteHigh', $event.target as HTMLInputElement, row.placement.noteHigh)">
              <span class="select-field">
                <select :value="row.placement.lowOn" :aria-label="$t('stereo.direction')"
                  @change="patchPitch(row.ch, { lowOn: ($event.target as HTMLSelectElement).value as 'left' | 'right' })">
                  <option value="left">{{ $t('stereo.lowLeft') }}</option>
                  <option value="right">{{ $t('stereo.lowRight') }}</option>
                </select>
              </span>
            </template>
            <span v-else-if="row.source === 'file'" class="stereo-ch__hint"><i class="fas fa-circle-info"></i>{{
              filePanText(row) }}</span>
            <span v-else class="stereo-ch__hint">{{ $t('stereo.omniHint') }}</span>
            <span v-if="row.assigned === 0" class="stereo-ch__warn">
              <i class="fas fa-triangle-exclamation"></i>{{ $t('stereo.noCoil') }}
            </span>
            <span v-else-if="row.silent === row.count" class="stereo-ch__warn">
              <i class="fas fa-triangle-exclamation"></i>{{ $t('stereo.allOutOfReach') }}
            </span>
            <span v-else-if="row.silent > 0" class="stereo-ch__warn">
              <i class="fas fa-triangle-exclamation"></i>{{ $t('stereo.someOutOfReach', row.silent) }}
            </span>
            <span v-else-if="row.source !== 'omni' && row.assigned === 1" class="stereo-ch__warn">
              <i class="fas fa-triangle-exclamation"></i>{{ $t('stereo.oneCoil') }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
