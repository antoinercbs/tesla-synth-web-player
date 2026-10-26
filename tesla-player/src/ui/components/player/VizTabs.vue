<script setup lang="ts">
import { beginner } from '@/ui/helpers/ui-mode';
import { computed } from 'vue';
import type { CoilConfig, SongStereo } from '@/model/domain';
import type { MidiAnalysis } from '@/model/midi/analyze';
import type { CoilLimits } from '@/model/devices/coil-limits';
import type { DevSimulation } from '@/model/devices/simulation';
import MidiPreview from '@/ui/components/player/MidiPreview.vue';
import CoilLoadView from '@/ui/components/player/CoilLoadView.vue';
import Coils3dView from '@/ui/components/player/Coils3dView.vue';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';

/**
 * The visualisation block: the score / load / combined / 3D tab switch, the
 * MidiPreview (score, or score + coil lanes), the coils' load as the board
 * plays them (CoilLoadView), the coils in 3D with their arcs (Coils3dView).
 * Purely presentational — the parent owns the engine and feeds the playhead.
 * The default slot sits over the middle of the view (the player's "choose a song").
 */
type Viz = 'roll' | 'load' | 'combined' | '3d';
const viz = defineModel<Viz>('viz', { required: true });
const props = defineProps<{
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  output2Mask: number;
  playheadMs: number;
  /** Where the song is heard, read every frame while it plays. */
  clock?: (() => number) | null;
  playing: boolean;
  paused: boolean;
  compact: boolean;
  /** What the board makes of the song (model/devices/simulation), for the load and combined tabs. */
  sim?: DevSimulation | null;
  loadCoils?: { coilIndex: number; name: string; limits: CoilLimits | null }[];
  /** Where the song's spatialisation places its coils, for the 3D view. */
  stereo?: SongStereo | null;
}>();

// MidiPreview's view: the score, alone or above the coils' load
const previewView = computed<'roll' | 'combined'>(() => (viz.value === 'combined' ? 'combined' : 'roll'));
// while it plays the views follow the clock: a playhead handed down a few times a second would redraw them
const heldMs = computed(() => (props.playing ? 0 : props.playheadMs));
</script>

<template>
  <div class="player-viz">
    <segmented-control v-model="viz" class="player-viz__tabs" tabs :options="[
      { value: 'roll', label: $t('label.viewScore') },
      ...(beginner ? [] : [
        { value: 'load', label: $t('ontime.load.tab') },
        { value: 'combined', label: $t('label.viewCombined') },
      ]),
      { value: '3d', label: $t('player.view3d.tab') },
    ]" />

    <div class="player-viz__body">
      <coil-load-view v-if="viz === 'load' && sim" :sim="sim" :coils="loadCoils ?? []" :playhead-ms="playing || paused ? heldMs : null"
        :clock="clock" :playing="playing" :compact="compact" />
      <div v-else-if="viz === 'load'" class="viz-empty"></div>
      <coils-3d-view v-if="viz === '3d'" :sim="sim ?? null" :coils="coils" :stereo="stereo" :playhead-ms="heldMs" :clock="clock" :playing="playing" />
      <midi-preview v-if="viz === 'roll' || viz === 'combined'" :analysis="analysis" :coils="coils"
        :output2-mask="output2Mask" :view="previewView" :playhead-ms="heldMs" :clock="clock" :playing="playing" :paused="paused"
        :compact="compact" :sim="sim ?? null" :load-coils="loadCoils ?? []" />
      <slot />
    </div>
  </div>
</template>
