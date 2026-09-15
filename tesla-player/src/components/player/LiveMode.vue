<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { WebMidi, type Input } from 'webmidi';
import { useMidiStore } from '@/stores/midi';
import { compileCoilConfig } from '@/sysex/syntherrupter';
import { programChange } from '@/sysex/envelopes';
import { coilColor } from '@/ui/coil-colors';
import { MIDI_NOTE_COUNT } from '@/ui/piano-layout';
import { MAX_COILS, MIN_COILS, MIDI_CHANNEL_COUNT } from '@/types/domain';
import type { CoilConfig } from '@/types/domain';
import CoilConfigCard from '@/components/editor/CoilConfigCard.vue';
import PianoKeyboard from '@/components/player/PianoKeyboard.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

const midiStore = useMidiStore();
const { t } = useI18n();
const coilRange = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => MIN_COILS + i);

function defaultCoil(index: number): CoilConfig {
  return { coilIndex: index, channelMask: 0, ontimeUs: 40, duty: 0.05, program: null };
}
/** keep only finite numbers from (possibly corrupt) persisted config */
function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/* -------- standalone coil mapping (persisted, independent of any song) ------- */
const STORE_KEY = 'liveConfig';
const cfg = reactive({
  coilCount: 3,
  coils: [defaultCoil(0), defaultCoil(1), defaultCoil(2)] as CoilConfig[],
});
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as { coilCount?: number; coils?: Partial<CoilConfig>[] };
    cfg.coilCount = Math.min(MAX_COILS, Math.max(MIN_COILS, parsed.coilCount ?? 3));
    cfg.coils = Array.from({ length: cfg.coilCount }, (_, i) => ({
      coilIndex: i,
      channelMask: num(parsed.coils?.[i]?.channelMask, 0),
      ontimeUs: num(parsed.coils?.[i]?.ontimeUs, 40),
      duty: num(parsed.coils?.[i]?.duty, 0.05),
      program: typeof parsed.coils?.[i]?.program === 'number' ? parsed.coils[i]!.program! : null,
    }));
  }
} catch {
  /* ignore malformed persisted config */
}

watch(() => cfg.coilCount, (n) => {
  if (cfg.coils.length === n) return;
  const next: CoilConfig[] = [];
  for (let i = 0; i < n; i++) next.push(cfg.coils[i] ?? defaultCoil(i));
  cfg.coils = next;
});
watch(cfg, () => {
  localStorage.setItem(STORE_KEY, JSON.stringify({ coilCount: cfg.coilCount, coils: cfg.coils }));
  if (running.value) scheduleResend(); // coalesce a burst of edits into one push
}, { deep: true });

/* ------------------------------ MIDI input -------------------------------- */
// shallowRef: a deep ref would run Input through Vue's UnwrapRef and strip the
// class's private members, breaking assignability to the nominal `Input` type.
const inputs = shallowRef<Input[]>([]);
const selectedInputId = ref<string | null>(localStorage.getItem('midiLiveInputId'));
const selectedInput = computed(() => inputs.value.find((i) => i.id === selectedInputId.value) ?? null);
function refreshInputs(): void {
  inputs.value = WebMidi.enabled ? [...WebMidi.inputs] : [];
}
function onInputChange(): void {
  if (selectedInputId.value) localStorage.setItem('midiLiveInputId', selectedInputId.value);
  else localStorage.removeItem('midiLiveInputId');
  if (running.value) stop(); // input changed → require an explicit restart
}

// The selected input is MONITORED as soon as it's picked (the keyboard lights up
// before the coils are armed — a pre-flight "is my controller talking?"); its
// messages are only FORWARDED to the outputs while `running`.
let boundInput: Input | null = null;
function bindInput(): void {
  if (boundInput) { boundInput.removeListener('midimessage', onMidiMessage); boundInput = null; }
  clearAllNotes(); // whatever the previous device held is gone
  boundInput = selectedInput.value;
  boundInput?.addListener('midimessage', onMidiMessage);
}
watch(selectedInput, (input, prev) => {
  bindInput();
  if (!input && prev && running.value) stop(); // the bound device went away
});

/* ---------------------------- passthrough engine -------------------------- */
const running = ref(false);
// Starting only needs an output: the on-screen keyboard plays without a controller.
const canRun = computed(() => !!midiStore.midiOutput);
let resendTimer: ReturnType<typeof setTimeout> | null = null;

// channel -> forced envelope program, derived from the per-coil overrides
const channelOverride = computed(() => {
  const map = new Map<number, number>();
  for (const c of cfg.coils) {
    if (c.program == null) continue;
    for (let ch = 0; ch < MIDI_CHANNEL_COUNT; ch++) {
      if (c.channelMask & (1 << ch)) map.set(ch, c.program);
    }
  }
  return map;
});

function sendConfig(): void {
  for (const frame of compileCoilConfig(cfg.coils, 'midi')) midiStore.sendSysex(frame);
  // force the chosen envelope on each overridden channel (Program Change)
  for (const [ch, program] of channelOverride.value) midiStore.midiOutput?.send(programChange(ch, program));
}
// debounce live mapping edits so a burst of keystrokes coalesces into one push
function scheduleResend(): void {
  if (resendTimer) clearTimeout(resendTimer);
  resendTimer = setTimeout(() => { resendTimer = null; if (running.value) sendConfig(); }, 300);
}
function sendToOutputs(data: number[]): void {
  midiStore.midiOutput?.send(data);
  midiStore.midiOutput2?.send(data);
}

interface MidiMessageEvent { message: { data: number[] } }
function onMidiMessage(e: MidiMessageEvent): void {
  const data = e.message?.data;
  if (!data || data.length === 0) return;
  const status = data[0];
  // channel-voice messages only (note/CC/pitch…), skip realtime/sysex spam
  if (status < 0x80 || status >= 0xf0) return;
  const kind = status & 0xf0;
  const ch = status & 0x0f;
  // keep our envelope override: swallow incoming Program Change on overridden channels
  if (kind === 0xc0 && channelOverride.value.has(ch)) return;
  if (running.value) sendToOutputs(data);
  // monitor — mirrors the note state on the keyboard and the channel LEDs
  if (kind === 0x90 && data[2] > 0) { setNote(data[1], ch, true); flashChannel(ch); }
  else if (kind === 0x80 || kind === 0x90) setNote(data[1], ch, false);
  else if (kind === 0xb0 && (data[1] === 120 || data[1] === 123)) clearChannelNotes(ch); // all sound/notes off
}

function start(): void {
  if (!canRun.value || running.value) return;
  midiStore.midiOutput?.resume?.(); // built-in synth: the click is the user gesture that unlocks audio
  sendConfig();
  running.value = true;
}
function stop(): void {
  if (resendTimer) { clearTimeout(resendTimer); resendTimer = null; }
  releaseVirtualNotes();
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
  clearAllNotes();
  running.value = false;
}
function toggle(): void { if (running.value) stop(); else start(); }
// if the output device disappears mid-session, tear the session down (keeps the
// LIVE indicator/keyboard honest — mirrors the input-removed policy)
watch(canRun, (ok) => { if (!ok && running.value) stop(); });

/* ------------------------------ note state -------------------------------- */
// per MIDI note: bitmask of the channels currently holding it (input + on-screen keys)
const noteChannels = reactive<number[]>(Array(MIDI_NOTE_COUNT).fill(0));
// short flash per channel so even a staccato note registers on the LEDs
const litChannels = reactive<boolean[]>(Array(MIDI_CHANNEL_COUNT).fill(false));
const ledTimers: Array<ReturnType<typeof setTimeout> | null> = Array(MIDI_CHANNEL_COUNT).fill(null);

function setNote(note: number, ch: number, on: boolean): void {
  if (note < 0 || note >= MIDI_NOTE_COUNT) return;
  const bit = 1 << ch;
  const next = on ? noteChannels[note] | bit : noteChannels[note] & ~bit;
  if (next !== noteChannels[note]) noteChannels[note] = next;
}
function clearChannelNotes(ch: number): void {
  const bit = 1 << ch;
  for (let n = 0; n < MIDI_NOTE_COUNT; n++) if (noteChannels[n] & bit) noteChannels[n] &= ~bit;
}
function clearAllNotes(): void {
  for (let n = 0; n < MIDI_NOTE_COUNT; n++) if (noteChannels[n]) noteChannels[n] = 0;
  for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) {
    litChannels[i] = false;
    const t = ledTimers[i];
    if (t) { clearTimeout(t); ledTimers[i] = null; }
  }
}
function flashChannel(ch: number): void {
  litChannels[ch] = true;
  const t = ledTimers[ch];
  if (t) clearTimeout(t);
  ledTimers[ch] = setTimeout(() => { litChannels[ch] = false; ledTimers[ch] = null; }, 220);
}
// channels with at least one note down right now
const heldChannelMask = computed(() => {
  let m = 0;
  for (let n = 0; n < MIDI_NOTE_COUNT; n++) m |= noteChannels[n];
  return m;
});
function channelLit(ch: number): boolean {
  return ((heldChannelMask.value >> ch) & 1) === 1 || litChannels[ch];
}

/* ---------------------------- on-screen keyboard -------------------------- */
type PianoMode = 'play' | 'monitor';
const PIANO_VELOCITY = 100;
const storedMode = localStorage.getItem('livePianoMode');
const pianoMode = ref<PianoMode>(storedMode === 'monitor' ? 'monitor' : 'play');
watch(pianoMode, (m) => localStorage.setItem('livePianoMode', m));
/** persisted integer, or `d` when absent/garbage (`Number(null)` would be 0, not NaN) */
function storedInt(key: string, d: number): number {
  const raw = localStorage.getItem(key);
  return raw == null ? d : num(parseInt(raw, 10), d);
}
const pianoStart = ref(storedInt('livePianoStart', 36)); // C2 — the keyboard clamps/snaps it
watch(pianoStart, (s) => localStorage.setItem('livePianoStart', String(s)));
const playChannel = ref(Math.min(MIDI_CHANNEL_COUNT - 1, Math.max(0, storedInt('livePianoChannel', 0))));
watch(playChannel, (c) => localStorage.setItem('livePianoChannel', String(c)));

// Monitor only means something with a controller plugged in
const monitorAvailable = computed(() => !!selectedInput.value);
watch(monitorAvailable, (ok) => { if (!ok && pianoMode.value === 'monitor') pianoMode.value = 'play'; });
const pianoInteractive = computed(() => pianoMode.value === 'play' && running.value);
const pianoModeOptions = computed(() => [
  { value: 'play' as PianoMode, label: t('label.pianoPlay'), icon: 'fa-hand-pointer', title: t('label.pcKeysHint') },
  {
    value: 'monitor' as PianoMode, label: t('label.pianoMonitor'), icon: 'fa-eye',
    disabled: !monitorAvailable.value, title: monitorAvailable.value ? '' : t('label.pianoMonitorNeedsInput'),
  },
]);

// notes the on-screen keyboard is holding, with the channel each was SENT on
// (so a channel change mid-hold still releases the right note)
const virtualHeld = new Map<number, number>();
function onPianoNoteOn(note: number): void {
  if (!running.value) return;
  if (virtualHeld.has(note)) onPianoNoteOff(note);
  const ch = playChannel.value;
  virtualHeld.set(note, ch);
  sendToOutputs([0x90 | ch, note, PIANO_VELOCITY]);
  setNote(note, ch, true);
  flashChannel(ch);
}
function onPianoNoteOff(note: number): void {
  const ch = virtualHeld.get(note);
  if (ch === undefined) return;
  virtualHeld.delete(note);
  sendToOutputs([0x80 | ch, note, 0]);
  setNote(note, ch, false);
}
function releaseVirtualNotes(): void {
  for (const note of [...virtualHeld.keys()]) onPianoNoteOff(note);
}

/* -------------------------------- colours --------------------------------- */
/** One colour → flat; several → hard-edged stripes (same recipe as the player VU). */
function stripes(cols: string[]): string {
  if (cols.length === 0) return 'var(--volt)';
  if (cols.length === 1) return cols[0];
  const n = cols.length;
  const band = 100 / n;
  const blend = band * 0.5;
  const stops = cols
    .flatMap((c, k) => {
      const start = k === 0 ? 0 : k * band + blend;
      const end = k === n - 1 ? 100 : (k + 1) * band - blend;
      return [`${c} ${start.toFixed(2)}%`, `${c} ${end.toFixed(2)}%`];
    })
    .join(', ');
  return `linear-gradient(90deg, ${stops})`;
}
function channelBackground(ch: number): string {
  return stripes(cfg.coils.filter((c) => (c.channelMask & (1 << ch)) !== 0).map((c) => coilColor(c.coilIndex)));
}
function channelMapped(ch: number): boolean {
  return cfg.coils.some((c) => (c.channelMask & (1 << ch)) !== 0);
}
/** Fill of a lit key: the coil colour(s) fed by the channel(s) holding the note. */
function noteColor(note: number): string {
  const mask = noteChannels[note];
  if (!mask) return '';
  return stripes(cfg.coils.filter((c) => (c.channelMask & mask) !== 0).map((c) => coilColor(c.coilIndex)));
}

onMounted(() => {
  refreshInputs();
  bindInput();
  if (WebMidi.enabled) {
    WebMidi.addListener('connected', refreshInputs);
    WebMidi.addListener('disconnected', refreshInputs);
  }
});
onBeforeUnmount(() => {
  stop();
  if (boundInput) { boundInput.removeListener('midimessage', onMidiMessage); boundInput = null; }
  if (WebMidi.enabled) {
    WebMidi.removeListener('connected', refreshInputs);
    WebMidi.removeListener('disconnected', refreshInputs);
  }
});
</script>

<template>
  <div class="live">
    <!-- control bar: input + output status + start/stop -->
    <article class="live-bar">
      <div class="live-bar__field">
        <label class="field-label" for="live-midi-input">{{ $t('label.midiInput') }}</label>
        <div class="select-field">
          <select id="live-midi-input" v-model="selectedInputId" @change="onInputChange">
            <option :value="null">—</option>
            <option v-for="i in inputs" :key="i.id" :value="i.id">{{ i.name }}</option>
          </select>
        </div>
        <span v-if="inputs.length === 0" class="live-bar__warn">{{ $t('label.noMidiInput') }}</span>
      </div>

      <div class="live-bar__status" :class="{ 'is-live': running }">
        <span class="live-dot"></span>{{ running ? $t('label.liveRunning') : $t('label.liveStopped') }}
      </div>

      <button class="btn" :class="running ? 'btn--danger' : 'btn--volt'" type="button" :disabled="!canRun"
        @click="toggle">
        <span class="icon"><i class="fas" :class="running ? 'fa-stop' : 'fa-play'"></i></span>
        {{ running ? $t('label.stop') : $t('label.start') }}
      </button>

      <p v-if="!midiStore.midiOutput" class="player-hint live-bar__hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
      </p>
      <p v-else-if="!selectedInput" class="player-hint live-bar__hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.keyboardOnlyHint') }}
      </p>
    </article>

    <!-- keyboard: plays the coils (Play) or mirrors the MIDI input (Monitor) -->
    <article class="live-monitor">
      <piano-keyboard v-model:start-note="pianoStart" :held="noteChannels" :color-of="noteColor"
        :interactive="pianoInteractive" @note-on="onPianoNoteOn" @note-off="onPianoNoteOff">
        <template #toolbar>
          <div class="live-piano__head">
            <segmented-control v-model="pianoMode" class="live-piano__mode" pressed :aria-label="$t('label.keyboard')"
              :options="pianoModeOptions" />
            <span v-if="midiStore.isSynthOutput" class="player-synth-badge"><i class="fas fa-wave-square"></i>{{
              $t('label.synthActive') }}</span>
          </div>
        </template>
        <template #overlay>
          <button v-if="pianoMode === 'play' && !running && canRun" type="button" class="live-piano__arm"
            @click="start">
            <span class="icon"><i class="fas fa-play"></i></span>{{ $t('label.startToPlay') }}
          </button>
        </template>
      </piano-keyboard>

      <!-- channel strip: activity LEDs; in Play mode it also picks the keyboard's output channel -->
      <div class="live-chans">
        <span class="live-chans__label">
          {{ pianoMode === 'play' ? $t('label.outputChannel') : $t('label.channels') }}
        </span>
        <div class="live-chans__grid" role="group"
          :aria-label="pianoMode === 'play' ? $t('label.outputChannel') : $t('label.channels')">
          <button v-for="i in MIDI_CHANNEL_COUNT" :key="i - 1" type="button" class="live-chan" :class="{
            'is-lit': channelLit(i - 1),
            'is-unmapped': !channelMapped(i - 1),
            'is-pick': pianoMode === 'play',
            'is-selected': pianoMode === 'play' && playChannel === i - 1,
          }" :style="{ '--c': channelBackground(i - 1) }" :disabled="pianoMode !== 'play'"
            :aria-pressed="pianoMode === 'play' ? playChannel === i - 1 : undefined"
            :title="channelMapped(i - 1) ? undefined : $t('label.channelUnmapped')" @click="playChannel = i - 1">
            {{ i - 1 }}
          </button>
        </div>
        <span v-if="pianoMode === 'play' && !channelMapped(playChannel)" class="live-chans__warn">
          <i class="fas fa-triangle-exclamation"></i>{{ $t('label.channelUnmapped') }}
        </span>
      </div>
    </article>

    <!-- standalone coil mapping -->
    <section class="live-section">
      <header class="live-section__head">
        <span class="live-section__title">
          <span class="icon"><i class="fas fa-bolt"></i></span>{{ $t('label.coilMapping') }}
        </span>
        <segmented-control v-model="cfg.coilCount" pressed :aria-label="$t('label.coilCount')"
          :options="coilRange.map((n) => ({ value: n, label: String(n) }))" />
      </header>
      <div class="coils-grid">
        <CoilConfigCard v-for="i in cfg.coilCount" :key="i - 1" v-model="cfg.coils[i - 1]" :index="i - 1"
          :show-envelope="true" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.live {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

/* the hint lives INSIDE the control-bar card, full-width on its own line */
.live-bar__hint {
  flex: 1 1 100%;
  margin: 0.2rem 0 0;
}

/* control bar */
.live-bar {
  display: flex;
  align-items: flex-end;
  gap: 1.1rem;
  flex-wrap: wrap;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.2rem;
}

.live-bar__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1 1 16rem;
  min-width: 0;
}

.live-bar__field .select-field {
  width: 100%;
}

.live-bar__warn {
  color: var(--coil-1);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.live-bar__status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.78rem;
  color: var(--text-mute);
  padding-bottom: 0.55rem;
}

.live-bar__status.is-live {
  color: var(--volt);
}

.live-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--text-mute);
  transition: 0.2s;
}

.live-bar__status.is-live .live-dot {
  background: var(--volt);
  box-shadow: 0 0 10px var(--volt);
  animation: live-pulse 1.4s ease-in-out infinite;
}

@keyframes live-pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.45;
  }
}

/* keyboard card */
.live-monitor {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.9rem 1rem 1rem;
}

.live-piano__head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
}

.live-piano__mode button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.72rem;
}

.live-piano__mode button .icon {
  font-size: 0.72rem;
  color: var(--text);
}

.live-piano__mode button.is-active .icon {
  color: var(--ink);
}

/* "arm the coils" pill floating over an idle, playable keyboard */
.live-piano__arm {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-pill);
  cursor: pointer;
  background: var(--scrim-90);
  border: 1px solid var(--volt);
  color: var(--volt);
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.74rem;
  font-weight: 600;
  box-shadow:
    0 10px 30px -10px rgba(0, 0, 0, 0.9),
    0 0 18px -6px var(--volt);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  transition: 0.15s;
  white-space: nowrap;
}

.live-piano__arm:hover,
.live-piano__arm:focus-visible {
  background: var(--volt);
  color: var(--ink);
  outline: none;
}

.live-piano__arm .icon {
  font-size: 0.7rem;
}

/* channel strip */
.live-chans {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.live-chans__label {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-size: 0.6rem;
  color: var(--text-dim);
}

.live-chans__grid {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 4px;
}

.live-chan {
  position: relative;
  height: 1.8rem;
  min-width: 0;
  padding: 0;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--line);
  cursor: default;
  transition:
    background 0.1s,
    color 0.1s,
    border-color 0.12s,
    box-shadow 0.12s,
    opacity 0.15s;
}

.live-chan.is-pick {
  cursor: pointer;
}

/* keyboard focus (e.g. after picking a chip, then playing on the PC keys): stay on-theme */
.live-chan:focus-visible {
  outline: 2px solid var(--volt);
  outline-offset: 2px;
}

.live-chan.is-pick:hover:not(.is-lit) {
  border-color: var(--line-strong);
  color: var(--text);
}

.live-chan.is-unmapped {
  opacity: 0.35;
}

.live-chan.is-lit {
  color: var(--ink);
  font-weight: 700;
  background: var(--c, var(--volt));
  border-color: transparent;
  box-shadow: 0 0 10px -3px rgba(255, 255, 255, 0.35);
  opacity: 1;
}

/* the keyboard's output channel: a volt ring, whatever its state */
.live-chan.is-selected {
  color: var(--text);
  font-weight: 700;
  border-color: var(--volt);
  box-shadow: 0 0 0 1px var(--volt), 0 0 10px -3px var(--volt);
  opacity: 1;
}

.live-chan.is-selected.is-lit {
  color: var(--ink);
  box-shadow: 0 0 0 1px var(--volt), 0 0 0 3px var(--panel), 0 0 12px -2px var(--volt);
}

.live-chan.is-selected::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 0;
  height: 0;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-bottom-color: var(--volt);
}

.live-chans__warn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--coil-1);
}

@media (max-width: 560px) {
  .live-chans__grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 5px;
  }
}

/* coil mapping section */
.live-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.live-section__title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-size: 0.9rem;
  color: var(--text);
}

.live-section__title .icon {
  color: var(--volt);
}
</style>
