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
import MidiPreview from '@/components/player/MidiPreview.vue';
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
// MidiPreview view (combined = score + coils, available in compact too)
const previewView = computed<'roll' | 'lanes' | 'combined'>(() => {
  if (viz.value === 'combined') return 'combined';
  return viz.value === 'lanes' ? 'lanes' : 'roll';
});
let rafId: number | null = null;
let playStart = 0;
// LIVE POWER: a GLOBAL ⇄ ADVANCED toggle.
//  • Global  — one "Power" knob scaling ontime AND duty for ALL coils (the quick "turn
//    it down/up" control a performer reaches for).
//  • Advanced — per-coil Ontime & Duty multipliers, for fine-tuning each coil.
// Effective ratio sent to a coil (percent, 100 = as configured): global → masterPower
// for both params; advanced → that coil's own ontime/duty.
type PowerScope = 'global' | 'advanced';
const powerScope = ref<PowerScope>((localStorage.getItem('playerPowerScope') as PowerScope) || 'global');
watch(powerScope, (v) => localStorage.setItem('playerPowerScope', v));
const masterPower = ref(100);
// per-coil ontime & duty (%, default 100, keyed by coilIndex). Seeded per song.
const coilOntime = reactive<Record<number, number>>({});
const coilDuty = reactive<Record<number, number>>({});
watch(() => song.value?.id, () => {
  for (const c of song.value?.coils ?? []) { coilOntime[c.coilIndex] = 100; coilDuty[c.coilIndex] = 100; }
}, { immediate: true });
function effRatioOntime(i: number): number {
  return powerScope.value === 'advanced' ? (coilOntime[i] ?? 100) : masterPower.value;
}
function effRatioDuty(i: number): number {
  return powerScope.value === 'advanced' ? (coilDuty[i] ?? 100) : masterPower.value;
}
const powerBoost = computed(() => masterPower.value > 100); // global readout: past "nominal"
const masterDirty = computed(() => {
  if (powerScope.value === 'advanced') {
    return (song.value?.coils ?? []).some((c) =>
      (coilOntime[c.coilIndex] ?? 100) !== 100 || (coilDuty[c.coilIndex] ?? 100) !== 100);
  }
  return masterPower.value !== 100;
});
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
  const ot = (c.ontimeUs * effRatioOntime(c.coilIndex)) / 100;
  const dt = (c.duty * effRatioDuty(c.coilIndex)) / 100;
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
      // The Syntherrupter scales a note's ontime linearly with velocity
      // (ontimeUS = velocity/127 × envelopeVolume × … × maxOntime), so the VU
      // must weight the envelope by velocity to reflect actual coil output.
      const amp = envelopeAmplitude(program, t - note.startMs, releaseMs) * (note.velocity / 127);
      if (amp > chMax[note.channel]) chMax[note.channel] = amp;
    }
  }
  // envelope amplitude can exceed 1 (attack punch); clamp the displayed bar height
  for (let ch = 0; ch < MIDI_CHANNEL_COUNT; ch++) level[ch] = Math.min(1, chMax[ch] * channelEnergy(ch));
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
  /** Reposition the event cursor to `targetMs` (no output); sets `eventTime`. */
  seek(targetMs: number): void;
  setGM(): void;
  finished: boolean;
  /** Wall-clock origin (performance.now) the player schedules output against. */
  startTime: number;
  /** Cumulative song position (ms) of the cursor — set by seek / advanced by playback. */
  eventTime: number;
  /** Manual timing offset (ms) added to the 2nd output (hardware calibration). */
  output2Offset: number;
  dispEventMonitor: (msg: unknown[], type: unknown) => void;
}
let smfPlayer: SmfPlayerInstance | null = null;
const PLAY_LATENCY_MS = 800; // output look-ahead passed to the SmfPlayer
let finishedTimer: ReturnType<typeof setInterval> | null = null;
// natural end-of-song: when the player reports `finished` (nominal end), wait one
// look-ahead so the events scheduled PLAY_LATENCY_MS ahead actually play out (and
// the playhead reaches the end) before we stop. Null = not yet finished.
let finishedAt: number | null = null;
// apply 2nd-output calibration live (takes effect on events scheduled after the change)
watch(() => midiStore.output2OffsetMs, (v) => { if (smfPlayer) smfPlayer.output2Offset = v; });
let loadedPath: string | null = null;
// set by playSong() when a song must auto-start as soon as its MIDI is parsed
let pendingAutoplay = false;

// `paused` = frozen at a position (cued), not sounding. `isPlaying` = actively sounding.
const paused = ref(false);
const canTransport = computed(() => !!parsedMidiFile.value && !!midiStore.midiOutput);
const canStop = computed(() => isPlaying.value || paused.value);
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
// Playhead = the song position currently HEARD. Output is scheduled PLAY_LATENCY_MS
// ahead of the nominal clock (look-ahead buffer), so the audio of song-position X is
// heard at startTime + X + latency. We therefore offset the playhead by the latency so
// the progress bar / VU / cursor line up with the sound (for the synth and real MIDI
// alike) instead of running ~latency ahead. It sits at 0 until the first sound is heard.
function startPlayhead(): void {
  playStart = smfPlayer?.startTime ?? performance.now();
  const tick = (): void => {
    playheadMs.value = Math.max(0, performance.now() - playStart - PLAY_LATENCY_MS);
    updateLevels();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}
/** duty fraction (0..1) → percentage with up to 2 decimals. */
function dutyPct(duty: number): number {
  return Math.round(duty * 1e4) / 100;
}
// legend shows the EFFECTIVE values = base × the live power (master × bias) × the
// active automation ratio at the playhead, so it tracks both the faders and events.
function effOntime(c: CoilConfig): number {
  const r = effectiveRatio(song.value?.events ?? [], c.coilIndex, 'ontime', playheadMs.value);
  return Math.round((c.ontimeUs * r * effRatioOntime(c.coilIndex)) / 100);
}
function effDutyPct(c: CoilConfig): number {
  const r = effectiveRatio(song.value?.events ?? [], c.coilIndex, 'duty', playheadMs.value);
  return dutyPct((c.duty * r * effRatioDuty(c.coilIndex)) / 100);
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
function scheduleCoilEvents(fromMs = 0): void {
  const out = midiStore.midiOutput;
  const events = song.value?.events ?? [];
  const coils = song.value?.coils ?? [];
  if (!out || !smfPlayer || events.length === 0) return;
  for (const ev of events) {
    if (ev.atMs < fromMs) continue; // past events: applied immediately via applyCoilStateAt
    const coil = coils.find((c) => c.coilIndex === ev.coilIndex);
    if (!coil) continue;
    // ev.value is a RATIO of the coil's configured value (1.0 = 100%)
    const base = ev.param === 'duty' ? coil.duty : coil.ontimeUs;
    out.send(coilEventFrame(ev.coilIndex, ev.param, base * ev.value), {
      time: smfPlayer.startTime + ev.atMs + PLAY_LATENCY_MS,
    });
  }
}

/** Apply each coil's automation level at song-position `ms` immediately, so a jump
 *  leaves the coils where the events would have without replaying them. */
function applyCoilStateAt(ms: number): void {
  const out = midiStore.midiOutput;
  if (!out) return;
  for (const coil of song.value?.coils ?? []) {
    const ro = effectiveRatio(song.value?.events ?? [], coil.coilIndex, 'ontime', ms);
    const rd = effectiveRatio(song.value?.events ?? [], coil.coilIndex, 'duty', ms);
    out.send(coilEventFrame(coil.coilIndex, 'ontime', coil.ontimeUs * ro));
    out.send(coilEventFrame(coil.coilIndex, 'duty', coil.duty * rd));
  }
}

/** Build a fresh SmfPlayer for the current song/outputs (cursor at the start). */
function buildPlayer(): SmfPlayerInstance {
  const coilUnion = (song.value?.coils ?? []).reduce((m, c) => m | c.channelMask, 0);
  const ch1 = maskToChannels(coilUnion);
  const ch2 = maskToChannels(song.value?.output2Mask ?? 0);
  const p = new SmfPlayer(midiStore.midiOutput, midiStore.midiOutput2, ch1, ch2) as unknown as SmfPlayerInstance;
  p.dispEventMonitor = dispEventMonitor;
  p.output2Offset = midiStore.output2OffsetMs; // hardware calibration for output 2
  p.init(parsedMidiFile.value, PLAY_LATENCY_MS, 0);
  return p;
}

function startFinishedTimer(): void {
  finishedAt = null;
  finishedTimer = setInterval(() => {
    if (!smfPlayer?.finished) return;
    // The player reports `finished` at the NOMINAL end, but events are scheduled one
    // look-ahead later, so the tail is still sounding. Wait that long before stopping
    // (otherwise the output flush would cut the last PLAY_LATENCY_MS of audio and the
    // bar would never reach the end).
    if (finishedAt == null) { finishedAt = performance.now(); return; }
    if (performance.now() - finishedAt < PLAY_LATENCY_MS) return;
    stop();
    emit('songFinished');
  }, 100);
}

/** Tear down the live engine: timers, scheduled output, sounding notes, playhead loop.
 *  Does NOT touch isPlaying/paused/playheadMs — callers set the resulting state. */
function teardownPlayback(): void {
  pendingAutoplay = false;
  finishedAt = null;
  if (finishedTimer) { clearInterval(finishedTimer); finishedTimer = null; }
  if (smfPlayer) smfPlayer.stopPlay();
  clearOutput(midiStore.midiOutput);
  clearOutput(midiStore.midiOutput2);
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } // freeze the playhead in place
  resetNotes();
}

/** Unified entry: (re)configure and play from song-position `fromMs` (0 = the start). */
function playFrom(fromMs: number): void {
  if (!parsedMidiFile.value || !midiStore.midiOutput) return;
  midiStore.midiOutput.resume?.(); // unlock the synth's AudioContext (a play is a gesture)
  const wasPlaying = isPlaying.value;
  teardownPlayback();
  seedPrograms();
  executeConfig();
  smfPlayer = buildPlayer();
  if (fromMs > 0) smfPlayer.seek(fromMs); // position the cursor (eventTime ≈ fromMs)
  else smfPlayer.setGM();
  applyCoilStateAt(smfPlayer.eventTime); // coils → their automation level at this position
  // map wall-now to this song position, then schedule notes (player) + future coil events
  smfPlayer.startTime = performance.now() - smfPlayer.eventTime;
  startPlayhead();
  scheduleCoilEvents(smfPlayer.eventTime);
  smfPlayer.startPlay();
  isPlaying.value = true;
  paused.value = false;
  if (!wasPlaying) emit('playingChange', true);
  startFinishedTimer();
}

function play(): void {
  playFrom(0);
}

/** Freeze playback at the current position (cued). The cursor + playhead are kept;
 *  pressing play resumes from here. */
function pause(): void {
  if (!isPlaying.value) return;
  teardownPlayback();
  isPlaying.value = false;
  paused.value = true;
  emit('playingChange', false);
}

function togglePlayPause(): void {
  if (isPlaying.value) pause();
  // Resume from playheadMs = the HEARD position (0 if stopped, else the frozen paused
  // playhead). Correct because pause flushes the look-ahead, so the last sound heard was
  // exactly playheadMs — restarting there replays the rest with no gap and no double-play.
  else playFrom(playheadMs.value);
}

/** Jump to song-position `ms`. While playing → keep playing from there; otherwise
 *  just move the playhead and stay silent (no surprise coil output). */
function seek(ms: number): void {
  if (!parsedMidiFile.value) return;
  const target = Math.max(0, Math.min(ms, durationMs.value || 0));
  if (isPlaying.value) {
    playFrom(target);
  } else {
    playheadMs.value = target;
    paused.value = true; // cued at the new position
    updateLevels();
  }
}

// --- progress-bar scrubbing (click / drag to seek) ----------------------------
const seekBar = ref<HTMLElement | null>(null);
const scrubbing = ref(false);
const scrubMs = ref(0);
// the fill/knob follow the drag preview while scrubbing, otherwise the playhead
const seekPct = computed(() => {
  const d = durationMs.value;
  if (scrubbing.value) return d ? Math.min(100, (scrubMs.value / d) * 100) : 0;
  return progressPct.value;
});
function seekMsFromEvent(e: PointerEvent): number {
  const el = seekBar.value;
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  const frac = r.width > 0 ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
  return frac * (durationMs.value || 0);
}
function onSeekDown(e: PointerEvent): void {
  if (scrubbing.value || !song.value || !durationMs.value) return; // ignore re-entrant pointerdown
  scrubbing.value = true;
  scrubMs.value = seekMsFromEvent(e);
  window.addEventListener('pointermove', onSeekMove);
  window.addEventListener('pointerup', onSeekUp);
}
function onSeekMove(e: PointerEvent): void {
  if (scrubbing.value) scrubMs.value = seekMsFromEvent(e);
}
function onSeekUp(): void {
  window.removeEventListener('pointermove', onSeekMove);
  window.removeEventListener('pointerup', onSeekUp);
  if (!scrubbing.value) return;
  const target = scrubMs.value;
  scrubbing.value = false;
  seek(target); // commit on release (each seek rebuilds the engine → avoid per-move churn)
}

/** Flush an output's scheduled-but-unsent messages, if the browser supports it. */
function clearOutput(out: typeof midiStore.midiOutput): void {
  const o = out as unknown as { clear?: () => void } | null;
  if (o && typeof o.clear === 'function') o.clear();
}

function stop(): void {
  const wasPlaying = isPlaying.value;
  teardownPlayback();
  isPlaying.value = false;
  paused.value = false;
  if (wasPlaying) emit('playingChange', false);
  playheadMs.value = 0;
}

function panic(): void {
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
}

// One live update: re-send each coil's ontime AND duty at its own effective ratio
// (master × bias × that coil's trim). Per-coil so individual trims take effect; only
// fires on @change (drag end), so ≤2·coils SysEx frames — no per-frame flooding.
function applyLive(): void {
  for (const c of song.value?.coils ?? []) {
    midiStore.sendLiveOntimeAdjust({ coils: [c], ratio: effRatioOntime(c.coilIndex) });
    midiStore.sendLiveDutyAdjust({ coils: [c], ratio: effRatioDuty(c.coilIndex) });
  }
}
function onPowerChange(): void {
  if (Math.abs(masterPower.value - 100) <= 3) masterPower.value = 100; // snap to unity ("home")
  applyLive();
}
// Switching to Advanced INHERITS the current global power into each coil's ontime & duty
// (so nothing jumps); switching back to Global re-asserts the single power across all coils.
function setScope(next: PowerScope): void {
  if (next === powerScope.value) return;
  if (next === 'advanced') {
    for (const c of song.value?.coils ?? []) {
      coilOntime[c.coilIndex] = masterPower.value;
      coilDuty[c.coilIndex] = masterPower.value;
    }
  }
  powerScope.value = next;
  applyLive();
}
function resetPower(): void {
  masterPower.value = 100;
  for (const c of song.value?.coils ?? []) { coilOntime[c.coilIndex] = 100; coilDuty[c.coilIndex] = 100; }
  applyLive();
}

function loadMidiFile(path: string, bust = false): Promise<ArrayBuffer> {
  // `bust` defeats HTTP caching after the file was rewritten on disk (instrument edit)
  const url = path.replace(/^\./, '') + (bust ? `?t=${Date.now()}` : '');
  return axios.get(url, { responseType: 'arraybuffer' }).then((r) => r.data as ArrayBuffer);
}

/**
 * Re-fetch + re-parse the currently loaded MIDI file, bypassing the path-equality
 * short-circuit. Used after the file's instruments were edited on disk so the
 * embedded player reflects the change without a full reload.
 */
function reloadMidi(): void {
  const path = loadedPath;
  if (!path || !song.value?.midiFile) return;
  loadMidiFile(path, true)
    .then((buffer) => {
      const parser = new SmfParser();
      parsedMidiFile.value = parser.parse(arrayBufferToString(buffer));
      analysis.value = analyzeMidi(parsedMidiFile.value);
      seedPrograms();
    })
    .catch((err) => console.error('Failed to reload MIDI file', path, err));
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

defineExpose({ loadSong, playSong, stop, reloadMidi });
</script>

<template>
  <article class="player-panel">
    <header class="player-panel__head">
      <span class="player-panel__title"><span class="icon"><i class="fas fa-compact-disc"></i></span>{{ $t('title.player') }}</span>
      <span v-if="midiStore.isSynthOutput" class="player-synth-badge"><i class="fas fa-wave-square"></i>{{ $t('label.synthActive') }}</span>
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

    <!-- playback progress (click / drag to seek), right under the song title -->
    <div v-if="song" class="player-progress">
      <div class="player-progress__bar" :class="{ 'is-scrubbing': scrubbing }" ref="seekBar"
        @pointerdown="onSeekDown" :title="$t('label.seek')">
        <div class="player-progress__fill" :style="{ width: seekPct + '%' }"></div>
        <div class="player-progress__knob" :style="{ left: seekPct + '%' }"></div>
      </div>
      <span class="player-progress__time">{{ fmt(scrubbing ? scrubMs : playheadMs) }} / {{ fmt(durationMs) }}</span>
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
        <button type="button" :class="{ 'is-active': viz === 'combined' }" @click="viz = 'combined'">
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
          :view="previewView" :playhead-ms="playheadMs" :playing="isPlaying" :paused="paused"
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

    <!-- LIVE POWER: a GLOBAL ⇄ ADVANCED toggle. Global = one Power fader (ontime+duty,
         all coils); Advanced = per-coil ontime/duty sliders for fine-tuning. -->
    <div class="player-power">
      <div class="power-head">
        <span class="power-head__key"><span class="icon"><i class="fas fa-gauge-high"></i></span>{{ $t('label.power') }}</span>
        <div class="segmented power-scope">
          <button type="button" :class="{ 'is-active': powerScope === 'global' }" @click="setScope('global')">{{ $t('label.scopeGlobal') }}</button>
          <button type="button" :class="{ 'is-active': powerScope === 'advanced' }" @click="setScope('advanced')">{{ $t('label.scopeAdvanced') }}</button>
        </div>
        <span v-if="powerScope === 'global'" class="power-head__val" :class="{ 'is-boost': powerBoost }">{{ masterPower }}%</span>
        <button class="power-head__reset" type="button" :disabled="!song || !masterDirty" @click="resetPower"
          :title="$t('label.resetPower')"><i class="fas fa-rotate-left"></i></button>
      </div>

      <!-- GLOBAL: one hero power fader (tri-zone track) -->
      <template v-if="powerScope === 'global'">
        <input class="power-range" type="range" min="0" max="200" step="1" v-model.number="masterPower"
          :disabled="!song" :title="$t('label.powerHint')" @change="onPowerChange">
        <div class="power-zones">
          <span>{{ $t('label.zoneSoft') }}</span>
          <span class="power-zones__mid">{{ $t('label.zoneNominal') }} · 100%</span>
          <span class="power-zones__over">{{ $t('label.zoneOver') }}</span>
        </div>
      </template>

      <!-- ADVANCED: per-coil ontime + duty -->
      <div v-else-if="song" class="power-coils">
        <div v-for="c in legendCoils" :key="c.coilIndex" class="coil-bias" :style="{ '--c': coilColor(c.coilIndex) }">
          <span class="coil-bias__chip">{{ c.coilIndex }}</span>
          <label class="coil-bias__item">
            <span class="coil-bias__key">{{ $t('label.ontime') }}</span>
            <input class="bias__range" type="range" min="0" max="200" step="1" v-model.number="coilOntime[c.coilIndex]" @change="applyLive">
            <span class="coil-bias__val">{{ coilOntime[c.coilIndex] }}%</span>
          </label>
          <label class="coil-bias__item">
            <span class="coil-bias__key">{{ $t('label.duty') }}</span>
            <input class="bias__range" type="range" min="0" max="200" step="1" v-model.number="coilDuty[c.coilIndex]" @change="applyLive">
            <span class="coil-bias__val">{{ coilDuty[c.coilIndex] }}%</span>
          </label>
        </div>
      </div>
    </div>

    <div class="player-transport">
      <button class="btn btn--volt" type="button" :disabled="!canTransport" @click="togglePlayPause">
        <span class="icon"><i class="fas" :class="isPlaying ? 'fa-pause' : 'fa-play'"></i></span>{{ isPlaying ? 'Pause' : 'Play' }}
      </button>
      <button class="btn" :class="{ 'btn--danger': isPlaying }" type="button" :disabled="!canStop" @click="stop">
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
