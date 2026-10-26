<script setup lang="ts">
import { beginner } from '@/ui/helpers/ui-mode';
import { computed, markRaw, provide, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/app/stores/midi';
import { MidFile, type MidiAnalysis } from '@/model/midi/analyze';
import { fileUrl } from '@/app/song-file';
import { coilColor, PLACE_COLORS } from '@/ui/helpers/coil-colors';
import type { Song } from '@/model/domain';
import VizTabs from '@/ui/components/player/VizTabs.vue';
import OutputStrips from '@/ui/components/player/OutputStrips.vue';
import PlayerPower from '@/ui/components/player/PlayerPower.vue';
import BoardAlert from '@/ui/components/player/BoardAlert.vue';
import BoardSyncPrompt from '@/ui/components/player/BoardSyncPrompt.vue';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import { PhyStage } from '@/model/coils/stage';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import { useLeaveGuard } from '@/ui/helpers/leave-guard';
import { tour } from '@/ui/tour/tour';
import { stage } from '@/ui/helpers/stage';
import { parseSmf } from '@/engine/midi/smf';
import { ICONS } from '@/ui/helpers/icons';
import { useLivePower } from './use-live-power';
import { usePlayback } from './use-playback';
import { usePlayerStrips } from './use-player-strips';
import { useSeekBar } from './use-seek-bar';

const emit = defineEmits<{
  (e: 'songFinished'): void;
  (e: 'playingChange', value: boolean): void;
  /** The queue's previous and next songs (the transport's ⏮ ⏭, with `queue`). */
  (e: 'prev'): void;
  (e: 'next'): void;
  /** The heard position, a few times a second while playing and on every seek. */
  (e: 'position', ms: number): void;
}>();
const props = withDefaults(defineProps<{
  showAutoplay?: boolean;
  compactGraph?: boolean;
  /** 'bar': the transport and the global Power on one line, for the song editor's toolbar. */
  variant?: 'panel' | 'bar';
  /** A queue to step through: the transport gets ⏮ ⏭. */
  queue?: boolean;
  hasPrev?: boolean;
  hasNext?: boolean;
}>(), {
  showAutoplay: true,
  compactGraph: false,
  variant: 'panel',
  queue: false,
  hasPrev: false,
  hasNext: false,
});
// the songs, playlists and queue, in a drawer over the view (the `drawer` slot)
const drawer = defineModel<boolean>('drawer', { default: false });
const midiStore = useMidiStore();
const { t } = useI18n();

// the song as given, the way of it the stage plays (its own coils, or a variant), and that way
// as the board plays it: each place on the output its coil (or a twin of it) is wired to (model/coils/stage.ts)
const given = ref<Song | null>(null);
const chosen = computed(() => (given.value ? new PhyStage(midiStore.coilList).chooseWay(given.value, midiStore.outputOf) : null));
const staged = computed(() => (chosen.value ? new PhyStage(midiStore.coilList).onStage(chosen.value.song, midiStore.outputOf) : null));
const song = computed(() => staged.value?.song ?? null);
// the places whose coil is on no output, nor a twin of it: they don't play
const offStage = computed(() => staged.value?.missing ?? []);
// a named variant says which one plays (its coils are on the strips); a twin, whom it stands in for
const wayLabel = computed(() => chosen.value?.variant?.name?.trim() ?? '');
const twinNotes = computed(() => (staged.value?.twins ?? []).map((x) => ({
  key: x.place, text: t('player.twinPlays', { twin: x.twin.name, coil: x.coil.name }),
})));
// the song as played: its coils are outputs, in their fibres' colours (the editor's places too)
provide(PLACE_COLORS, coilColor);
// the parsed file and its analysis: thousands of notes, replaced whole and read in loops (the
// simulation, the views): kept out of Vue's deep proxies
const parsedMidiFile = shallowRef<unknown>(null);
const analysis = shallowRef<MidiAnalysis | null>(null);
type Viz = 'roll' | 'load' | 'combined' | '3d';
// the coil lanes' tab became the load's
const storedViz = localStorage.getItem('playerViz');
// the coil lanes' tab became the load's; the VU is no more: the coils on stage instead
const viz = ref<Viz>(storedViz === 'lanes' ? 'load' : !storedViz || storedViz === 'vu' ? '3d' : (storedViz as Viz));
watch(viz, (v) => localStorage.setItem('playerViz', v));
// a beginner has the score and the 3D: the load views show the 3D, the choice kept for Expert
const shownViz = computed<Viz>({
  get: () => (beginner.value && (viz.value === 'load' || viz.value === 'combined') ? '3d' : viz.value),
  set: (v) => { viz.value = v; },
});

const durationMs = computed(() => analysis.value?.durationMs ?? 0);
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// the bar's clock, to the tenth: a passage is found by ear
function fmtTenths(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100));
  return `${Math.floor(t / 600)}:${String(Math.floor(t / 10) % 60).padStart(2, '0')}.${t % 10}`;
}

const power = useLivePower();
const { masterPower, powerMax, powerBoost, masterDirty, powerCapped } = power;
const playback = usePlayback({
  song, parsed: parsedMidiFile, analysis, durationMs, powerOf: power.powerOf,
  onPlayingChange: (playing) => emit('playingChange', playing),
  onFinished: () => emit('songFinished'),
});
const { isPlaying, paused, playheadMs, clock, togglePlayPause, seek, stop, executeConfig, applyLive } = playback;
const { sim, loadCoils, strips, masterMarks } = usePlayerStrips({ song, analysis, isPlaying, playheadMs, power, active: () => props.variant !== 'bar' });
const { scrubbing, scrubMs, seekPct, onSeekDown, onSeekKey, seekBy } = useSeekBar(durationMs, playheadMs, () => !!song.value, seek);

// a song with no variant for the stage doesn't play on it (the editor's bar plays what it can, to listen)
const fitsStage = computed(() => props.variant === 'bar' || (chosen.value?.fits ?? true));
const canTransport = computed(() => !!parsedMidiFile.value && !!midiStore.midiOutput && !midiStore.boardLatched && fitsStage.value);
// the song's coils past the board's outputs (the built-in synth plays them all)
const mutedCoils = computed(() => {
  if (!song.value || midiStore.isSynthOutput) return '';
  const outputs = midiStore.deviceProfile.coils;
  const muted = Array.from({ length: Math.max(0, song.value.coilCount - outputs) }, (_, i) => outputs + i);
  return muted.length ? t('board.mutedCoils', { list: muted.join(', ') }, muted.length) : '';
});
const canStop = computed(() => isPlaying.value || paused.value);
const canPanic = computed(() => !!midiStore.midiOutput);
const canSysex = computed(() => !!song.value && !!midiStore.midiOutput);

function onAutoplayToggle(e: Event): void {
  midiStore.setAutoplay((e.target as HTMLInputElement).checked);
}

let loadedPath: string | null = null;
function loadSong(s: Song): void {
  const newPath = s.midiFile ? fileUrl(s.midiFile) : null;
  const before = song.value;
  given.value = s; // always reflect the latest config (legend, VU colours, etc.)
  if (isPlaying.value && newPath === loadedPath && before && song.value) playback.applyEdits(before, song.value);
  playback.cancelAutoplay(); // a plain load cancels any pending auto-start
  if (newPath === loadedPath) return; // same MIDI (or none) → config-only, no reparse
  stop();
  loadedPath = newPath;
  parsedMidiFile.value = null;
  analysis.value = null;
  if (!newPath) return; // config-only song: nothing to stream
  loadMidiFile(newPath)
    .then((buffer) => {
      parsedMidiFile.value = markRaw(parseSmf(buffer) as object);
      analysis.value = markRaw(new MidFile(parsedMidiFile.value).analysis());
      playback.ready();
    })
    .catch((err) => {
      // surface the failure and reset so a retry re-parses; don't leave a pending autostart
      playback.cancelAutoplay();
      loadedPath = null;
      console.error('Failed to load MIDI file', newPath, err);
    });
}

/** Load a song and start playing as soon as its MIDI is ready (queue use). */
function playSong(s: Song): void {
  loadSong(s);
  if (parsedMidiFile.value) playback.play(); // already parsed (same file) → play now
  else playback.playWhenReady(); // otherwise auto-start after the parse resolves
}

// the editor offers to add an automation point where the song is: a few updates a
// second are plenty for that (and every seek or pause, when the value settles)
let lastPositionEmit = 0;
watch(playheadMs, (ms) => {
  const now = performance.now();
  if (isPlaying.value && now - lastPositionEmit < 200) return;
  lastPositionEmit = now;
  emit('position', ms);
});

const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => isPlaying.value && !tour.active);

// the live power reaches the coils: at once on a release, a few times a second while a fader moves
watch(masterPower, playback.applyLiveSoon);
function setMaster(value: number): void {
  masterPower.value = value;
}
function onPowerChange(): void {
  power.snapHome();
  applyLive();
}
function toggleCap(): void {
  if (power.toggleCap()) applyLive();
}
/** The keyboard's power step: the general Power, never past the cap. */
function nudgePower(delta: number): void {
  power.nudge(delta);
  applyLive();
}
function resetPower(): void {
  power.reset();
  applyLive();
}
// The strips are controlled: a coil's drag streams back via @power-input (stored here,
// the strip follows), @power-change fires on release (→ applyLive).
function onCoilInput(key: string, value: number): void {
  power.coilPower[key] = value;
  playback.applyLiveSoon();
}

function loadMidiFile(url: string): Promise<ArrayBuffer> {
  // the editor's unsaved envelopes (blob:): axios would put the API's base URL in front
  if (url.startsWith('blob:')) return fetch(url).then((r) => r.arrayBuffer());
  return axios.get(url, { responseType: 'arraybuffer' }).then((r) => r.data as ArrayBuffer);
}

/** Where the song is heard, as of this frame: for a playhead drawn every frame, past the throttled 'position'. */
function positionMs(): number {
  return clock();
}

defineExpose({ loadSong, playSong, stop, togglePlayPause, seek, seekBy, nudgePower, positionMs });
</script>

<template>
  <div v-if="variant === 'bar'" class="player-bar">
    <button class="player-bar__play" type="button" :class="{ 'is-on': isPlaying }" :disabled="!canTransport"
      :title="isPlaying ? $t('player.pause') : $t('player.play')" :aria-label="isPlaying ? $t('player.pause') : $t('player.play')"
      @click="togglePlayPause"><i class="fas" :class="isPlaying ? 'fa-pause' : 'fa-play'"></i></button>
    <button class="icon-btn icon-btn--sm" type="button" :disabled="!canStop" :title="$t('player.stop')"
      :aria-label="$t('player.stop')" @click="stop"><i class="fas fa-stop"></i></button>
    <span class="player-bar__time">{{ fmtTenths(playheadMs) }} <span>/ {{ fmtTenths(durationMs) }}</span></span>
    <label class="player-bar__power" :title="$t('label.powerHint')">
      <i class="fas" :class="ICONS.power"></i><span class="player-bar__label">{{ $t('label.power') }}</span>
      <input class="power-range player-bar__range" type="range" min="0" :max="powerMax" step="1" :value="masterPower"
        :disabled="!song" :aria-label="$t('label.power')" @input="setMaster(Number(($event.target as HTMLInputElement).value))"
        @change="onPowerChange">
      <b class="player-bar__pct" :class="{ 'is-boost': powerBoost }">{{ masterPower }} %</b>
    </label>
    <button class="icon-btn icon-btn--sm player-bar__panic" type="button" :disabled="!canPanic" :title="$t('player.panicHint')"
      :aria-label="$t('player.panic')" @click="midiStore.panic()"><i class="fas fa-bell-slash"></i></button>
    <confirm-modal :open="leavePending" :title="$t('player.leaveTitle')"
      :message="$t('player.leaveQuestion', { name: song?.name ?? '' })" :confirm-label="$t('player.leaveConfirm')"
      :cancel-label="$t('player.stay')" @confirm="answerLeave(true)" @close="answerLeave(false)" />
  </div>
  <article v-else class="player-panel player-stage">
    <header class="player-panel__head player-top">
      <button v-if="$slots.drawer" class="btn player-top__songs" :class="{ 'btn--volt is-open': drawer }" type="button"
        :aria-expanded="drawer" :title="$t('player.drawerHint')" @click="drawer = !drawer">
        <span class="icon"><i class="fas fa-music"></i></span><span class="player-top__songs-label">{{ $t('player.drawer') }}</span>
      </button>
      <span class="player-top__song">
        <span v-if="song" class="player-top__name">{{ song.name }}</span>
        <span v-else class="player-song__empty">{{ $t('label.noSongLoaded') }}</span>
      </span>
      <span v-if="wayLabel && chosen?.fits && !beginner" class="player-way" :title="$t('player.wayHint')"><i class="fas fa-code-branch"></i>{{ wayLabel }}</span>
      <span v-for="n in beginner ? [] : twinNotes" :key="n.key" class="player-way is-twin" :title="$t('player.twinHint')"><i
          class="fas fa-link"></i>{{ n.text }}</span>
      <!-- on stage the sidebar, which says it, is out of the way -->
      <span v-if="midiStore.isSynthOutput && stage.on" class="player-synth-badge"><i class="fas" :class="ICONS.synth"></i>{{
        $t('label.synthActive') }}</span>
      <span v-if="mutedCoils" class="player-muted" :title="$t('board.mutedHint', { n: midiStore.deviceProfile.coils })">
        <i class="fas fa-volume-xmark"></i>{{ mutedCoils }}
      </span>
      <span class="player-top__sp"></span>
      <slot name="next" />
      <label v-if="props.showAutoplay" class="switch player-panel__autoplay">
        <input type="checkbox" :checked="midiStore.autoplay" @change="onAutoplayToggle" />
        <span class="switch__track"></span>
        <span class="switch__text">{{ $t('label.autoplay') }}</span>
      </label>
      <drop-menu v-if="!beginner" :label="$t('player.more')">
        <button class="dropdown__item" type="button" :disabled="!canSysex" @click="executeConfig">
          <i class="fas fa-wrench"></i><span>{{ $t('label.executeConfiguration') }}</span>
        </button>
      </drop-menu>
    </header>

    <p v-if="midiStore.outputLost" class="player-alert" role="alert">
      <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>
      <span class="player-alert__text">{{ $t('player.outputLost', { name: midiStore.outputLost }) }}</span>
      <button class="icon-btn player-alert__x" type="button" :aria-label="$t('player.dismiss')"
        :title="$t('player.dismiss')" @click="midiStore.setOutputLost(null)"><i class="fas fa-xmark"></i></button>
    </p>
    <board-alert />
    <board-sync-prompt />
    <p v-if="song && !fitsStage" class="player-alert player-alert--warn" role="status">
      <span class="icon"><i class="fas fa-plug-circle-exclamation"></i></span>
      <span class="player-alert__text">{{ $t('stage.missing', { names: offStage.map((m) => m.coil?.name ?? `#${m.place}`).join(', ') }) }}</span>
    </p>
    <p v-if="!midiStore.midiOutput" class="player-hint">
      <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
    </p>

    <!-- the view, the outputs on its edge, the songs in a drawer over it -->
    <div class="player-canvas">
      <viz-tabs v-model:viz="shownViz" :analysis="analysis" :coils="song?.coils ?? []"
        :output2-mask="song?.output2Mask ?? 0" :playhead-ms="playheadMs" :clock="clock" :playing="isPlaying" :paused="paused"
        :compact="compactGraph" :sim="sim" :load-coils="loadCoils" :stereo="song?.stereo ?? null">
        <button v-if="!song && !drawer && $slots.drawer" class="btn btn--volt player-viz__pick" type="button" @click="drawer = true">
          <span class="icon"><i class="fas fa-music"></i></span>{{ $t('player.pickSong') }}
        </button>
      </viz-tabs>
      <output-strips :strips="strips" :off-stage="offStage" :max="powerMax" :master="masterPower" :simple="beginner" @power-input="onCoilInput"
        @power-change="applyLive">
        <template #master>
          <player-power :master-power="masterPower" @update:master-power="setMaster" :marks="masterMarks" :dirty="masterDirty" :has-song="!!song"
            :capped="powerCapped" :max="powerMax" :simple="beginner" @power-change="onPowerChange" @reset="resetPower" @toggle-cap="toggleCap" />
        </template>
      </output-strips>
      <div v-if="drawer && $slots.drawer" class="player-drawer">
        <slot name="drawer" />
        <button class="icon-btn icon-btn--sm player-drawer__x" type="button" :title="$t('label.close')" :aria-label="$t('label.close')"
          @click="drawer = false"><i class="fas fa-xmark"></i></button>
      </div>
    </div>

    <!-- what the hand reaches for, whatever the view: the transport, where the song is, Panic -->
    <div class="player-transport player-dock">
      <div class="player-dock__tr">
        <button v-if="queue" class="icon-btn" type="button" :disabled="!hasPrev" :title="$t('player.prevSong')"
          :aria-label="$t('player.prevSong')" @click="emit('prev')"><i class="fas fa-backward-step"></i></button>
        <button class="player-dock__play" type="button" :class="{ 'is-on': isPlaying }" :disabled="!canTransport"
          :title="isPlaying ? $t('player.pause') : $t('player.play')" :aria-label="isPlaying ? $t('player.pause') : $t('player.play')"
          @click="togglePlayPause"><i class="fas" :class="isPlaying ? 'fa-pause' : 'fa-play'"></i></button>
        <button class="icon-btn player-dock__stop" type="button" :disabled="!canStop" :title="$t('player.stop')"
          :aria-label="$t('player.stop')" @click="stop"><i class="fas fa-stop"></i></button>
        <button v-if="queue" class="icon-btn" type="button" :disabled="!hasNext" :title="$t('player.nextSong')"
          :aria-label="$t('player.nextSong')" @click="emit('next')"><i class="fas fa-forward-step"></i></button>
      </div>
      <!-- playback progress (click / drag to seek) -->
      <div class="player-progress">
        <span class="player-progress__time">{{ fmt(scrubbing ? scrubMs : playheadMs) }}</span>
        <div class="player-progress__bar" :class="{ 'is-scrubbing': scrubbing, 'is-empty': !song }" ref="seekBar" @pointerdown="onSeekDown"
          :title="$t('label.seek')" role="slider" :tabindex="song ? 0 : -1" :aria-label="$t('label.seek')" aria-valuemin="0"
          :aria-valuemax="Math.round(durationMs / 1000)" :aria-valuenow="Math.round(playheadMs / 1000)"
          :aria-valuetext="`${fmt(playheadMs)} / ${fmt(durationMs)}`" @keydown="onSeekKey">
          <div class="player-progress__fill" :style="{ width: seekPct + '%' }"></div>
          <div class="player-progress__knob" :style="{ left: seekPct + '%' }"></div>
        </div>
        <span class="player-progress__time">{{ fmt(durationMs) }}</span>
      </div>
      <!-- .btn--danger: every look dresses it as its own red; control/_chrome.scss sets it apart -->
      <button class="btn btn--danger btn--panic player-dock__panic" type="button" :disabled="!canPanic" :title="$t('player.panicHint')"
        @click="midiStore.panic()">
        <span class="icon"><i class="fas fa-bell-slash"></i></span>{{ $t('player.panic') }}
      </button>
    </div>

    <confirm-modal :open="leavePending" :title="$t('player.leaveTitle')"
      :message="$t('player.leaveQuestion', { name: song?.name ?? '' })" :confirm-label="$t('player.leaveConfirm')"
      :cancel-label="$t('player.stay')" @confirm="answerLeave(true)" @close="answerLeave(false)" />
  </article>
</template>
