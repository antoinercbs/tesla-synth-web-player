<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { maskToChannels } from '@/sysex/syntherrupter';
import { envelopeAmplitude } from '@/sysex/envelopes';
import { analyzeMidi, channelVolumes, noteRange, type MidiAnalysis } from '@/midi/analyze';
import { coilLevelAt } from '@/midi/automation';
import { fileUrl } from '@/midi/song-file';
import { coilColor } from '@/ui/coil-colors';
import { MIDI_CHANNEL_COUNT } from '@/types/domain';
import type { CoilConfig, Song } from '@/types/domain';
import VizTabs from '@/components/player/VizTabs.vue';
import PowerControlPanel from '@/components/player/PowerControlPanel.vue';
import BoardAlert from '@/components/player/BoardAlert.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import { useLeaveGuard } from '@/utils/leave-guard';
import { dutyNearLimit, limitLabel, ontimeNearLimit } from '@/devices/limits';
import { cutsSoFar, simulate, stepAt, type Simulation } from '@/devices/coil-sim';
import type { CoilLimits } from '@/devices/coil-limits';
import { capUs, requestedOntimeUs } from '@/devices/ontime-model';
import { noteFrequency } from '@/ui/piano-layout';
import { tour } from '@/tour/tour';
import SmfParser from '@/smfplayer/js/smfParser.js';
import SmfPlayer from '@/smfplayer/js/smfPlayer.js';
import { ICONS } from '@/ui/icons';

const emit = defineEmits<{
  (e: 'songFinished'): void;
  (e: 'playingChange', value: boolean): void;
  /** The heard position, a few times a second while playing and on every seek. */
  (e: 'position', ms: number): void;
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
type Viz = 'vu' | 'roll' | 'load' | 'combined';
// the coil lanes' tab became the load's
const storedViz = localStorage.getItem('playerViz');
const viz = ref<Viz>(storedViz === 'lanes' ? 'load' : (storedViz as Viz) || 'vu');
watch(viz, (v) => localStorage.setItem('playerViz', v));
let rafId: number | null = null;
let playStart = 0;
// LIVE POWER: a GLOBAL ⇄ ADVANCED toggle.
//  • Global  — one "Power" knob scaling ontime AND duty for ALL coils (the quick "turn
//    it down/up" control a performer reaches for).
//  • Advanced — per-coil Ontime & Duty multipliers, for fine-tuning each coil.
// Power sent to a coil (percent, 100 = as configured, ontime and duty together):
// global → masterPower; advanced → that coil's own.
type PowerScope = 'global' | 'advanced';
const powerScope = ref<PowerScope>((localStorage.getItem('playerPowerScope') as PowerScope) || 'global');
watch(powerScope, (v) => localStorage.setItem('playerPowerScope', v));
const masterPower = ref(100);
// per-coil power (%, keyed by coilIndex), kept from one song to the next: a coil
// turned down for the venue must not come back at 100 % on the next track
const coilPower = reactive<Record<number, number>>({});
watch(() => song.value?.coils, (coils) => {
  for (const c of coils ?? []) coilPower[c.coilIndex] ??= 100;
}, { immediate: true });
// "≤ 100 %": the operator's lock against overdrive, for the whole show (persisted)
const powerCapped = ref(localStorage.getItem('playerPowerCap') === '1');
watch(powerCapped, (v) => localStorage.setItem('playerPowerCap', v ? '1' : '0'));
const powerMax = computed(() => (powerCapped.value ? 100 : 200));
function powerOf(i: number): number {
  return powerScope.value === 'advanced' ? (coilPower[i] ?? 100) : masterPower.value;
}
const powerBoost = computed(() => masterPower.value > 100); // global readout: past "nominal"
const masterDirty = computed(() => {
  if (powerScope.value === 'advanced') {
    return (song.value?.coils ?? []).some((c) => (coilPower[c.coilIndex] ?? 100) !== 100);
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
  const ot = (c.ontimeUs * powerOf(c.coilIndex)) / 100;
  const dt = (c.duty * powerOf(c.coilIndex)) / 100;
  return Math.min(1, (ot * dt) / 4);
}
// the file's channel volume × expression: the board scales every note of the channel by both
const volumesAt = computed(() => channelVolumes(analysis.value?.volumeEvents ?? []));
/** Per frame: bar level = (max envelope amplitude of notes sounding now) × coil energy. */
function updateLevels(): void {
  const a = analysis.value;
  const t = playheadMs.value;
  const chMax = new Array<number>(MIDI_CHANNEL_COUNT).fill(0);
  if (a) {
    const volumes = volumesAt.value(t);
    for (const note of a.notes) {
      if (t < note.startMs || t >= note.endMs + RELEASE_TAIL_MS) continue;
      const program = channelProgram[note.channel] ?? 0;
      const releaseMs = t >= note.endMs ? note.endMs - note.startMs : null;
      // The Syntherrupter scales a note's ontime linearly with velocity
      // (ontimeUS = velocity/127 × envelopeVolume × … × maxOntime), so the VU
      // must weight the envelope by velocity to reflect actual coil output.
      const amp = envelopeAmplitude(program, t - note.startMs, releaseMs) * (note.velocity / 127) * volumes[note.channel];
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
const canTransport = computed(() => !!parsedMidiFile.value && !!midiStore.midiOutput && !midiStore.boardLatched);
// the song's coils past the board's outputs (the built-in synth plays them all)
const { t } = useI18n();
const mutedCoils = computed(() => {
  if (!song.value || midiStore.isSynthOutput) return '';
  const outputs = midiStore.deviceProfile.coils;
  const muted = Array.from({ length: Math.max(0, song.value.coilCount - outputs) }, (_, i) => outputs + i);
  return muted.length ? t('board.mutedCoils', { list: muted.join(', ') }, muted.length) : '';
});
const canStop = computed(() => isPlaying.value || paused.value);
const canPanic = computed(() => !!midiStore.midiOutput);
const canSysex = computed(() => !!song.value && !!midiStore.midiOutput);

// the song's coils, ordered by coil index
const legendCoils = computed(() =>
  [...(song.value?.coils ?? [])].sort((a, b) => a.coilIndex - b.coilIndex),
);
// the file's CC7 × CC11 where it is heard: the VU's ceiling on each channel; none when it sets neither
const volumeCeilings = computed(() =>
  analysis.value?.volumeEvents.length ? volumesAt.value(playheadMs.value) : null);
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
// the notes each coil plays: its lowest one tells where Power stops changing its bass
const coilRanges = computed(() => {
  const notes = analysis.value?.notes ?? [];
  return new Map((song.value?.coils ?? []).map((c) => [c.coilIndex, noteRange(notes, c.channelMask)]));
});

/*
 * What the board makes of the song (devices/coil-sim.ts), redone when the power or
 * the coils' limits change: a few times a second at most while a fader moves.
 */
const sim = shallowRef<Simulation | null>(null);
let simTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSim(): void {
  if (simTimer) return;
  simTimer = setTimeout(() => {
    simTimer = null;
    const s = song.value, a = analysis.value;
    sim.value = s && a?.notes.length
      ? simulate({ analysis: a, coils: s.coils ?? [], stereo: s.stereo, events: s.events ?? [], limits: midiStore.effectiveCoilLimits, power: powerOf })
      : null;
  }, 120);
}
watch([song, analysis, () => midiStore.effectiveCoilLimits, masterPower, powerScope, coilPower], scheduleSim, { deep: true, immediate: true });
const loadCoils = computed(() => (song.value?.coils ?? []).map((c) => ({
  coilIndex: c.coilIndex, name: midiStore.coilName(c.coilIndex), limits: midiStore.coilLimit(c.coilIndex),
})));

/** The power past which a coil's lowest note fires its max ontime, whatever more it gets. */
function notchOf(c: CoilConfig, limits: CoilLimits | null): number | null {
  const cap = capUs(limits);
  const range = coilRanges.value.get(c.coilIndex);
  if (cap == null || !range) return null;
  const pct = Math.floor((cap / requestedOntimeUs({ ontimeUs: c.ontimeUs, duty: c.duty }, noteFrequency(range.min))) * 100);
  return pct < 200 ? pct : null;
}
// the skipped-notes light stays on a little, or a single note would only flicker it
const LED_HOLD_MS = 600;
const ledUntil = new Map<number, number>();
// each coil's row in the power panel: what it is sent, and what it fires where the song is heard
const coilRows = computed(() => {
  const s = sim.value;
  const ms = playheadMs.value;
  const step = s ? stepAt(s, ms) : 0;
  const now = performance.now();
  return legendCoils.value.map((c) => {
    const limits = midiStore.coilLimit(c.coilIndex);
    const tr = s?.tracks.find((x) => x.coilIndex === c.coilIndex) ?? null;
    let live = null;
    if (tr) {
      if (tr.skipped[step]) ledUntil.set(c.coilIndex, now + LED_HOLD_MS);
      live = {
        dutyAsked: tr.dutyAsked[step], duty: tr.duty[step], factor: tr.factor[step],
        pulseUs: tr.pulseUs[step], askedUs: tr.askedUs[step],
        skippedNow: now < (ledUntil.get(c.coilIndex) ?? 0), skippedSoFar: cutsSoFar(tr, ms),
      };
    }
    return {
      coilIndex: c.coilIndex,
      color: coilColor(c.coilIndex),
      name: midiStore.coilName(c.coilIndex),
      power: coilPower[c.coilIndex] ?? 100,
      sent: coilLevelAt(song.value?.events ?? [], c, ms, powerOf(c.coilIndex), powerOf(c.coilIndex)),
      limits,
      notch: notchOf(c, limits),
      live,
    };
  });
});
// the coils the live power (or the song itself) takes near the board's protection: their
// longest pulse and their highest duty anywhere in the song
const limitWarn = computed(() => {
  const hw = midiStore.deviceProfile.hardwareLimits;
  if (!hw || midiStore.isSynthOutput || !sim.value) return '';
  const peak = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, v), 0);
  const coils = sim.value.tracks
    .filter((tr) => ontimeNearLimit(hw, peak(tr.pulseUs)) || dutyNearLimit(hw, peak(tr.duty)))
    .map((tr) => tr.coilIndex);
  if (!coils.length) return '';
  return t('player.nearLimit', { coils: coils.join(', '), ontime: limitLabel(hw, 'ontime'), duty: limitLabel(hw, 'duty') }, coils.length);
});
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
// per-channel VU colour + mapped flag (recomputed on song change, not per frame) →
// fed to <viz-tabs> alongside the reactive `level` array it updates each frame.
const vuBackgrounds = computed(() =>
  Array.from({ length: MIDI_CHANNEL_COUNT }, (_, ch) => channelBackground(ch)),
);
const vuMapped = computed(() =>
  Array.from({ length: MIDI_CHANNEL_COUNT }, (_, ch) => channelMapped(ch)),
);

function resetNotes(): void {
  for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) level[i] = 0;
}

function loadSong(s: Song): void {
  const newPath = s.midiFile ? fileUrl(s.midiFile) : null;
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
  const driver = midiStore.driver;
  // the device may lack the file's library envelopes, or hold another version
  for (const frame of driver.libraryEnvelopes(analysis.value?.programs ?? [])) midiStore.sendSysex(frame);
  for (const frame of driver.coilConfig(song.value.coils ?? [], song.value.mode ?? 'midi')) {
    midiStore.sendSysex(frame);
  }
  // sent even when the song has none: the coils would keep the previous song's places
  for (const frame of driver.stereo(song.value.stereo, song.value.coilCount)) midiStore.sendSysex(frame);
  for (const message of driver.stereoChannels(song.value.stereo)) midiStore.midiOutput?.send(message);
}

/*
 * Power automation, sent as the song is HEARD rather than queued ahead on the
 * output with the notes: every send takes the live power as it is at that
 * moment, so the fader always applies on top of the automation. A frame queued
 * ahead could not be recalled when the fader moves (clearing the output would
 * drop the notes too). A timer tick of jitter is harmless for power changes.
 */
// the editor offers to add an automation point where the song is: a few updates a
// second are plenty for that (and every seek or pause, when the value settles)
let lastPositionEmit = 0;
watch(playheadMs, (ms) => {
  const now = performance.now();
  if (isPlaying.value && now - lastPositionEmit < 200) return;
  lastPositionEmit = now;
  emit('position', ms);
});

const AUTOMATION_TICK_MS = 50;
let automationTimer: ReturnType<typeof setInterval> | null = null;
// last level sent per coil: a ramp only sends when the rounded value changes,
// which keeps a serial link from saturating
const sentLevels = new Map<number, { ontimeUs: number; dutyKey: number }>();
const DUTY_STEPS = 2000; // 0.05 % of duty

/** Send each coil its configured values × the automation at `ms` × the live power. */
function sendCoilLevels(ms: number, force = false): void {
  const out = midiStore.midiOutput;
  if (!out || !song.value) return;
  const driver = midiStore.driver;
  for (const coil of song.value.coils ?? []) {
    const lvl = coilLevelAt(song.value.events ?? [], coil, ms, powerOf(coil.coilIndex), powerOf(coil.coilIndex));
    const dutyKey = Math.round(lvl.duty * DUTY_STEPS);
    const last = sentLevels.get(coil.coilIndex);
    if (force || last?.ontimeUs !== lvl.ontimeUs) out.send(driver.coilLevel(coil.coilIndex, 'ontime', lvl.ontimeUs));
    if (force || last?.dutyKey !== dutyKey) out.send(driver.coilLevel(coil.coilIndex, 'duty', lvl.duty));
    sentLevels.set(coil.coilIndex, { ontimeUs: lvl.ontimeUs, dutyKey });
  }
}
/** The song position being heard now (the output runs PLAY_LATENCY_MS ahead). */
function heardMs(): number {
  return Math.max(0, performance.now() - playStart - PLAY_LATENCY_MS);
}
function startAutomation(): void {
  stopAutomation();
  if (!song.value?.events?.length) return; // no curve: the fader alone, sent by applyLive
  automationTimer = setInterval(() => { if (isPlaying.value) sendCoilLevels(heardMs()); }, AUTOMATION_TICK_MS);
}
function stopAutomation(): void {
  if (automationTimer) { clearInterval(automationTimer); automationTimer = null; }
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
  stopAutomation();
  resetNotes();
}

/** Unified entry: (re)configure and play from song-position `fromMs` (0 = the start). */
function playFrom(fromMs: number): void {
  if (!parsedMidiFile.value || !midiStore.midiOutput) return;
  midiStore.midiOutput.resume?.(); // unlock the synth's AudioContext (a play is a gesture)
  const wasPlaying = isPlaying.value;
  cancelTailSilence(); // it would cut this song's first notes
  teardownPlayback();
  seedPrograms();
  executeConfig();
  smfPlayer = buildPlayer();
  if (fromMs > 0) smfPlayer.seek(fromMs); // position the cursor (eventTime ≈ fromMs)
  else smfPlayer.setGM();
  sendCoilLevels(smfPlayer.eventTime, true); // coils → their level at this position
  // map wall-now to this song position, then schedule the notes; the automation follows the playhead
  smfPlayer.startTime = performance.now() - smfPlayer.eventTime;
  startPlayhead();
  startAutomation();
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
  silence(); // the coils stop where the playhead stops, so resuming there doubles nothing
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

const SEEK_STEP_MS = 5000;
function seekBy(deltaMs: number): void {
  seek(playheadMs.value + deltaMs);
}
function onSeekKey(e: KeyboardEvent): void {
  const steps: Record<string, number> = { ArrowLeft: -SEEK_STEP_MS, ArrowDown: -SEEK_STEP_MS, ArrowRight: SEEK_STEP_MS, ArrowUp: SEEK_STEP_MS, PageDown: -30000, PageUp: 30000 };
  if (e.key in steps) seekBy(steps[e.key]);
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'End') seek(durationMs.value);
  else return;
  e.preventDefault();
}

/** Flush an output's scheduled-but-unsent messages, if the browser supports it. */
function clearOutput(out: typeof midiStore.midiOutput): void {
  const o = out as unknown as { clear?: () => void } | null;
  if (o && typeof o.clear === 'function') o.clear();
}

function stop(): void {
  const wasPlaying = isPlaying.value;
  const active = wasPlaying || paused.value;
  teardownPlayback();
  if (active) silence();
  isPlaying.value = false;
  paused.value = false;
  if (wasPlaying) emit('playingChange', false);
  playheadMs.value = 0;
}

// The coils go quiet at once (silenceCoils), but the notes already queued on a Web
// MIDI output still come out for up to a look-ahead, on the 2nd output (speakers)
// too: a last All Sound Off follows them.
let tailTimer: ReturnType<typeof setTimeout> | null = null;
function silence(): void {
  midiStore.silenceCoils();
  cancelTailSilence();
  tailTimer = setTimeout(() => {
    tailTimer = null;
    midiStore.midiOutput?.sendAllSoundOff();
    midiStore.midiOutput2?.sendAllSoundOff();
  }, PLAY_LATENCY_MS + 100);
}
function cancelTailSilence(): void {
  if (tailTimer) { clearTimeout(tailTimer); tailTimer = null; }
}
// Panic, from this player, the Play page's Esc or the Live/Fixed modes
watch(() => midiStore.panicRev, () => stop());
// the engine holds the outputs it was built with: a song can't carry on on another one
watch(() => midiStore.midiOutput, (out, prev) => {
  if (!isPlaying.value && !paused.value) return;
  stop();
  if (prev && prev !== out) midiStore.silenceCoils(prev);
});

const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => isPlaying.value && !tour.active);

// One live update: re-send each coil at the automation's level where the song is
// heard × the new live power.
function applyLive(): void {
  sendCoilLevels(isPlaying.value ? heardMs() : playheadMs.value, true);
}
// While a fader moves: at most one update per automation tick, and only the coils
// whose rounded level changed, which a serial link keeps up with.
let liveTimer: ReturnType<typeof setTimeout> | null = null;
function applyLiveSoon(): void {
  if (liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    sendCoilLevels(isPlaying.value ? heardMs() : playheadMs.value);
  }, AUTOMATION_TICK_MS);
}
watch(masterPower, applyLiveSoon);
function onPowerChange(): void {
  if (Math.abs(masterPower.value - 100) <= 3) masterPower.value = 100; // snap to unity ("home")
  applyLive();
}
function toggleCap(): void {
  powerCapped.value = !powerCapped.value;
  if (!powerCapped.value) return;
  masterPower.value = Math.min(masterPower.value, 100);
  for (const k of Object.keys(coilPower)) coilPower[+k] = Math.min(coilPower[+k], 100);
  applyLive();
}
// Switching to Advanced INHERITS the current global power into each coil's own;
// switching back to Global starts from the lowest coil setting: either way no coil jumps up.
function setScope(next: PowerScope): void {
  if (next === powerScope.value) return;
  const coils = song.value?.coils ?? [];
  if (next === 'advanced') {
    for (const c of coils) coilPower[c.coilIndex] = masterPower.value;
  } else if (coils.length) {
    masterPower.value = Math.min(...coils.map((c) => coilPower[c.coilIndex] ?? 100));
  }
  powerScope.value = next;
  applyLive();
}
/** The keyboard's power step: every coil together, never past the cap. */
function nudgePower(delta: number): void {
  const clamp = (v: number): number => Math.max(0, Math.min(powerMax.value, v + delta));
  if (powerScope.value === 'advanced') {
    for (const c of song.value?.coils ?? []) coilPower[c.coilIndex] = clamp(coilPower[c.coilIndex] ?? 100);
  } else {
    masterPower.value = clamp(masterPower.value);
  }
  applyLive();
}
function resetPower(): void {
  masterPower.value = 100;
  for (const c of song.value?.coils ?? []) coilPower[c.coilIndex] = 100;
  applyLive();
}
// The panel is controlled: it streams a coil's drag back via @coil-input (stored here,
// the row follows) and fires @coil-change on release (→ applyLive).
function onCoilInput(coilIndex: number, value: number): void {
  coilPower[coilIndex] = value;
  applyLiveSoon();
}

function loadMidiFile(url: string): Promise<ArrayBuffer> {
  return axios.get(url, { responseType: 'arraybuffer' }).then((r) => r.data as ArrayBuffer);
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

onBeforeUnmount(() => {
  stop(); // stop playback + clear timers if the player unmounts
  if (liveTimer) clearTimeout(liveTimer);
});

defineExpose({ loadSong, playSong, stop, togglePlayPause, seekBy, nudgePower });
</script>

<template>
  <article class="player-panel">
    <header class="player-panel__head">
      <span class="player-panel__title"><span class="icon"><i class="fas" :class="ICONS.player"></i></span>{{
        $t('title.player') }}</span>
      <span v-if="midiStore.isSynthOutput" class="player-synth-badge"><i class="fas" :class="ICONS.synth"></i>{{
        $t('label.synthActive') }}</span>
      <label v-if="props.showAutoplay" class="switch player-panel__autoplay">
        <input type="checkbox" :checked="midiStore.autoplay" @change="onAutoplayToggle" />
        <span class="switch__track"></span>
        <span class="switch__text">{{ $t('label.autoplay') }}</span>
      </label>
    </header>

    <p v-if="midiStore.outputLost" class="player-alert" role="alert">
      <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>
      <span class="player-alert__text">{{ $t('player.outputLost', { name: midiStore.outputLost }) }}</span>
      <button class="icon-btn player-alert__x" type="button" :aria-label="$t('player.dismiss')"
        :title="$t('player.dismiss')" @click="midiStore.setOutputLost(null)"><i class="fas fa-xmark"></i></button>
    </p>
    <board-alert />

    <div class="player-song">
      <span class="icon"><i class="fas fa-music"></i></span>
      <span v-if="song" class="player-song__name">{{ song.name }}</span>
      <span v-else class="player-song__empty">{{ $t('label.noSongLoaded') }}</span>
      <span v-if="mutedCoils" class="player-muted" :title="$t('board.mutedHint', { n: midiStore.deviceProfile.coils })">
        <i class="fas fa-volume-xmark"></i>{{ mutedCoils }}
      </span>
    </div>

    <!-- playback progress (click / drag to seek), right under the song title -->
    <div v-if="song" class="player-progress">
      <div class="player-progress__bar" :class="{ 'is-scrubbing': scrubbing }" ref="seekBar" @pointerdown="onSeekDown"
        :title="$t('label.seek')" role="slider" tabindex="0" :aria-label="$t('label.seek')" aria-valuemin="0"
        :aria-valuemax="Math.round(durationMs / 1000)" :aria-valuenow="Math.round(playheadMs / 1000)"
        :aria-valuetext="`${fmt(playheadMs)} / ${fmt(durationMs)}`" @keydown="onSeekKey">
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

    <viz-tabs v-model:viz="viz" :level="level" :backgrounds="vuBackgrounds"
      :mapped="vuMapped" :analysis="analysis" :coils="song?.coils ?? []"
      :output2-mask="song?.output2Mask ?? 0" :playhead-ms="playheadMs" :playing="isPlaying" :paused="paused"
      :compact="compactGraph" :sim="sim" :load-coils="loadCoils" :ceilings="volumeCeilings" />

    <!-- LIVE POWER: a GLOBAL ⇄ ADVANCED toggle. Global = one Power fader (ontime+duty,
         all coils); Advanced = per-coil ontime/duty sliders for fine-tuning. -->
    <power-control-panel v-model:master-power="masterPower" :scope="powerScope" :coil-rows="coilRows"
      :boost="powerBoost" :dirty="masterDirty" :has-song="!!song" :capped="powerCapped" :max="powerMax"
      @set-scope="setScope" @power-change="onPowerChange" @coil-input="onCoilInput" @coil-change="applyLive"
      @reset="resetPower" @toggle-cap="toggleCap" />


    <p v-if="limitWarn" class="player-limit" role="status">
      <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ limitWarn }}
    </p>

    <div class="player-transport">
      <button class="btn btn--volt" type="button" :disabled="!canTransport" @click="togglePlayPause">
        <span class="icon"><i class="fas" :class="isPlaying ? 'fa-pause' : 'fa-play'"></i></span>{{ isPlaying
          ? $t('player.pause') : $t('player.play') }}
      </button>
      <button class="btn btn--stop" type="button" :disabled="!canStop" @click="stop">
        <span class="icon"><i class="fas fa-stop"></i></span>{{ $t('player.stop') }}
      </button>
      <!-- .btn--danger: every look dresses it as its own red; control/_chrome.scss sets it apart -->
      <button class="btn btn--danger btn--panic" type="button" :disabled="!canPanic" :title="$t('player.panicHint')"
        @click="midiStore.panic()">
        <span class="icon"><i class="fas fa-bell-slash"></i></span>{{ $t('player.panic') }}
      </button>
      <button class="btn" type="button" :disabled="!canSysex" @click="executeConfig">
        <span class="icon"><i class="fas fa-wrench"></i></span>{{ $t('label.executeConfiguration') }}
      </button>
    </div>

    <confirm-modal :open="leavePending" :title="$t('player.leaveTitle')"
      :message="$t('player.leaveQuestion', { name: song?.name ?? '' })" :confirm-label="$t('player.leaveConfirm')"
      :cancel-label="$t('player.stay')" @confirm="answerLeave(true)" @close="answerLeave(false)" />
  </article>
</template>
