<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMidiStore } from '@/stores/midi';
import PlaybackMode from '@/components/player/PlaybackMode.vue';
import LiveMode from '@/components/player/LiveMode.vue';
import FixedMode from '@/components/player/FixedMode.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';
import ShortcutsModal from '@/components/player/ShortcutsModal.vue';
import { confirmLeaveInPlace } from '@/utils/leave-guard';
import { mobileLayout } from '@/ui/viewport';
import { tour } from '@/tour/tour';
import { inTextField, isPageKey, overlayOpen } from '@/ui/page-keys';
import { fullscreenAvailable, leaveStage, stage, toggleStage } from '@/ui/stage';
import { useWakeLock } from '@/utils/wake-lock';
import { ICONS } from '@/ui/icons';

type PlayMode = 'playback' | 'live' | 'fixed';

const midiStore = useMidiStore();
const MODES: { id: PlayMode; icon: string; key: string }[] = [
  { id: 'playback', icon: 'fa-play', key: 'label.modePlayback' },
  { id: 'live', icon: ICONS.live, key: 'label.modeLive' },
  { id: 'fixed', icon: ICONS.fixedMode, key: 'label.modeFixed' },
];
const STORAGE_KEY = 'playMode';

const stored = localStorage.getItem(STORAGE_KEY) as PlayMode | null;
const mode = ref<PlayMode>(
  stored && MODES.some((m) => m.id === stored) ? stored : 'playback',
);
watch(mode, (m) => localStorage.setItem(STORAGE_KEY, m));

// the mode's component goes, and what it plays with it: it may ask first
async function requestMode(next: PlayMode): Promise<void> {
  if (next === mode.value || !(await confirmLeaveInPlace())) return;
  mode.value = next;
}
// the phone layout plays songs only (its mode switch is hidden)
watch(mobileLayout, (mobile) => { if (mobile) void requestMode('playback'); }, { immediate: true });

// Esc = Panic, as on show-control desks; unless it closes something open over the page.
// ? shows the keys; F (Live plays notes on it) puts Playback on stage.
const shortcutsOpen = ref(false);
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (e.defaultPrevented || tour.active || inTextField(e.target) || overlayOpen()) return;
    midiStore.panic();
  } else if (e.key === '?' && isPageKey(e)) {
    e.preventDefault();
    shortcutsOpen.value = true;
  } else if (e.key.toLowerCase() === 'f' && !e.shiftKey && mode.value === 'playback' && isPageKey(e)) {
    e.preventDefault();
    toggleStage();
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  leaveStage();
});
useWakeLock(() => stage.on);

const headerScrolled = ref(false);
let scrollEl: HTMLElement | null = null;

function onScroll(): void {
  headerScrolled.value = (scrollEl?.scrollTop ?? 0) > 6;
}

onMounted(() => {
  scrollEl = document.querySelector('.app-main');
  if (scrollEl) {
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
});

onBeforeUnmount(() => {
  if (scrollEl) {
    scrollEl.removeEventListener('scroll', onScroll);
  }
});

const activeComponent = computed(
  () => ({ playback: PlaybackMode, live: LiveMode, fixed: FixedMode })[mode.value],
);
</script>

<template>
  <div class="screen">
    <header class="screen-head" :class="{ 'is-scrolled': headerScrolled }">
      <h1 class="view-head__title">{{ $t('nav.play') }}<page-tour-button id="play" /></h1>
      <div class="play-head__actions">
        <button class="icon-btn play-head__keys" type="button" :title="$t('player.keys.title')"
          :aria-label="$t('player.keys.title')" @click="shortcutsOpen = true">
          <i class="fas fa-keyboard"></i>
        </button>
        <button class="icon-btn" :class="{ 'is-on': stage.on }" type="button" :aria-pressed="stage.on"
          :title="$t(stage.on ? 'player.stageLeave' : 'player.stageEnter')"
          :aria-label="$t(stage.on ? 'player.stageLeave' : 'player.stageEnter')" @click="toggleStage">
          <i class="fas" :class="stage.on ? 'fa-compress' : fullscreenAvailable ? 'fa-expand' : 'fa-display'"></i>
        </button>
        <segmented-control :model-value="mode" class="mode-switch mode-switch--play" label-class="mode-switch__label"
          @update:model-value="requestMode" :options="MODES.map((m) => ({ value: m.id, label: $t(m.key), icon: m.icon }))" />
      </div>
    </header>

    <div class="screen-body" :class="{ 'screen-body--fill': mode === 'playback' }">
      <component :is="activeComponent" />
    </div>
    <shortcuts-modal :open="shortcutsOpen" @close="shortcutsOpen = false" />
  </div>
</template>
