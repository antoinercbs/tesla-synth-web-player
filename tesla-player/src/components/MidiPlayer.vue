<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { compileCoilConfig, maskToChannels } from '@/sysex/syntherrupter';
import { coilColor } from '@/ui/coil-colors';
import { MIDI_CHANNEL_COUNT } from '@/types/domain';
import type { Song } from '@/types/domain';
import SmfParser from '@/smfplayer/js/smfParser.js';
import SmfPlayer from '@/smfplayer/js/smfPlayer.js';

const emit = defineEmits<{
  (e: 'songFinished'): void;
  (e: 'playingChange', value: boolean): void;
}>();
const midiStore = useMidiStore();

const song = ref<Song | null>(null);
const parsedMidiFile = ref<unknown>(null);
const isPlaying = ref(false);
const ontimeRatio = ref(100);
const dutyRatio = ref(100);
// per-channel "lit" flag (note activity, with a short decay) — drives the LEDs
const litChannels = reactive<boolean[]>(Array(MIDI_CHANNEL_COUNT).fill(false));
const ledTimers: Array<ReturnType<typeof setTimeout> | null> = Array(MIDI_CHANNEL_COUNT).fill(null);

interface SmfPlayerInstance {
  init(midi: unknown, latency: number, eventNo: number): void;
  startPlay(): void;
  stopPlay(): void;
  finished: boolean;
  dispEventMonitor: (msg: unknown[], type: unknown) => void;
}
let smfPlayer: SmfPlayerInstance | null = null;
let finishedTimer: ReturnType<typeof setInterval> | null = null;
let loadedPath: string | null = null;

const canPlay = computed(() => !!parsedMidiFile.value && !!midiStore.midiOutput && !isPlaying.value);
const canStop = computed(() => isPlaying.value);
const canPanic = computed(() => !!midiStore.midiOutput);
const canSysex = computed(() => !!song.value && !!midiStore.midiOutput);

/** All coil colours a channel feeds (a channel can drive several coils at once). */
function channelColors(ch: number): string[] {
  return (song.value?.coils ?? [])
    .filter((c) => (c.channelMask & (1 << ch)) !== 0)
    .map((c) => coilColor(c.coilIndex));
}
/** Bar fill: solid colour, or horizontal colour bands per coil fed, with a
 *  short soft blend at each junction (mostly distinct, slightly feathered). */
function channelBackground(ch: number): string {
  const cols = channelColors(ch);
  if (cols.length === 0) return 'var(--volt)';
  if (cols.length === 1) return cols[0];
  const n = cols.length;
  const band = 100 / n;
  const blend = band * 0.5; // half-width of the cross-fade between adjacent bands
  const stops = cols
    .flatMap((c, k) => {
      const start = k === 0 ? 0 : k * band + blend;
      const end = k === n - 1 ? 100 : (k + 1) * band - blend;
      return [`${c} ${start.toFixed(2)}%`, `${c} ${end.toFixed(2)}%`];
    })
    .join(', ');
  return `linear-gradient(90deg, ${stops})`;
}
function channelMapped(ch: number): boolean {
  return (song.value?.coils ?? []).some((c) => (c.channelMask & (1 << ch)) !== 0);
}

function resetNotes(): void {
  for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) {
    litChannels[i] = false;
    const t = ledTimers[i];
    if (t) { clearTimeout(t); ledTimers[i] = null; }
  }
}

function loadSong(s: Song): void {
  const newPath = s.midiFile?.path ?? null;
  song.value = s; // always reflect the latest config (legend, VU colours, etc.)
  if (newPath === loadedPath) return; // same MIDI (or none) → config-only, no reparse
  stop();
  loadedPath = newPath;
  parsedMidiFile.value = null;
  resetNotes();
  if (!newPath) return; // config-only song: nothing to stream
  loadMidiFile(newPath).then((buffer) => {
    const parser = new SmfParser();
    parsedMidiFile.value = parser.parse(arrayBufferToString(buffer));
  });
}

function executeConfig(): void {
  if (!song.value) return;
  for (const frame of compileCoilConfig(song.value.coils ?? [], song.value.mode ?? 'midi')) {
    midiStore.sendSysex(frame);
  }
}

function play(): void {
  if (!parsedMidiFile.value || !midiStore.midiOutput) return;
  stop();
  isPlaying.value = true;
  emit('playingChange', true);
  resetNotes();
  executeConfig();
  const coilUnion = (song.value?.coils ?? []).reduce((m, c) => m | c.channelMask, 0);
  const ch1 = maskToChannels(coilUnion);
  const ch2 = maskToChannels(song.value?.output2Mask ?? 0);
  smfPlayer = new SmfPlayer(midiStore.midiOutput, midiStore.midiOutput2, ch1, ch2) as unknown as SmfPlayerInstance;
  smfPlayer.dispEventMonitor = dispEventMonitor;
  smfPlayer.init(parsedMidiFile.value, 800, 0);
  smfPlayer.startPlay();
  finishedTimer = setInterval(() => {
    if (smfPlayer?.finished) {
      emit('songFinished');
      stop();
    }
  }, 100);
}

function stop(): void {
  if (finishedTimer) { clearInterval(finishedTimer); finishedTimer = null; }
  if (isPlaying.value) emit('playingChange', false);
  isPlaying.value = false;
  if (smfPlayer) smfPlayer.stopPlay();
  resetNotes();
}

function panic(): void {
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
}

function onOntimeRatioChange(): void {
  midiStore.sendLiveOntimeAdjust({ coils: song.value?.coils ?? [], ratio: ontimeRatio.value });
}
function onDutyRatioChange(): void {
  midiStore.sendLiveDutyAdjust({ coils: song.value?.coils ?? [], ratio: dutyRatio.value });
}

function loadMidiFile(path: string): Promise<ArrayBuffer> {
  return axios
    .get(path.replace(/^\./, ''), { responseType: 'arraybuffer' })
    .then((r) => r.data as ArrayBuffer);
}

/** Status byte of a SMF event (handles numeric or "0xNN" string forms). */
function statusByte(m0: unknown): number {
  if (typeof m0 === 'number') return m0;
  if (typeof m0 === 'string') return parseInt(m0.replace(/^0x/i, ''), 16) || 0;
  return 0;
}
function flashChannel(ch: number): void {
  litChannels[ch] = true;
  const t = ledTimers[ch];
  if (t) clearTimeout(t);
  ledTimers[ch] = setTimeout(() => { litChannels[ch] = false; ledTimers[ch] = null; }, 220);
}
function dispEventMonitor(msg: unknown[], type: unknown): void {
  if (type === 'input') return;
  const st = statusByte(msg[0]);
  if ((st & 0xf0) === 0x90) flashChannel(st & 0x0f); // note-on → flash the channel
}

function arrayBufferToString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(binary));
  } catch (e) {
    if (e instanceof URIError) return binary;
    throw e;
  }
}

onBeforeUnmount(() => stop()); // stop playback + clear timers if the player unmounts

defineExpose({ loadSong });
</script>

<template>
  <article class="player-panel">
    <header class="player-panel__head">
      <span class="icon"><i class="fas fa-sliders"></i></span>{{ $t('title.player') }}
    </header>

    <div class="player-song">
      <span class="icon"><i class="fas fa-music"></i></span>
      <span v-if="song" class="player-song__name">{{ song.name }}</span>
      <span v-else class="player-song__empty">{{ $t('label.noSongLoaded') }}</span>
      <span v-if="song" class="player-legend" :title="$t('label.coils')">
        <span class="player-legend__label"><span class="icon"><i class="fas fa-bolt"></i></span></span>
        <span class="coil-legend">
          <span v-for="i in song.coilCount" :key="i - 1" class="coil-legend__chip" :style="{ '--c': coilColor(i - 1) }"
            :title="`${$t('label.coil')} ${i - 1}`">{{ i - 1 }}</span>
        </span>
      </span>
    </div>

    <p v-if="!midiStore.midiOutput" class="player-hint">
      <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
    </p>
    <p v-else-if="!song" class="player-hint">
      <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.loadSongHint') }}
    </p>

    <div class="vu">
      <span class="vu__label">{{ $t('label.channels') }}</span>
      <div class="vu-strip">
        <div v-for="i in MIDI_CHANNEL_COUNT" :key="i - 1" class="vu-chan">
          <div class="vu-track" :class="{ 'is-unmapped': !channelMapped(i - 1) }">
            <div class="vu-fill"
              :style="{ height: litChannels[i - 1] ? '100%' : '0%', background: channelBackground(i - 1) }"></div>
          </div>
          <span class="vu-num">{{ i - 1 }}</span>
        </div>
      </div>
    </div>

    <div class="player-faders">
      <label class="fader">
        <span class="fader__top">
          <span class="fader__key">{{ $t('label.ontime') }}</span>
          <span class="fader__val">{{ ontimeRatio }}%</span>
        </span>
        <input class="fader__range" type="range" min="0" max="200" step="1" v-model.number="ontimeRatio"
          :disabled="!song" :title="$t('label.ontimeRatio')" @change="onOntimeRatioChange">
      </label>
      <label class="fader">
        <span class="fader__top">
          <span class="fader__key">{{ $t('label.duty') }}</span>
          <span class="fader__val">{{ dutyRatio }}%</span>
        </span>
        <input class="fader__range" type="range" min="0" max="200" step="1" v-model.number="dutyRatio" :disabled="!song"
          :title="$t('label.dutyRatio')" @change="onDutyRatioChange">
      </label>
    </div>

    <div class="player-transport">
      <button class="btn btn--volt" type="button" :disabled="!canPlay" @click="play">
        <span class="icon"><i class="fas fa-play"></i></span>Play
      </button>
      <button class="btn" type="button" :disabled="!canStop" @click="stop">
        <span class="icon"><i class="fas fa-stop"></i></span>Stop
      </button>
      <button class="btn" type="button" :disabled="!canPanic" @click="panic">
        <span class="icon"><i class="fas fa-bell-slash"></i></span>Panic
      </button>
      <button class="btn" type="button" :disabled="!canSysex" @click="executeConfig">
        <span class="icon"><i class="fas fa-wrench"></i></span>{{ $t('label.executeConfiguration') }}
      </button>
    </div>
  </article>
</template>
