<script setup lang="ts">
import { computed } from 'vue';
import { MIDI_CHANNEL_COUNT } from '@/types/domain';
import type { CoilConfig } from '@/types/domain';
import type { MidiAnalysis } from '@/midi/analyze';
import type { CoilLimits } from '@/devices/coil-limits';
import type { Simulation } from '@/devices/coil-sim';
import MidiPreview from '@/components/player/MidiPreview.vue';
import CoilLoadView from '@/components/player/CoilLoadView.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import { ICONS } from '@/ui/icons';

/**
 * The visualisation block: the VU / score / load / combined tab switch, the
 * per-channel VU bar strip, the MidiPreview (score, or score + coil lanes) and
 * the coils' load as the board plays them (CoilLoadView). Purely presentational —
 * the parent owns the engine and feeds the live frame data.
 *
 * `level`/`backgrounds`/`mapped` are 16-slot arrays indexed by MIDI channel:
 * `level` is the parent's reactive bar-height array (mutated each RAF frame —
 * reading it here stays reactive), `backgrounds`/`mapped` are derived from the
 * song's coil mapping.
 */
type Viz = 'vu' | 'roll' | 'load' | 'combined';
const viz = defineModel<Viz>('viz', { required: true });
const props = defineProps<{
  level: number[];
  backgrounds: string[];
  mapped: boolean[];
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  output2Mask: number;
  playheadMs: number;
  playing: boolean;
  paused: boolean;
  compact: boolean;
  /** What the board makes of the song (devices/coil-sim.ts), for the load and combined tabs. */
  sim?: Simulation | null;
  loadCoils?: { coilIndex: number; name: string; limits: CoilLimits | null }[];
  /** Each channel's CC7 × CC11 where the song is heard: the VU bar never goes above; null when the file sets neither. */
  ceilings?: number[] | null;
}>();
const hasCeiling = computed(() => !!props.ceilings?.some((v, ch) => v < 0.995 && props.mapped[ch]));

// MidiPreview's view: the score, alone or above the coils' load
const previewView = computed<'roll' | 'combined'>(() => (viz.value === 'combined' ? 'combined' : 'roll'));
</script>

<template>
  <div class="player-viz">
    <segmented-control v-model="viz" class="player-viz__tabs" tabs label-class="player-viz__label" :options="[
      { value: 'vu', label: $t('label.viewVu'), icon: 'fa-chart-simple', title: $t('label.viewVu') },
      { value: 'roll', label: $t('label.viewScore'), icon: ICONS.pianoRoll, title: $t('label.viewScore') },
      { value: 'load', label: $t('ontime.load.tab'), icon: ICONS.coil, title: $t('ontime.load.title') },
      { value: 'combined', label: $t('label.viewCombined'), icon: 'fa-layer-group', title: $t('label.viewCombined') },
    ]" />

    <div class="player-viz__body">
      <div v-show="viz === 'vu'" class="vu">
        <span class="vu__label">{{ $t('label.channels') }}</span>
        <div class="vu-strip">
          <div v-for="i in MIDI_CHANNEL_COUNT" :key="i - 1" class="vu-chan">
            <div class="vu-track" :class="{ 'is-unmapped': !mapped[i - 1] }">
              <div v-if="ceilings && ceilings[i - 1] < 0.995" class="vu-ceil" :style="{ height: (1 - ceilings[i - 1]) * 100 + '%' }"
                :title="$t('ontime.volumeCeilHint', { ch: i - 1, pct: Math.round(ceilings[i - 1] * 100) })"></div>
              <div class="vu-fill"
                :style="{ height: (props.level[i - 1] * 100) + '%', background: backgrounds[i - 1] }"></div>
            </div>
            <span class="vu-num">{{ i - 1 }}</span>
          </div>
        </div>
        <span v-if="hasCeiling" class="vu-ceil-key"><span class="vu-ceil-key__sw"></span>{{ $t('ontime.volumeCeil') }}</span>
      </div>
      <coil-load-view v-if="viz === 'load' && sim" :sim="sim" :coils="loadCoils ?? []" :playhead-ms="playing || paused ? playheadMs : null"
        :compact="compact" />
      <div v-else-if="viz === 'load'" class="preview__empty viz-empty">{{ $t('label.noMidiData') }}</div>
      <midi-preview v-if="viz !== 'vu' && viz !== 'load'" :analysis="analysis" :coils="coils"
        :output2-mask="output2Mask" :view="previewView" :playhead-ms="playheadMs" :playing="playing" :paused="paused"
        :compact="compact" :sim="sim ?? null" :load-coils="loadCoils ?? []" />
    </div>
  </div>
</template>
