<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useMidiStore } from '@/stores/midi';
import { compileSimpleConfig, compileSimpleStop } from '@/sysex/syntherrupter';
import { coilColor } from '@/ui/coil-colors';
import { MAX_COILS, MIN_COILS } from '@/types/domain';
import type { SimpleCoil } from '@/types/domain';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

const midiStore = useMidiStore();
const coilRange = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => MIN_COILS + i);

/** A fixed-mode coil plus an individual on/off switch (off = ontime forced to 0). */
interface FixedCoil extends SimpleCoil { enabled: boolean }
function defaultCoil(index: number): FixedCoil {
  return { coilIndex: index, ontimeUs: 40, duty: 0.05, frequencyHz: 100, enabled: true };
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
watch(cfg, () => {
  localStorage.setItem(STORE_KEY, JSON.stringify({ coilCount: cfg.coilCount, coils: cfg.coils }));
  if (running.value) scheduleResend(); // coalesce keystrokes → no intermediate over-power
}, { deep: true });

/* -------- run engine -------- */
const running = ref(false);
const canRun = computed(() => !!midiStore.midiOutput);
let resendTimer: ReturnType<typeof setTimeout> | null = null;

function sendConfig(): void {
  for (const frame of compileSimpleConfig(effectiveCoils.value)) midiStore.sendSysex(frame);
}
// debounce live edits so a burst of keystrokes settles before re-arming coils
function scheduleResend(): void {
  if (resendTimer) clearTimeout(resendTimer);
  resendTimer = setTimeout(() => { resendTimer = null; if (running.value) sendConfig(); }, 300);
}
function start(): void {
  if (!canRun.value || running.value) return;
  sendConfig();
  running.value = true;
}
function stop(): void {
  if (resendTimer) { clearTimeout(resendTimer); resendTimer = null; }
  for (const frame of compileSimpleStop(cfg.coils)) midiStore.sendSysex(frame); // zero coils, then disable
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
  running.value = false;
}
function toggle(): void { if (running.value) stop(); else start(); }

/* duty is stored as a fraction (0..1) but edited as a percentage */
function dutyPct(d: number): number { return Math.round(d * 1e4) / 100; }
function onDutyInput(c: SimpleCoil, e: Event): void {
  const v = parseFloat((e.target as HTMLInputElement).value);
  c.duty = Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 0;
}

onBeforeUnmount(() => { if (running.value) stop(); });
</script>

<template>
  <div class="fixed">
    <!-- control bar -->
    <article class="fixed-bar">
      <div class="fixed-bar__status" :class="{ 'is-live': running }">
        <span class="fixed-dot"></span>{{ running ? $t('label.liveRunning') : $t('label.liveStopped') }}
      </div>
      <div class="fixed-coils-toggle">
        <button v-for="(c, i) in cfg.coils" :key="i" type="button" class="coil-toggle" :class="{ 'is-on': c.enabled }"
          :style="{ '--c': coilColor(i) }" @click="toggleCoil(i)" :title="`${$t('label.coil')} ${i}`">{{ i }}</button>
      </div>
      <button class="btn" :class="running ? 'btn--danger' : 'btn--volt'" type="button" :disabled="!canRun"
        @click="toggle">
        <span class="icon"><i class="fas" :class="running ? 'fa-stop' : 'fa-play'"></i></span>
        {{ running ? $t('label.stop') : $t('label.start') }}
      </button>
      <p v-if="!midiStore.midiOutput" class="player-hint fixed-bar__hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('label.selectOutputHint') }}
      </p>
    </article>

    <!-- per-coil fixed output -->
    <section class="fixed-section">
      <header class="fixed-section__head">
        <span class="fixed-section__title">
          <span class="icon"><i class="fas fa-wave-square"></i></span>{{ $t('label.fixedOutput') }}
        </span>
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
              <span class="readout__key">{{ $t('label.ontime') }}</span>
              <label class="readout__field"><input type="number" min="0" step="1"
                  v-model.number="c.ontimeUs"><i>µs</i></label>
            </div>
            <div class="readout">
              <span class="readout__key">{{ $t('label.duty') }}</span>
              <label class="readout__field"><input type="number" min="0" max="100" step="0.1" :value="dutyPct(c.duty)"
                  @input="onDutyInput(c, $event)"><i>%</i></label>
            </div>
            <div class="readout">
              <span class="readout__key">{{ $t('label.frequency') }}</span>
              <label class="readout__field"><input type="number" min="0" step="1"
                  v-model.number="c.frequencyHz"><i>Hz</i></label>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
