<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMidiStore } from '@/stores/midi';
import PlaybackMode from '@/components/player/PlaybackMode.vue';
import LiveMode from '@/components/player/LiveMode.vue';
import FixedMode from '@/components/player/FixedMode.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';
import { confirmLeaveInPlace } from '@/utils/leave-guard';
import { mobileLayout } from '@/ui/viewport';
import { tour } from '@/tour/tour';

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

// the mode's component goes, and what it plays with it: it may ask first
async function requestMode(next: PlayMode): Promise<void> {
  if (next === mode.value || !(await confirmLeaveInPlace())) return;
  mode.value = next;
}
// the phone layout plays songs only (its mode switch is hidden)
watch(mobileLayout, (mobile) => { if (mobile) void requestMode('playback'); }, { immediate: true });

function inTextField(el: EventTarget | null): boolean {
  return el instanceof HTMLElement
    && !!el.closest('textarea, select, [contenteditable="true"], input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"])');
}
// Esc = Panic, as on show-control desks; unless it closes something open over the page
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || tour.active || inTextField(e.target)) return;
  // popover menus stay in the DOM while closed: only a shown one counts
  const open = document.querySelectorAll('.modal-overlay, .sidebar-menu, [role="menu"], [role="listbox"]');
  if ([...open].some((el) => el.getClientRects().length > 0)) return;
  midiStore.panic();
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

const headerScrolled = ref(false);
let scrollEl: HTMLElement | null = null;

function onScroll(): void {
  headerScrolled.value = (scrollEl?.scrollTop ?? 0) > 6;
}

onMounted(() => {
  scrollEl = document.querySelector('.app-main');
  if (scrollEl) {
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // Vérification initiale
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
      <segmented-control :model-value="mode" class="mode-switch mode-switch--play" label-class="mode-switch__label"
        @update:model-value="requestMode" :options="MODES.map((m) => ({
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
