<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import PlaybackMode from '@/components/play/PlaybackMode.vue';
import LiveMode from '@/components/play/LiveMode.vue';
import FixedMode from '@/components/play/FixedMode.vue';

type PlayMode = 'playback' | 'live' | 'fixed';

const MODES: { id: PlayMode; icon: string; key: string }[] = [
  { id: 'playback', icon: 'fa-list-ul', key: 'label.modePlayback' },
  { id: 'live', icon: 'fa-bolt', key: 'label.modeLive' },
  { id: 'fixed', icon: 'fa-wave-square', key: 'label.modeFixed' },
];
const STORAGE_KEY = 'playMode';

const stored = localStorage.getItem(STORAGE_KEY) as PlayMode | null;
const mode = ref<PlayMode>(
  stored && MODES.some((m) => m.id === stored) ? stored : 'playback',
);
watch(mode, (m) => localStorage.setItem(STORAGE_KEY, m));

const activeComponent = computed(
  () => ({ playback: PlaybackMode, live: LiveMode, fixed: FixedMode })[mode.value],
);
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.play') }}</h1>
      <div class="segmented mode-switch">
        <button
          v-for="m in MODES"
          :key="m.id"
          type="button"
          :class="{ 'is-active': mode === m.id }"
          @click="mode = m.id"
        >
          <span class="icon"><i class="fas" :class="m.icon"></i></span>
          <span class="mode-switch__label">{{ $t(m.key) }}</span>
        </button>
      </div>
    </header>

    <div class="screen-body" :class="{ 'screen-body--fill': mode === 'playback' }">
      <component :is="activeComponent" />
    </div>
  </div>
</template>
