<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { WebMidi, type Input } from 'webmidi';
import { useMidiStore } from '@/stores/midi';
import { compileCoilConfig, compileCustomEnvelopes, compileStereo } from '@/sysex/syntherrupter';
import { customEnvelope, programChange } from '@/sysex/envelopes';
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

/* --------------------------------- source --------------------------------- */
// ONE source at a time: a MIDI controller (relayed; the on-screen keyboard only
// mirrors it) or the computer (pointer on the keys + letter rows). Switching ends
// a running session, like changing the input does.
type LiveSource = 'midi' | 'pc';
const storedSource = localStorage.getItem('liveSource')
  ?? (localStorage.getItem('livePianoMode') === 'monitor' ? 'midi' : 'pc'); // pre-switch setting
const source = ref<LiveSource>(storedSource === 'midi' ? 'midi' : 'pc');
localStorage.removeItem('livePianoMode');
watch(source, (s) => {
  localStorage.setItem('liveSource', s);
  if (running.value) stop();
  bindInput();
});
const sourceOptions = computed(() => [
  { value: 'midi' as LiveSource, label: t('label.liveSourceMidi'), icon: 'fa-plug' },
  { value: 'pc' as LiveSource, label: t('label.liveSourcePc'), icon: 'fa-keyboard' },
]);

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

// With the MIDI source, the selected input is MONITORED as soon as it's picked (the
// keyboard lights up before the coils are armed — a pre-flight "is my controller
// talking?"); its messages are only FORWARDED to the outputs while `running`.
// With the computer source, no input is bound at all.
let boundInput: Input | null = null;
function bindInput(): void {
  if (boundInput) { boundInput.removeListener('midimessage', onMidiMessage); boundInput = null; }
  clearAllNotes(); // whatever the previous device held is gone
  boundInput = source.value === 'midi' ? selectedInput.value : null;
  boundInput?.addListener('midimessage', onMidiMessage);
}
watch(selectedInput, (input, prev) => {
  bindInput();
  if (!input && prev && running.value && source.value === 'midi') stop(); // the bound device went away
});

/* ---------------------------- passthrough engine -------------------------- */
const running = ref(false);
// an output, plus a controller when relaying one
const canRun = computed(() => !!midiStore.midiOutput && (source.value === 'pc' || !!selectedInput.value));
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

// library envelopes written to the device this session: the controller may pick
// one at any time, and each is only worth sending once
const writtenEnvelopes = new Set<number>();
function writeEnvelopes(programs: Iterable<number>): void {
  const fresh = [...programs].filter((p) => !writtenEnvelopes.has(p) && customEnvelope(p));
  for (const frame of compileCustomEnvelopes(fresh)) midiStore.sendSysex(frame);
  for (const p of fresh) writtenEnvelopes.add(p);
}

function sendConfig(): void {
  for (const frame of compileCoilConfig(cfg.coils, 'midi')) midiStore.sendSysex(frame);
  // live mode has no spatialisation: undo the last song's, or it would move the notes played here
  for (const frame of compileStereo(null, 0)) midiStore.sendSysex(frame);
  writeEnvelopes(channelOverride.value.values());
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
  if (kind === 0xc0 && running.value) writeEnvelopes([data[1]]);
  if (running.value) sendToOutputs(data);
  // monitor — mirrors the note state on the keyboard and the channel LEDs
  if (kind === 0x90 && data[2] > 0) { setNote(data[1], ch, true); flashChannel(ch); }
  else if (kind === 0x80 || kind === 0x90) setNote(data[1], ch, false);
  else if (kind === 0xb0 && (data[1] === 120 || data[1] === 123)) clearChannelNotes(ch); // all sound/notes off
}

function start(): void {
  if (!canRun.value || running.value) return;
  midiStore.midiOutput?.resume?.(); // built-in synth: the click is the user gesture that unlocks audio
  writtenEnvelopes.clear(); // the device may have rebooted since the last session
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
const PIANO_VELOCITY = 100;
/** persisted integer, or `d` when absent/garbage (`Number(null)` would be 0, not NaN) */
function storedInt(key: string, d: number): number {
  const raw = localStorage.getItem(key);
  return raw == null ? d : num(parseInt(raw, 10), d);
}
const pianoStart = ref(storedInt('livePianoStart', 36)); // C2 — the keyboard clamps/snaps it
watch(pianoStart, (s) => localStorage.setItem('livePianoStart', String(s)));
const playChannel = ref(Math.min(MIDI_CHANNEL_COUNT - 1, Math.max(0, storedInt('livePianoChannel', 0))));
watch(playChannel, (c) => localStorage.setItem('livePianoChannel', String(c)));

const pianoInteractive = computed(() => source.value === 'pc' && running.value);

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
    <!-- one console: where the notes come from, start/stop, the keyboard and the channels -->
    <article class="live-console">
      <header class="live-console__head">
        <segmented-control v-model="source" class="live-source" pressed :aria-label="$t('label.liveSource')"
          :options="sourceOptions" />
        <span v-if="midiStore.isSynthOutput" class="player-synth-badge"><i class="fas fa-wave-square"></i>{{
          $t('label.synthActive') }}</span>
        <div class="live-console__run">
          <span class="live-status" :class="{ 'is-live': running }">
            <span class="live-dot"></span>{{ running ? $t('label.liveRunning') : $t('label.liveStopped') }}
          </span>
          <button class="btn" :class="running ? 'btn--danger' : 'btn--volt'" type="button" :disabled="!canRun"
            @click="toggle">
            <span class="icon"><i class="fas" :class="running ? 'fa-stop' : 'fa-play'"></i></span>
            {{ running ? $t('label.stop') : $t('label.start') }}
          </button>
        </div>
      </header>

      <p v-if="!midiStore.midiOutput" class="player-hint live-console__hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
      </p>

      <!-- MIDI: the keyboard mirrors the controller (before Start too: "is it talking?"); PC: it plays -->
      <piano-keyboard v-model:start-note="pianoStart" :held="noteChannels" :color-of="noteColor"
        :interactive="pianoInteractive" @note-on="onPianoNoteOn" @note-off="onPianoNoteOff">
        <template #toolbar>
          <template v-if="source === 'midi'">
            <div v-if="inputs.length" class="select-field live-device">
              <select v-model="selectedInputId" :aria-label="$t('label.midiInput')" @change="onInputChange">
                <option :value="null">{{ $t('label.chooseMidiInput') }}</option>
                <option v-for="i in inputs" :key="i.id" :value="i.id">{{ i.name }}</option>
              </select>
            </div>
            <span v-else class="live-warn">
              <i class="fas fa-triangle-exclamation"></i>{{ $t('label.noMidiInput') }}
            </span>
          </template>
          <span v-else class="live-pc-hint">{{ $t('label.pcKeysHint') }}</span>
        </template>
        <template #overlay>
          <button v-if="source === 'pc' && !running && canRun" type="button" class="live-piano__arm"
            @click="start">
            <span class="icon"><i class="fas fa-play"></i></span>{{ $t('label.startToPlay') }}
          </button>
        </template>
      </piano-keyboard>

      <!-- channel strip: activity LEDs; from the computer it also picks the output channel -->
      <div class="live-chans">
        <span class="live-chans__label">
          {{ source === 'pc' ? $t('label.outputChannel') : $t('label.channels') }}
        </span>
        <div class="live-chans__grid" role="group"
          :aria-label="source === 'pc' ? $t('label.outputChannel') : $t('label.channels')">
          <button v-for="i in MIDI_CHANNEL_COUNT" :key="i - 1" type="button" class="live-chan" :class="{
            'is-lit': channelLit(i - 1),
            'is-unmapped': !channelMapped(i - 1),
            'is-pick': source === 'pc',
            'is-selected': source === 'pc' && playChannel === i - 1,
          }" :style="{ '--c': channelBackground(i - 1) }" :disabled="source !== 'pc'"
            :aria-pressed="source === 'pc' ? playChannel === i - 1 : undefined"
            :title="channelMapped(i - 1) ? undefined : $t('label.channelUnmapped')" @click="playChannel = i - 1">
            {{ i - 1 }}
          </button>
        </div>
        <span v-if="source === 'pc' && !channelMapped(playChannel)" class="live-chans__warn">
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
