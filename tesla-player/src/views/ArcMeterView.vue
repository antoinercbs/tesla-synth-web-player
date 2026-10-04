<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { ArcMeter, ArcStats, Measurement } from '@/vision/arc-meter';
import ArcCamera from '@/tuning/ArcCamera.vue';
import ArcReadout from '@/tuning/ArcReadout.vue';
import ArcHeatmap from '@/tuning/ArcHeatmap.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import { ArcWindow, RunSegmenter } from '@/tuning/arc-window';
import type { HeatPayload } from '@/tuning/heat';
import { mobileLayout } from '@/ui/viewport';
import { ICONS } from '@/ui/icons';

/**
 * The arc meter on its own: no session, no tone, nothing saved. Whatever drives
 * the coil, each run is cut out of the stream by itself (tuning/arc-window.ts)
 * and listed for as long as the page stays open.
 */
const { t, locale } = useI18n();
const router = useRouter();
const cam = ref<InstanceType<typeof ArcCamera> | null>(null);

const BG_FRAMES = 24;
const RUN_GAP_MS = 1500;
/** Below this many frames with an arc, a "run" is a glitch. */
const MIN_ARC_FRAMES = 3;
/** Share of a run's arcs cut by the picture's edge or the wall past which its length is only a floor. */
const CUT_RATE = 0.2;

interface Run { n: number; ms: number; stats: ArcStats; heat: HeatPayload; edgeRate: number }
const runs = ref<Run[]>([]);
let runCount = 0;
const best = computed(() => (runs.value.length > 1 ? runs.value.reduce((b, r) => (r.stats.p90 > b.stats.p90 ? r : b)) : null));

// the runs have a tab of their own: while the coil fires, the picture keeps the screen
type Tab = 'camera' | 'runs';
const tab = ref<Tab>('camera');
const zoneSet = ref(false);
const tabOptions = computed(() => [
  { value: 'camera' as Tab, label: t('tune.meter.tabCamera'), icon: 'fa-video' },
  { value: 'runs' as Tab, label: runs.value.length ? `${t('tune.meter.runs')} (${runs.value.length})` : t('tune.meter.runs'), icon: 'fa-list-ol' },
]);
function onZone(): void { closeRun(); zoneSet.value = true; }
function onSetup(): void { closeRun(); zoneSet.value = false; tab.value = 'camera'; }

const seg = new RunSegmenter<Measurement>(RUN_GAP_MS);
let open: { win: ArcWindow; startedAt: number; lastArcAt: number } | null = null;
const current = reactive({ active: false, ms: 0, max: 0 });

function onMeasure(m: Measurement, meter: ArcMeter, now: number): void {
  const r = seg.push(m, m.L > 0 && !m.moved, now);
  if (r.started) {
    open = { win: new ArcWindow(meter), startedAt: now, lastArcAt: now };
    current.active = true; current.max = 0;
  }
  if (!open) return;
  if (r.frames.length) {
    for (const f of r.frames) open.win.add(f);
    open.lastArcAt = now;
    current.max = Math.max(current.max, m.L);
  }
  current.ms = now - open.startedAt;
  if (r.ended) closeRun();
}

function closeRun(): void {
  const o = open;
  open = null;
  seg.close();
  current.active = false;
  if (!o) return;
  const stats = o.win.stats();
  if (stats.hitRate * stats.frames < MIN_ARC_FRAMES) return;
  runs.value.unshift({ n: ++runCount, ms: o.lastArcAt - o.startedAt, stats, heat: o.win.heat(), edgeRate: o.win.edgeRate });
}
function removeRun(n: number): void { runs.value = runs.value.filter((r) => r.n !== n); }

async function captureBackground(): Promise<void> {
  closeRun();
  try { await cam.value?.captureBackground(BG_FRAMES); } catch (e) { console.error(e); }
}

const stateText = computed(() => {
  if (cam.value?.capture.active) return t('tune.cam.capturing');
  if (current.active) return t('tune.meter.running');
  // what the pulled-down sheet still says once a run is over
  const last = runs.value[0];
  return last ? t('tune.meter.lastRun', { px: last.stats.p90.toFixed(0) }) : t('tune.meter.watching');
});

function secs(ms: number): string {
  return `${(ms / 1000).toLocaleString(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

// a link opened straight onto this page has nowhere to go back to
function close(): void {
  if (window.history.state?.back) router.back();
  else void router.push({ name: mobileLayout.value ? 'play' : 'tune' });
}
</script>

<template>
  <arc-camera ref="cam" :title="t('tune.meter.title')" :icon="ICONS.arcMeter" @zone="onZone" @setup="onSetup" @measure="onMeasure">
    <template #head>
      <segmented-control v-if="zoneSet" v-model="tab" class="cam__tabs" tabs :options="tabOptions" :aria-label="t('tune.meter.title')" />
      <button class="cam__close" type="button" :title="t('label.close')" :aria-label="t('label.close')" @click="close"><i class="fas fa-xmark"></i></button>
    </template>

    <template #peek="{ live, capture, hasBackground }">
      <div v-if="capture.active" class="cam__bg">
        <i class="fas fa-circle-notch fa-spin"></i>
        <span>{{ t('tune.cam.bgProgress', { n: capture.frames, total: capture.target }) }}</span>
      </div>
      <template v-else-if="!hasBackground">
        <p class="cam__hint"><i class="fas fa-power-off"></i>{{ t('tune.meter.bgFirst') }}</p>
        <button class="cam-btn cam-btn--volt" type="button" @click="captureBackground"><i class="fas fa-camera"></i>{{ t('tune.meter.captureBg') }}</button>
      </template>
      <template v-if="hasBackground">
        <arc-readout :live="live" :state="stateText" :active="current.active" />
        <button v-if="live.moved && !capture.active" class="cam-btn cam-btn--volt" type="button" @click="captureBackground">
          <i class="fas" :class="ICONS.recaptureBackground"></i>{{ t('tune.meter.recaptureBg') }}
        </button>
      </template>
    </template>

    <template #ready="{ capture, hasBackground, redoZone }">
      <div class="cam__actions cam__actions--even">
        <button v-if="hasBackground" class="cam-btn" type="button" :disabled="capture.active" @click="captureBackground">
          <i class="fas" :class="ICONS.recaptureBackground"></i>{{ t('tune.meter.recaptureBg') }}
        </button>
        <button class="cam-btn" type="button" @click="redoZone"><i class="fas" :class="ICONS.editZone"></i>{{ t('tune.cam.redo') }}</button>
      </div>
    </template>

    <template v-if="tab === 'runs'" #cover>
      <div class="cam__runs">
        <div class="cam__runs-head">
          <span v-if="best" class="cam__runs-best"><i class="fas fa-trophy"></i>{{ t('tune.meter.bestRun', { n: best.n, px: best.stats.p90.toFixed(0) }) }}</span>
          <span v-else>{{ t('tune.meter.runs') }} <span class="dim">({{ runs.length }})</span></span>
          <button v-if="runs.length" class="cam__textbtn" type="button" @click="runs = []">{{ t('tune.meter.clear') }}</button>
        </div>
        <ol v-if="runs.length || current.active" class="cam__runs-list">
          <li v-if="current.active" class="cam__run is-live">
            <span class="cam__run-live"><span class="tune-live-dot"></span></span>
            <span class="cam__run-main"><span class="cam__run-n">#{{ runCount + 1 }}</span>{{ t('tune.meter.running') }}</span>
            <span class="cam__run-sub mono">max {{ current.max.toFixed(0) }} px · {{ secs(current.ms) }}</span>
          </li>
          <li v-for="r in runs" :key="r.n" class="cam__run" :class="{ 'is-best': r === best }">
            <arc-heatmap class="cam__run-heat" :heat="r.heat" :width="80" />
            <span class="cam__run-main">
              <span class="cam__run-n">#{{ r.n }}</span>
              <b class="cam__run-p90">{{ r.stats.p90.toFixed(0) }}</b><small>px P90</small>
              <i v-if="r === best" class="fas fa-trophy cam__run-best" :title="t('tune.best')"></i>
              <i v-if="r.edgeRate > CUT_RATE" class="fas fa-scissors cam__run-cut" :title="t('tune.meter.cut')" :aria-label="t('tune.meter.cut')"></i>
            </span>
            <span class="cam__run-sub mono">max {{ r.stats.max.toFixed(0) }} · {{ Math.round(r.stats.hitRate * 100) }} % · {{ secs(r.ms) }}</span>
            <button class="cam__run-del" type="button" :title="t('label.delete')" :aria-label="t('label.delete')" @click="removeRun(r.n)"><i class="fas fa-xmark"></i></button>
          </li>
        </ol>
        <p v-else class="cam__hint dim">{{ t('tune.meter.runsEmpty', { gap: secs(RUN_GAP_MS) }) }}</p>
      </div>
    </template>
  </arc-camera>
</template>
