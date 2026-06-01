<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { compileCoilConfig, coilEventFrame, maskToChannels } from '@/sysex/syntherrupter';
import { envelope, envelopeAmplitude } from '@/sysex/envelopes';
import { analyzeMidi, type MidiAnalysis } from '@/midi/analyze';
import { effectiveRatio } from '@/midi/automation';
import { coilColor } from '@/ui/coil-colors';
import { MIDI_CHANNEL_COUNT } from '@/types/domain';
import type { CoilConfig, CoilParam, Song } from '@/types/domain';
import MidiPreview from '@/components/play/MidiPreview.vue';
import SmfParser from '@/smfplayer/js/smfParser.js';
import SmfPlayer from '@/smfplayer/js/smfPlayer.js';

const emit = defineEmits<{
  (e: 'songFinished'): void;
  (e: 'playingChange', value: boolean): void;
}>();
const props = withDefaults(defineProps<{ showAutoplay?: boolean; compactGraph?: boolean }>(), {
  showAutoplay: true,
  compactGraph: false,
});
const midiStore = useMidiStore();

const song = ref<Song | null>(null);
const parsedMidiFile = ref<unknown>(null);
const isPlaying = ref(false);
// MIDI analysis + visualisation (VU / score / coil occupancy tabs)
const analysis = ref<MidiAnalysis | null>(null);
const playheadMs = ref(0);
type Viz = 'vu' | 'roll' | 'lanes' | 'combined';
const viz = ref<Viz>((localStorage.getItem('playerViz') as Viz) || 'vu');
watch(viz, (v) => localStorage.setItem('playerViz', v));
// which automation parameter the read-only coils view overlays
const playerParam = ref<CoilParam>('ontime');
// MidiPreview view: the combined (score+coils) mode is only offered when not compact
const previewView = computed<'roll' | 'lanes' | 'combined'>(() => {
  if (viz.value === 'combined') return props.compactGraph ? 'lanes' : 'combined';
  return viz.value === 'lanes' ? 'lanes' : 'roll';
});
let rafId: number | null = null;
let playStart = 0;
const ontimeRatio = ref(100);
const dutyRatio = ref(100);
// VU: at each frame we look up which notes sound at the playhead (from the static
// MIDI analysis), run each through its channel's Syntherrupter envelope, and set
// the bar = amplitude × the coil's ontime×duty energy. Driving it off the playhead
// (not live MIDI events) keeps it in sync with the score/coil views and immune to
// the player's look-ahead event scheduling (which fires note-off right after
// note-on, collapsing long notes to a flash).
const RELEASE_TAIL_MS = 260; // keep a note in the VU this long after its note-off
const level = reactive<number[]>(Array(MIDI_CHANNEL_COUNT).fill(0));
// per-channel envelope ("instrument"), tracked live from the MIDI Program Changes
const channelProgram = reactive<(number | null)[]>(Array(MIDI_CHANNEL_COUNT).fill(null));

/** Is the channel mirrored to the 2nd (speaker) output? */
function inSpeaker(ch: number): boolean {
  return ((song.value?.output2Mask ?? 0) & (1 << ch)) !== 0;
}
/** Relative energy of the coil a channel feeds: ontime × duty (× live faders).
 *  Speaker-only channels (no coil) still light at a fixed level so the 2nd output
 *  is visible on the VU. */
function channelEnergy(ch: number): number {
  const c = (song.value?.coils ?? []).find((co) => (co.channelMask & (1 << ch)) !== 0);
  if (!c) return inSpeaker(ch) ? 0.6 : 0;
  const ot = (c.ontimeUs * ontimeRatio.value) / 100;
  const dt = (c.duty * dutyRatio.value) / 100;
  return Math.min(1, (ot * dt) / 4);
}
/** Per frame: bar level = (max envelope amplitude of notes sounding now) × coil energy. */
function updateLevels(): void {
  const a = analysis.value;
  const t = playheadMs.value;
  const chMax = new Array<number>(MIDI_CHANNEL_COUNT).fill(0);
  if (a) {
    for (const note of a.notes) {
      if (t < note.startMs || t >= note.endMs + RELEASE_TAIL_MS) continue;
      const program = channelProgram[note.channel] ?? 0;
      const releaseMs = t >= note.endMs ? note.endMs - note.startMs : null;
      const amp = envelopeAmplitude(program, t - note.startMs, releaseMs);
      if (amp > chMax[note.channel]) chMax[note.channel] = amp;
    }
  }
  for (let ch = 0; ch < MIDI_CHANNEL_COUNT; ch++) level[ch] = chMax[ch] * channelEnergy(ch);
}

const durationMs = computed(() => analysis.value?.durationMs ?? 0);
const progressPct = computed(() =>
  durationMs.value ? Math.min(100, (playheadMs.value / durationMs.value) * 100) : 0,
);
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface SmfPlayerInstance {
  init(midi: unknown, latency: number, eventNo: number): void;
  startPlay(): void;
  stopPlay(): void;
  finished: boolean;
  /** Wall-clock origin (performance.now) the player schedules output against. */
  startTime: number;
  dispEventMonitor: (msg: unknown[], type: unknown) => void;
}
let smfPlayer: SmfPlayerInstance | null = null;
const PLAY_LATENCY_MS = 800; // output look-ahead passed to the SmfPlayer
let finishedTimer: ReturnType<typeof setInterval> | null = null;
let loadedPath: string | null = null;
// set by playSong() when a song must auto-start as soon as its MIDI is parsed
let pendingAutoplay = false;

const canPlay = computed(() => !!parsedMidiFile.value && !!midiStore.midiOutput && !isPlaying.value);
const canStop = computed(() => isPlaying.value);
const canPanic = computed(() => !!midiStore.midiOutput);
const canSysex = computed(() => !!song.value && !!midiStore.midiOutput);

// per-coil legend (ontime + duty), ordered by coil index
const legendCoils = computed(() =>
  [...(song.value?.coils ?? [])].sort((a, b) => a.coilIndex - b.coilIndex),
);
// distinct envelopes currently heard, with the channels using each
const envelopesInUse = computed(() => {
  const groups = new Map<number, number[]>();
  channelProgram.forEach((p, ch) => {
    if (p == null) return;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(ch);
  });
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([program, chs]) => ({ program, chs, env: envelope(program) }));
});
function resetPrograms(): void {
  for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) channelProgram[i] = null;
}
// initial instrument detection from the whole-file analysis (channels with notes
// but no explicit program default to 0 = constant). Live program changes still override.
function seedPrograms(): void {
  for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) channelProgram[i] = null;
  const a = analysis.value;
  if (!a) return;
  for (const ch of a.channels) channelProgram[ch] = a.programByChannel[ch] ?? 0;
}
// playhead: MIDI plays in real time, so wall-clock since start ≈ song position
function startPlayhead(): void {
  playStart = performance.now();
  const tick = (): void => {
    playheadMs.value = performance.now() - playStart;
    updateLevels();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}
function stopPlayhead(): void {
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  playheadMs.value = 0;
}
/** duty fraction (0..1) → percentage with up to 2 decimals. */
function dutyPct(duty: number): number {
  return Math.round(duty * 1e4) / 100;
}
// legend shows the EFFECTIVE values = base × the live faders × the active
// automation ratio at the playhead, so it tracks both the sliders and events.
function effOntime(c: CoilConfig): number {
  const r = effectiveRatio(song.value?.events ?? [], c.coilIndex, 'ontime', playheadMs.value);
  return Math.round((c.ontimeUs * r * ontimeRatio.value) / 100);
}
function effDutyPct(c: CoilConfig): number {
  const r = effectiveRatio(song.value?.events ?? [], c.coilIndex, 'duty', playheadMs.value);
  return dutyPct((c.duty * r * dutyRatio.value) / 100);
}
function onAutoplayToggle(e: Event): void {
  midiStore.setAutoplay((e.target as HTMLInputElement).checked);
}

/** All destination colours a channel feeds: its coils + the speaker output. */
function channelColors(ch: number): string[] {
  const cols = (song.value?.coils ?? [])
    .filter((c) => (c.channelMask & (1 << ch)) !== 0)
    .map((c) => coilColor(c.coilIndex));
  if (inSpeaker(ch)) cols.push('var(--plasma)');
  return cols;
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
  return (song.value?.coils ?? []).some((c) => (c.channelMask & (1 << ch)) !== 0) || inSpeaker(ch);
}

function resetNotes(): void {
  for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) level[i] = 0;
}

function loadSong(s: Song): void {
  const newPath = s.midiFile?.path ?? null;
  song.value = s; // always reflect the latest config (legend, VU colours, etc.)
  pendingAutoplay = false; // a plain load cancels any pending auto-start
  if (newPath === loadedPath) return; // same MIDI (or none) → config-only, no reparse
  stop();
  loadedPath = newPath;
  parsedMidiFile.value = null;
  analysis.value = null;
  resetNotes();
  resetPrograms();
  if (!newPath) return; // config-only song: nothing to stream
  loadMidiFile(newPath)
    .then((buffer) => {
      const parser = new SmfParser();
      parsedMidiFile.value = parser.parse(arrayBufferToString(buffer));
      analysis.value = analyzeMidi(parsedMidiFile.value);
      seedPrograms(); // show detected instruments before playing
      if (pendingAutoplay) { pendingAutoplay = false; play(); }
    })
    .catch((err) => {
      // surface the failure and reset so a retry re-parses; don't leave a pending autostart
      pendingAutoplay = false;
      loadedPath = null;
      console.error('Failed to load MIDI file', newPath, err);
    });
}

/** Load a song and start playing as soon as its MIDI is ready (queue use). */
function playSong(s: Song): void {
  loadSong(s);
  if (parsedMidiFile.value) play(); // already parsed (same file) → play now
  else pendingAutoplay = true; // otherwise auto-start after the parse resolves
}

function executeConfig(): void {
  if (!song.value) return;
  for (const frame of compileCoilConfig(song.value.coils ?? [], song.value.mode ?? 'midi')) {
    midiStore.sendSysex(frame);
  }
}

/**
 * Schedule every mid-song coil change (CoilEvent) as a SysEx frame on the same
 * timestamped output queue as the notes, so it lands exactly in sync with the
 * audio. `smfPlayer.startTime` is the wall-clock origin the player schedules
 * against; `+ PLAY_LATENCY_MS` matches the look-ahead applied to the notes.
 */
function scheduleCoilEvents(): void {
  const out = midiStore.midiOutput;
  const events = song.value?.events ?? [];
  const coils = song.value?.coils ?? [];
  if (!out || !smfPlayer || events.length === 0) return;
  for (const ev of events) {
    const coil = coils.find((c) => c.coilIndex === ev.coilIndex);
    if (!coil) continue;
    // ev.value is a RATIO of the coil's configured value (1.0 = 100%)
    const base = ev.param === 'duty' ? coil.duty : coil.ontimeUs;
    out.send(coilEventFrame(ev.coilIndex, ev.param, base * ev.value), {
      time: smfPlayer.startTime + ev.atMs + PLAY_LATENCY_MS,
    });
  }
}

function play(): void {
  if (!parsedMidiFile.value || !midiStore.midiOutput) return;
  stop();
  isPlaying.value = true;
  emit('playingChange', true);
  resetNotes();
  seedPrograms();
  executeConfig();
  const coilUnion = (song.value?.coils ?? []).reduce((m, c) => m | c.channelMask, 0);
  const ch1 = maskToChannels(coilUnion);
  const ch2 = maskToChannels(song.value?.output2Mask ?? 0);
  smfPlayer = new SmfPlayer(midiStore.midiOutput, midiStore.midiOutput2, ch1, ch2) as unknown as SmfPlayerInstance;
  smfPlayer.dispEventMonitor = dispEventMonitor;
  smfPlayer.init(parsedMidiFile.value, PLAY_LATENCY_MS, 0);
  smfPlayer.startPlay();
  startPlayhead();
  scheduleCoilEvents();
  finishedTimer = setInterval(() => {
    if (smfPlayer?.finished) {
      // stop() FIRST (clears this timer) so a re-entrant playSong() from the
      // songFinished handler — e.g. repeat='one' — keeps its fresh timer.
      stop();
      emit('songFinished');
    }
  }, 100);
}

/** Flush an output's scheduled-but-unsent messages, if the browser supports it. */
function clearOutput(out: typeof midiStore.midiOutput): void {
  const o = out as unknown as { clear?: () => void } | null;
  if (o && typeof o.clear === 'function') o.clear();
}

function stop(): void {
  pendingAutoplay = false; // an explicit stop cancels any in-flight auto-start
  if (finishedTimer) { clearInterval(finishedTimer); finishedTimer = null; }
  if (isPlaying.value) emit('playingChange', false);
  isPlaying.value = false;
  if (smfPlayer) smfPlayer.stopPlay();
  // drop anything still scheduled ahead (note tail + future coil-event SysEx)…
  clearOutput(midiStore.midiOutput);
  clearOutput(midiStore.midiOutput2);
  // …then silence whatever is sounding right now.
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
  stopPlayhead();
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
// The VU reads notes from the analysis at the playhead, so we only watch program
// changes here to keep the per-channel instrument legend up to date.
function dispEventMonitor(msg: unknown[], type: unknown): void {
  if (type === 'input') return;
  const st = statusByte(msg[0]);
  if ((st & 0xf0) === 0xc0) channelProgram[st & 0x0f] = statusByte(msg[1]);
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

defineExpose({ loadSong, playSong, stop });
</script>

<template>
  <article class="player-panel">
    <header class="player-panel__head">
      <span class="player-panel__title"><span class="icon"><i class="fas fa-compact-disc"></i></span>{{ $t('title.player') }}</span>
      <label v-if="props.showAutoplay" class="switch player-panel__autoplay">
        <input type="checkbox" :checked="midiStore.autoplay" @change="onAutoplayToggle" />
        <span class="switch__track"></span>
        <span class="switch__text">{{ $t('label.autoplay') }}</span>
      </label>
    </header>

    <div class="player-song">
      <span class="icon"><i class="fas fa-music"></i></span>
      <span v-if="song" class="player-song__name">{{ song.name }}</span>
      <span v-else class="player-song__empty">{{ $t('label.noSongLoaded') }}</span>
      <!-- per-coil legend (colour + ontime + duty): same line as the name if it
           fits, otherwise wraps full-width onto the line below -->
      <div v-if="song && legendCoils.length" class="player-coils">
        <div v-for="c in legendCoils" :key="c.coilIndex" class="player-coil" :style="{ '--c': coilColor(c.coilIndex) }">
          <span class="player-coil__chip">{{ c.coilIndex }}</span>
          <span class="player-coil__readouts">
            <span class="player-coil__readout">{{ effOntime(c) }}<i>µs</i></span>
            <span class="player-coil__readout">{{ effDutyPct(c) }}<i>%</i></span>
          </span>
        </div>
      </div>
    </div>

    <!-- playback progress, right under the song title -->
    <div v-if="song" class="player-progress">
      <div class="player-progress__bar"><div class="player-progress__fill" :style="{ width: progressPct + '%' }"></div></div>
      <span class="player-progress__time">{{ fmt(playheadMs) }} / {{ fmt(durationMs) }}</span>
    </div>

    <p v-if="!midiStore.midiOutput" class="player-hint">
      <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
    </p>
    <p v-else-if="!song" class="player-hint">
      <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.loadSongHint') }}
    </p>

    <div class="player-viz">
      <div class="segmented player-viz__tabs">
        <button type="button" :class="{ 'is-active': viz === 'vu' }" @click="viz = 'vu'">
          <span class="icon"><i class="fas fa-chart-simple"></i></span>{{ $t('label.viewVu') }}
        </button>
        <button type="button" :class="{ 'is-active': viz === 'roll' }" @click="viz = 'roll'">
          <span class="icon"><i class="fas fa-music"></i></span>{{ $t('label.viewScore') }}
        </button>
        <button type="button" :class="{ 'is-active': viz === 'lanes' }" @click="viz = 'lanes'">
          <span class="icon"><i class="fas fa-bolt"></i></span>{{ $t('label.viewCoils') }}
        </button>
        <button v-if="!compactGraph" type="button" :class="{ 'is-active': viz === 'combined' }" @click="viz = 'combined'">
          <span class="icon"><i class="fas fa-layer-group"></i></span>{{ $t('label.viewCombined') }}
        </button>
      </div>

      <div class="player-viz__body">
        <div v-show="viz === 'vu'" class="vu">
          <span class="vu__label">{{ $t('label.channels') }}</span>
          <div class="vu-strip">
            <div v-for="i in MIDI_CHANNEL_COUNT" :key="i - 1" class="vu-chan">
              <div class="vu-track" :class="{ 'is-unmapped': !channelMapped(i - 1) }">
                <div class="vu-fill"
                  :style="{ height: (level[i - 1] * 100) + '%', background: channelBackground(i - 1) }"></div>
              </div>
              <span class="vu-num">{{ i - 1 }}</span>
            </div>
          </div>
        </div>
        <midi-preview v-if="viz !== 'vu'" :analysis="analysis" :coils="song?.coils ?? []"
          :coil-count="song?.coilCount ?? 0" :output2-mask="song?.output2Mask ?? 0"
          :view="previewView" :playhead-ms="playheadMs" :playing="isPlaying"
          :events="song?.events ?? []" v-model:edit-param="playerParam" :compact="compactGraph" />
      </div>
    </div>

    <!-- instruments (envelopes) heard per channel, tracked from MIDI program changes -->
    <div v-if="song && envelopesInUse.length" class="vu-legend">
      <span class="vu-legend__label">
        <span class="icon"><i class="fas fa-guitar"></i></span>
        <span class="vu-legend__label-text">{{ $t('label.instruments') }}</span>
      </span>
      <span v-for="e in envelopesInUse" :key="e.program" class="env-chip"
        :title="`${$t('label.instrument')}: ${e.env.name}`">
        <span class="env-chip__pn">P{{ e.program }}</span>
        <span class="env-chip__name">{{ e.env.name }}</span>
        <span class="env-chip__chs">ch {{ e.chs.join(', ') }}</span>
      </span>
    </div>

    <div class="player-faders">
      <label class="fader">
        <span class="fader__top">
          <span class="fader__key">{{ $t('label.ontime') }}</span>
          <span class="fader__val">{{ ontimeRatio }}%</span>
        </span>
        <input class="fader__range" type="range" min="0" max="200" step="1" v-model.number="ontimeRatio"
          :disabled="!song" :title="$t('label.ontimeRatio')" @change="onOntimeRatioChange">
        <span class="fader__field">
          <input class="fader__num" type="number" min="0" max="200" step="1" v-model.number="ontimeRatio"
            :disabled="!song" :title="$t('label.ontimeRatio')" @change="onOntimeRatioChange"><i>%</i>
        </span>
      </label>
      <label class="fader">
        <span class="fader__top">
          <span class="fader__key">{{ $t('label.duty') }}</span>
          <span class="fader__val">{{ dutyRatio }}%</span>
        </span>
        <input class="fader__range" type="range" min="0" max="200" step="1" v-model.number="dutyRatio" :disabled="!song"
          :title="$t('label.dutyRatio')" @change="onDutyRatioChange">
        <span class="fader__field">
          <input class="fader__num" type="number" min="0" max="200" step="1" v-model.number="dutyRatio"
            :disabled="!song" :title="$t('label.dutyRatio')" @change="onDutyRatioChange"><i>%</i>
        </span>
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
