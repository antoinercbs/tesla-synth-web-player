<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { WebMidi, type Input } from 'webmidi';
import { useMidiStore } from '@/stores/midi';
import { compileCoilConfig } from '@/sysex/syntherrupter';
import { programChange } from '@/sysex/envelopes';
import { coilColor } from '@/ui/coil-colors';
import { MAX_COILS, MIN_COILS, MIDI_CHANNEL_COUNT } from '@/types/domain';
import type { CoilConfig } from '@/types/domain';
import CoilConfigCard from '@/components/CoilConfigCard.vue';

const midiStore = useMidiStore();
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
  if (running.value && !selectedInput.value) stop(); // the bound device went away
}
function onInputChange(): void {
  if (selectedInputId.value) localStorage.setItem('midiLiveInputId', selectedInputId.value);
  else localStorage.removeItem('midiLiveInputId');
  if (running.value) stop(); // input changed → require an explicit restart
}

/* ---------------------------- passthrough engine -------------------------- */
const running = ref(false);
const litChannels = reactive<boolean[]>(Array(MIDI_CHANNEL_COUNT).fill(false));
const ledTimers: Array<ReturnType<typeof setTimeout> | null> = Array(MIDI_CHANNEL_COUNT).fill(null);
let boundInput: Input | null = null;

const canRun = computed(() => !!selectedInput.value && !!midiStore.midiOutput);
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

interface MidiMessageEvent { message: { data: number[] } }
function onMidiMessage(e: MidiMessageEvent): void {
  const data = e.message?.data;
  if (!data || data.length === 0) return;
  const status = data[0];
  // keep our envelope override: swallow incoming Program Change on overridden channels
  if ((status & 0xf0) === 0xc0 && channelOverride.value.has(status & 0x0f)) return;
  // forward channel-voice messages only (note/CC/pitch…), skip realtime/sysex spam
  if (status >= 0x80 && status < 0xf0) {
    midiStore.midiOutput?.send(data);
    midiStore.midiOutput2?.send(data);
    if ((status & 0xf0) === 0x90 && data[2] > 0) flashChannel(status & 0x0f);
  }
}
function flashChannel(ch: number): void {
  litChannels[ch] = true;
  const t = ledTimers[ch];
  if (t) clearTimeout(t);
  ledTimers[ch] = setTimeout(() => { litChannels[ch] = false; ledTimers[ch] = null; }, 220);
}
function resetNotes(): void {
  for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) {
    litChannels[i] = false;
    const t = ledTimers[i];
    if (t) { clearTimeout(t); ledTimers[i] = null; }
  }
}
function start(): void {
  if (!canRun.value || running.value) return;
  sendConfig();
  boundInput = selectedInput.value;
  boundInput?.addListener('midimessage', onMidiMessage);
  running.value = true;
}
function stop(): void {
  if (resendTimer) { clearTimeout(resendTimer); resendTimer = null; }
  if (boundInput) { boundInput.removeListener('midimessage', onMidiMessage); boundInput = null; }
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
  resetNotes();
  running.value = false;
}
function toggle(): void { if (running.value) stop(); else start(); }
// if the output device disappears mid-session, tear the session down (keeps the
// LIVE indicator/VU honest — mirrors the input-removed policy)
watch(canRun, (ok) => { if (!ok && running.value) stop(); });

/* ------------------------------- VU colours ------------------------------- */
function channelColors(ch: number): string[] {
  return cfg.coils.filter((c) => (c.channelMask & (1 << ch)) !== 0).map((c) => coilColor(c.coilIndex));
}
function channelBackground(ch: number): string {
  const cols = channelColors(ch);
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
function channelMapped(ch: number): boolean {
  return cfg.coils.some((c) => (c.channelMask & (1 << ch)) !== 0);
}

onMounted(() => {
  refreshInputs();
  if (WebMidi.enabled) {
    WebMidi.addListener('connected', refreshInputs);
    WebMidi.addListener('disconnected', refreshInputs);
  }
});
onBeforeUnmount(() => {
  stop();
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
        <span class="field-label">{{ $t('label.midiInput') }}</span>
        <div class="select-field">
          <select v-model="selectedInputId" @change="onInputChange">
            <option :value="null">—</option>
            <option v-for="i in inputs" :key="i.id" :value="i.id">{{ i.name }}</option>
          </select>
        </div>
        <span v-if="inputs.length === 0" class="live-bar__warn">{{ $t('label.noMidiInput') }}</span>
      </div>

      <div class="live-bar__status" :class="{ 'is-live': running }">
        <span class="live-dot"></span>{{ running ? $t('label.liveRunning') : $t('label.liveStopped') }}
      </div>

      <button class="btn" :class="running ? 'btn--danger' : 'btn--volt'" type="button" :disabled="!canRun" @click="toggle">
        <span class="icon"><i class="fas" :class="running ? 'fa-stop' : 'fa-play'"></i></span>
        {{ running ? $t('label.stop') : $t('label.start') }}
      </button>

      <p v-if="!midiStore.midiOutput" class="player-hint live-bar__hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
      </p>
      <p v-else-if="!selectedInput" class="player-hint live-bar__hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectInputHint') }}
      </p>
    </article>

    <!-- channel activity monitor -->
    <article class="live-monitor">
      <div class="vu">
        <div class="vu__head">
          <span class="vu__label">{{ $t('label.channels') }}</span>
          <span v-if="midiStore.isSynthOutput" class="player-synth-badge"><i class="fas fa-wave-square"></i>{{ $t('label.synthActive') }}</span>
        </div>
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
    </article>

    <!-- standalone coil mapping -->
    <section class="live-section">
      <header class="live-section__head">
        <span class="live-section__title">
          <span class="icon"><i class="fas fa-bolt"></i></span>{{ $t('label.coilMapping') }}
        </span>
        <div class="segmented" role="group" :aria-label="$t('label.coilCount')">
          <button v-for="n in coilRange" :key="n" type="button" :aria-pressed="cfg.coilCount === n"
            :class="{ 'is-active': cfg.coilCount === n }" @click="cfg.coilCount = n">{{ n }}</button>
        </div>
      </header>
      <div class="coils-grid">
        <CoilConfigCard v-for="i in cfg.coilCount" :key="i - 1" v-model="cfg.coils[i - 1]" :index="i - 1"
          :show-envelope="true" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.live { display: flex; flex-direction: column; gap: 1.2rem; }
/* the hint lives INSIDE the control-bar card, full-width on its own line */
.live-bar__hint { flex: 1 1 100%; margin: 0.2rem 0 0; }

/* control bar */
.live-bar {
  display: flex; align-items: flex-end; gap: 1.1rem; flex-wrap: wrap;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.2rem;
}
.live-bar__field { display: flex; flex-direction: column; gap: 0.35rem; flex: 1 1 16rem; min-width: 0; }
.live-bar__field .select-field { width: 100%; }
.live-bar__warn { color: var(--coil-1); font-family: var(--font-mono); font-size: 0.78rem; }
.live-bar__status {
  display: inline-flex; align-items: center; gap: 0.45rem;
  font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.08em;
  font-size: 0.78rem; color: var(--text-mute); padding-bottom: 0.55rem;
}
.live-bar__status.is-live { color: var(--volt); }
.live-dot {
  width: 0.7rem; height: 0.7rem; border-radius: 50%;
  background: var(--text-mute); transition: 0.2s;
}
.live-bar__status.is-live .live-dot {
  background: var(--volt); box-shadow: 0 0 10px var(--volt);
  animation: live-pulse 1.4s ease-in-out infinite;
}
@keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

/* monitor */
.live-monitor {
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
}
.vu__head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; }
.vu__head .vu__label { margin-bottom: 0; }

/* coil mapping section */
.live-section__head {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  margin-bottom: 1rem; flex-wrap: wrap;
}
.live-section__title {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.07em;
  font-size: 0.9rem; color: var(--text);
}
.live-section__title .icon { color: var(--volt); }
</style>
