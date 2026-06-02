<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMidiStore } from '@/stores/midi';
import PlaybackMode from '@/components/player/PlaybackMode.vue';
import LiveMode from '@/components/player/LiveMode.vue';
import FixedMode from '@/components/player/FixedMode.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

type PlayMode = 'playback' | 'live' | 'fixed';

const midiStore = useMidiStore();
const MODES: { id: PlayMode; icon: string; key: string }[] = [
  { id: 'playback', icon: 'fa-play', key: 'label.modePlayback' },
  { id: 'live', icon: 'fa-tower-broadcast', key: 'label.modeLive' },
  { id: 'fixed', icon: 'fa-wave-square', key: 'label.modeFixed' },
];
const STORAGE_KEY = 'playMode';

const stored = localStorage.getItem(STORAGE_KEY) as PlayMode | null;
const mode = ref<PlayMode>(
  stored && MODES.some((m) => m.id === stored) ? stored : 'playback',
);
watch(mode, (m) => localStorage.setItem(STORAGE_KEY, m));

// Fixed (Simple) mode drives continuous coil tones — meaningless on the note-driven
// synth emulation, so it's disabled while the built-in synth is the output.
function modeDisabled(id: PlayMode): boolean {
  return id === 'fixed' && midiStore.isSynthOutput;
}
watch(() => midiStore.isSynthOutput, (synth) => {
  if (synth && mode.value === 'fixed') mode.value = 'playback';
}, { immediate: true });

const activeComponent = computed(
  () => ({ playback: PlaybackMode, live: LiveMode, fixed: FixedMode })[mode.value],
);
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.play') }}</h1>
      <segmented-control v-model="mode" class="mode-switch" label-class="mode-switch__label"
        :options="MODES.map((m) => ({
          value: m.id, label: $t(m.key), icon: m.icon,
          disabled: modeDisabled(m.id),
          title: modeDisabled(m.id) ? $t('label.fixedNeedsHardware') : '',
        }))" />
    </header>

    <div class="screen-body" :class="{ 'screen-body--fill': mode === 'playback' }">
      <component :is="activeComponent" />
    </div>
  </div>
</template>
