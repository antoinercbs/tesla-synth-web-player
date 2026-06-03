<script setup lang="ts">
import { computed } from 'vue';
import { MIDI_CHANNEL_COUNT } from '@/types/domain';
import type { CoilConfig, CoilEvent, CoilParam } from '@/types/domain';
import type { MidiAnalysis } from '@/midi/analyze';
import MidiPreview from '@/components/player/MidiPreview.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

/**
 * The visualisation block: the VU / score / coils / combined tab switch, the
 * per-channel VU bar strip, and the MidiPreview (score + coil lanes). Purely
 * presentational — the parent owns the engine and feeds the live frame data.
 *
 * `level`/`backgrounds`/`mapped` are 16-slot arrays indexed by MIDI channel:
 * `level` is the parent's reactive bar-height array (mutated each RAF frame —
 * reading it here stays reactive), `backgrounds`/`mapped` are derived from the
 * song's coil mapping.
 */
type Viz = 'vu' | 'roll' | 'lanes' | 'combined';
const viz = defineModel<Viz>('viz', { required: true });
const editParam = defineModel<CoilParam>('editParam', { required: true });
const props = defineProps<{
  level: number[];
  backgrounds: string[];
  mapped: boolean[];
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  coilCount: number;
  output2Mask: number;
  playheadMs: number;
  playing: boolean;
  paused: boolean;
  events: CoilEvent[];
  compact: boolean;
}>();

// MidiPreview's view: 'combined' passes through; otherwise score (roll) or coils (lanes).
const previewView = computed<'roll' | 'lanes' | 'combined'>(() => {
  if (viz.value === 'combined') return 'combined';
  return viz.value === 'lanes' ? 'lanes' : 'roll';
});
</script>

<template>
  <div class="player-viz">
    <segmented-control v-model="viz" class="player-viz__tabs" :options="[
      { value: 'vu', label: $t('label.viewVu'), icon: 'fa-chart-simple' },
      { value: 'roll', label: $t('label.viewScore'), icon: 'fa-music' },
      { value: 'lanes', label: $t('label.viewCoils'), icon: 'fa-bolt' },
      { value: 'combined', label: $t('label.viewCombined'), icon: 'fa-layer-group' },
    ]" />

    <div class="player-viz__body">
      <div v-show="viz === 'vu'" class="vu">
        <span class="vu__label">{{ $t('label.channels') }}</span>
        <div class="vu-strip">
          <div v-for="i in MIDI_CHANNEL_COUNT" :key="i - 1" class="vu-chan">
            <div class="vu-track" :class="{ 'is-unmapped': !mapped[i - 1] }">
              <div class="vu-fill"
                :style="{ height: (props.level[i - 1] * 100) + '%', background: backgrounds[i - 1] }"></div>
            </div>
            <span class="vu-num">{{ i - 1 }}</span>
          </div>
        </div>
      </div>
      <midi-preview v-if="viz !== 'vu'" :analysis="analysis" :coils="coils"
        :coil-count="coilCount" :output2-mask="output2Mask"
        :view="previewView" :playhead-ms="playheadMs" :playing="playing" :paused="paused"
        :events="events" v-model:edit-param="editParam" :compact="compact" />
    </div>
  </div>
</template>
