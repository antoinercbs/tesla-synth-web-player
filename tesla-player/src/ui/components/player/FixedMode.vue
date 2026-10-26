<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import { sendSysex, type SysexOutput } from '@/engine/serial/live-sysex-helper';
import { coilColor } from '@/ui/helpers/coil-colors';
import { MAX_COILS, MIN_COILS } from '@/model/domain';
import type { SimpleCoil } from '@/model/domain';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import BoardAlert from '@/ui/components/player/BoardAlert.vue';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import { useLeaveGuard } from '@/ui/helpers/leave-guard';
import { tour } from '@/ui/tour/tour';
import { ICONS } from '@/ui/helpers/icons';
import { stage } from '@/ui/helpers/stage';
import { MidNote } from '@/model/midi/note';
import { DevOutput } from '@/model/devices/output';
import { pctLabel } from '@/utils/format';

const midiStore = useMidiStore();
// the board's outputs: a coil past them would not sound
const coilRange = computed(() =>
  Array.from({ length: midiStore.deviceProfile.coils - MIN_COILS + 1 }, (_, i) => MIN_COILS + i),
);

/** A fixed-mode coil plus an individual on/off switch (off = ontime forced to 0), and its
 *  frequency linked to the other linked coils' (they move together). */
interface FixedCoil extends SimpleCoil { enabled: boolean; linked: boolean }
function defaultCoil(index: number): FixedCoil {
  return { coilIndex: index, ontimeUs: 40, duty: 0.05, frequencyHz: 100, enabled: true, linked: false };
}
/** keep only finite numbers from (possibly corrupt) persisted config */
function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/* -------- standalone fixed config (persisted) -------- */
const STORE_KEY = 'fixedConfig';
const cfg = reactive({
  coilCount: 3,
  coils: [defaultCoil(0), defaultCoil(1), defaultCoil(2)] as FixedCoil[],
});
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as { coilCount?: number; coils?: Partial<FixedCoil>[] };
    cfg.coilCount = Math.min(MAX_COILS, Math.max(MIN_COILS, parsed.coilCount ?? 3));
    cfg.coils = Array.from({ length: cfg.coilCount }, (_, i) => ({
      coilIndex: i,
      ontimeUs: num(parsed.coils?.[i]?.ontimeUs, 40),
      duty: num(parsed.coils?.[i]?.duty, 0.05),
      frequencyHz: num(parsed.coils?.[i]?.frequencyHz, 100),
      enabled: parsed.coils?.[i]?.enabled ?? true,
      linked: parsed.coils?.[i]?.linked === true,
    }));
  }
} catch {
  /* ignore malformed persisted config */
}

// a coil switched off is sent silent (ontime AND duty 0) while the mode stays
// enabled — muting never hinges on a single parameter
const effectiveCoils = computed<SimpleCoil[]>(() =>
  cfg.coils.map((c) => ({
    coilIndex: c.coilIndex,
    ontimeUs: c.enabled ? c.ontimeUs : 0,
    duty: c.enabled ? c.duty : 0,
    frequencyHz: c.frequencyHz,
  })),
);
// what the board really fires: the duty, sent last, turns into the ontime at the BPS,
// then the coil's limits apply
const gauges = computed(() =>
  effectiveCoils.value.map((c) => {
    const lim = midiStore.coilLimit(c.coilIndex);
    const hz = c.frequencyHz;
    const asked = new DevOutput(c).fixedRequested(hz);
    const l = DevOutput.limit(hz > 0 ? [{ ontimeUs: asked, hz }] : [], lim);
    const us = l.pulsesUs[0] ?? 0;
    const maxOn = lim?.ontimeUs ?? null;
    // the pulse the max duty allows at this rate, min ontime included
    const dutyCapUs = lim?.duty != null && hz > 0 ? (lim.duty * 1e6) / hz : null;
    const by = l.factor < 1 ? 'byDuty' : maxOn != null && asked + (lim?.minOntimeUs ?? 0) > maxOn ? 'byOntime' : null;
    const scale = Math.max(asked, us, maxOn ?? 0, 1) * 1.08;
    const at = (v: number): string => `${Math.min(100, (v / scale) * 100)}%`;
    return {
      us, asked, by, maxOn, dutyCapUs, at,
      duty: (us * hz) / 1e6,
      maxDuty: lim?.duty ?? null,
      over: asked > us + 1,
      showDutyCap: dutyCapUs != null && dutyCapUs < scale,
    };
  }),
);
function toggleCoil(i: number): void {
  cfg.coils[i].enabled = !cfg.coils[i].enabled;
  if (running.value) sendConfig(); // mute/unmute takes effect immediately
}

watch(() => cfg.coilCount, (n) => {
  if (cfg.coils.length === n) return;
  const next: FixedCoil[] = [];
  for (let i = 0; i < n; i++) next.push(cfg.coils[i] ?? defaultCoil(i));
  cfg.coils = next;
});
watch(() => midiStore.deviceProfile.coils, (max) => {
  if (cfg.coilCount > max) cfg.coilCount = max;
}, { immediate: true });
watch(cfg, () => {
  localStorage.setItem(STORE_KEY, JSON.stringify({ coilCount: cfg.coilCount, coils: cfg.coils }));
  if (running.value) scheduleResend(); // coalesce keystrokes → no intermediate over-power
}, { deep: true });

/* -------- run engine -------- */
const running = ref(false);
const canRun = computed(() => !!midiStore.midiOutput && !midiStore.boardLatched);
let resendTimer: ReturnType<typeof setTimeout> | null = null;

function sendConfig(): void {
  for (const frame of midiStore.driver.simpleStart(effectiveCoils.value)) midiStore.sendSysex(frame);
}
// debounce live edits so a burst of keystrokes settles before re-arming coils
function scheduleResend(): void {
  if (resendTimer) clearTimeout(resendTimer);
  resendTimer = setTimeout(() => { resendTimer = null; if (running.value) sendConfig(); }, 300);
}
function start(): void {
  if (!canRun.value || running.value) return;
  midiStore.midiOutput?.resume?.(); // the built-in synth's audio starts on a gesture
  sendConfig();
  running.value = true;
}
function stop(): void {
  if (resendTimer) { clearTimeout(resendTimer); resendTimer = null; }
  for (const frame of midiStore.driver.simpleStop(cfg.coils)) midiStore.sendSysex(frame); // zero coils, then disable
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
  running.value = false;
}
function toggle(): void { if (running.value) stop(); else start(); }
// the tones were armed on the output they started on: stop them there, not on the new one
watch(() => midiStore.midiOutput, (out, prev) => {
  if (!running.value) return;
  if (prev && prev !== out) {
    try {
      for (const frame of midiStore.driverOf(prev).simpleStop(cfg.coils)) sendSysex(prev as SysexOutput, frame);
    } catch { /* unplugged */ }
    midiStore.silenceCoils(prev);
  }
  stop();
});
watch(() => midiStore.panicRev, () => { if (running.value) stop(); });
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => running.value && !tour.active);

/* duty is stored as a fraction (0..1) but edited as a percentage */
function dutyPct(d: number): number { return Math.round(d * 1e4) / 100; }
function onDutyInput(c: SimpleCoil, e: Event): void {
  const v = parseFloat((e.target as HTMLInputElement).value);
  c.duty = Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 0;
}

/* the firing rate is the pitch: a log slider over the coil's musical range (its middle ≈ 200 Hz);
   the field beside it takes anything else, a few sparks a second included */
const FREQ_MIN = 20;
const FREQ_MAX = 2000;
const TYPED_MIN = 1;
const TYPED_MAX = 5000;
const FREQ_STEPS = 1000;
const FREQ_SPAN = Math.log(FREQ_MAX / FREQ_MIN);
function freqToPos(hz: number): number {
  const f = Math.min(FREQ_MAX, Math.max(FREQ_MIN, hz || FREQ_MIN));
  return Math.round((Math.log(f / FREQ_MIN) / FREQ_SPAN) * FREQ_STEPS);
}
function posToFreq(pos: number): number {
  return Math.round(FREQ_MIN * Math.exp((pos / FREQ_STEPS) * FREQ_SPAN));
}
// A linked coil's slider moves every linked coil by the same ratio, so a chord keeps its
// intervals. Taken from where they all were as the move began: rounding to whole hertz at
// every step would wear the intervals away.
let moveStart: Map<number, number> | null = null;
function onFreqInput(c: FixedCoil, e: Event): void {
  const hz = posToFreq(Number((e.target as HTMLInputElement).value));
  if (!c.linked) {
    c.frequencyHz = hz;
    return;
  }
  moveStart ??= new Map(cfg.coils.filter((o) => o.linked).map((o) => [o.coilIndex, o.frequencyHz]));
  const ratio = hz / (moveStart.get(c.coilIndex) || hz);
  for (const o of cfg.coils) {
    const from = moveStart.get(o.coilIndex);
    if (from != null) o.frequencyHz = Math.min(FREQ_MAX, Math.max(FREQ_MIN, Math.round(from * ratio)));
  }
}
function endFreqMove(): void {
  moveStart = null;
}
function onFreqTyped(c: FixedCoil, e: Event): void {
  const input = e.target as HTMLInputElement;
  const hz = Math.round(Number(input.value));
  if (!Number.isFinite(hz) || hz < TYPED_MIN) { input.value = String(c.frequencyHz); return; }
  const target = Math.min(TYPED_MAX, hz);
  if (c.linked) {
    const ratio = target / (c.frequencyHz || target);
    for (const o of cfg.coils) {
      if (o.linked && o !== c) o.frequencyHz = Math.min(TYPED_MAX, Math.max(TYPED_MIN, Math.round(o.frequencyHz * ratio)));
    }
  }
  c.frequencyHz = target;
  input.value = String(target);
}
const allLinked = computed(() => cfg.coils.length > 1 && cfg.coils.every((c) => c.linked));
function toggleLinkAll(): void {
  const link = !allLinked.value;
  for (const c of cfg.coils) c.linked = link;
}
/** The note a firing rate sounds, "C3", when it is one. */
function freqNote(hz: number): string {
  const note = MidNote.nearest(hz);
  return hz > 0 && note >= 0 && note <= 127 ? MidNote.name(note) : '';
}

onBeforeUnmount(() => { if (running.value) stop(); });
</script>

<template>
  <div class="fixed">
    <!-- control bar -->
    <article class="fixed-bar">
      <!-- on stage the sidebar, which says it, is out of the way -->
      <span v-if="midiStore.isSynthOutput && stage.on" class="player-synth-badge"><i class="fas" :class="ICONS.synth"></i>{{
        $t('label.synthActive') }}</span>
      <button class="btn fixed-bar__run" :class="running ? 'btn--danger' : 'btn--volt'" type="button" :disabled="!canRun"
        @click="toggle">
        <span class="icon"><i class="fas" :class="running ? 'fa-stop' : 'fa-play'"></i></span>
        {{ running ? $t('label.stop') : $t('label.start') }}
      </button>
      <button class="btn btn--danger btn--panic" type="button" :disabled="!midiStore.midiOutput"
        :title="$t('player.panicHint')" @click="midiStore.panic()">
        <span class="icon"><i class="fas fa-bell-slash"></i></span>{{ $t('player.panic') }}
      </button>
      <p v-if="!midiStore.midiOutput" class="player-hint fixed-bar__hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
      </p>
    </article>
    <board-alert />

    <!-- per-coil fixed output -->
    <section class="fixed-section">
      <header class="fixed-section__head">
        <button v-if="cfg.coils.length > 1" class="btn btn--ghost btn--xs" type="button"
          :aria-pressed="allLinked" @click="toggleLinkAll">
          <span class="icon"><i class="fas" :class="allLinked ? 'fa-link-slash' : 'fa-link'"></i></span>{{
            allLinked ? $t('player.fixed.unlinkAll') : $t('player.fixed.linkAll') }}
        </button>
        <segmented-control v-model="cfg.coilCount" pressed :aria-label="$t('label.coilCount')"
          :options="coilRange.map((n) => ({ value: n, label: String(n) }))" />
      </header>

      <div class="coils-grid">
        <article v-for="(c, i) in cfg.coils" :key="i" class="coil-card" :class="{ 'is-off': !c.enabled }"
          :style="{ '--coil': coilColor(i) }">
          <header class="coil-card__head">
            <h3 class="coil-card__title">{{ $t('label.coil') }} <span class="coil-card__no">{{ i }}</span><span v-if="midiStore.coilName(i)"
                class="coil-card__name"> · {{ midiStore.coilName(i) }}</span></h3>
            <label class="switch coil-card__switch" :title="$t('label.coil') + ' ' + i">
              <input type="checkbox" :checked="c.enabled" @change="toggleCoil(i)">
              <span class="switch__track"></span>
            </label>
          </header>
          <div class="readout-row">
            <div class="readout">
              <span class="readout__key">{{ $t('label.duty') }}</span>
              <label class="readout__field"><input type="number" min="0" max="100" step="0.1" :value="dutyPct(c.duty)"
                  @input="onDutyInput(c, $event)"><i>%</i></label>
            </div>
          </div>
          <!-- the pulse fired: the fill; the demand cut: hatched; the coil's two limits: the marks -->
          <div class="fx-gauge">
            <div class="fx-gauge__head">
              <i class="fas" :class="ICONS.power"></i>
              <span class="fx-gauge__real">{{ $t('ontime.fixed.real') }} <b>{{ Math.round(gauges[i].us) }}</b> µs</span>
              <span class="fx-gauge__duty">· {{ $t('ontime.fixed.duty') }} <b>{{ pctLabel(gauges[i].duty) }}</b> %</span>
            </div>
            <div class="fx-gauge__track">
              <div class="fx-gauge__fill" :style="{ width: gauges[i].at(gauges[i].us) }"></div>
              <div v-if="gauges[i].over" class="fx-gauge__over"
                :style="{ left: gauges[i].at(gauges[i].us), right: `calc(100% - ${gauges[i].at(gauges[i].asked)})` }">
              </div>
              <div v-if="gauges[i].maxOn != null" class="fx-gauge__cap" :style="{ left: gauges[i].at(gauges[i].maxOn) }"
                :title="$t('ontime.fixed.ontimeCap', { us: gauges[i].maxOn })"></div>
              <div v-if="gauges[i].showDutyCap" class="fx-gauge__cap is-duty"
                :style="{ left: gauges[i].at(gauges[i].dutyCapUs ?? 0) }"
                :title="$t('ontime.fixed.dutyCap', { pct: pctLabel(gauges[i].maxDuty ?? 0), us: Math.round(gauges[i].dutyCapUs ?? 0) })">
              </div>
            </div>
            <div v-if="gauges[i].by" class="fx-gauge__foot">{{ $t('ontime.fixed.asked', { us: Math.round(gauges[i].asked) }) }}, {{
              $t('ontime.fixed.cutBy', { what: $t(`ontime.fixed.${gauges[i].by}`) }) }}</div>
          </div>
          <div class="fixed-freq">
            <span class="fixed-freq__head">
              <span class="readout__key">{{ $t('label.frequency') }}</span>
              <small v-if="freqNote(c.frequencyHz)" class="fixed-freq__note">{{ freqNote(c.frequencyHz) }}</small>
              <label class="readout__field fixed-freq__field">
                <input type="number" :min="TYPED_MIN" :max="TYPED_MAX" step="1" :value="c.frequencyHz"
                  :aria-label="$t('label.frequency')" @change="onFreqTyped(c, $event)"><i>Hz</i>
              </label>
              <button class="fixed-freq__link" :class="{ 'is-on': c.linked }" type="button" :aria-pressed="c.linked"
                :title="$t(c.linked ? 'player.fixed.unlink' : 'player.fixed.link')"
                :aria-label="$t(c.linked ? 'player.fixed.unlink' : 'player.fixed.link')" @click="c.linked = !c.linked">
                <i class="fas fa-link"></i>
              </button>
            </span>
            <input class="fixed-freq__range" type="range" :aria-label="$t('label.frequency')" min="0" :max="FREQ_STEPS" step="1" :value="freqToPos(c.frequencyHz)"
              :aria-valuetext="`${c.frequencyHz} Hz ${freqNote(c.frequencyHz)}`" @input="onFreqInput(c, $event)"
              @change="endFreqMove" />
          </div>
        </article>
      </div>
    </section>
    <confirm-modal :open="leavePending" :title="$t('player.fixedLeaveTitle')"
      :message="$t('player.fixedLeaveQuestion')" :confirm-label="$t('player.leaveConfirm')"
      :cancel-label="$t('player.stay')" @confirm="answerLeave(true)" @close="answerLeave(false)" />
  </div>
</template>
