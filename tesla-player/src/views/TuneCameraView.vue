<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { ArcMeter, Measurement } from '@/vision/arc-meter';
import ArcCamera from '@/tuning/ArcCamera.vue';
import ArcReadout from '@/tuning/ArcReadout.vue';
import { ArcWindow } from '@/tuning/arc-window';
import { SessionLink } from '@/tuning/session-link';
import { isEvent, type CameraStatus, type SessionEvent, type TrialBegin, type TrialDone } from '@/tuning/protocol';
import { noteHzLabel, noteName } from '@/ui/piano-layout';
import { currentPosition } from '@/tuning/weather';

/**
 * The phone side of a tuning session. Opened from the QR code, it runs the arc
 * camera (tuning/ArcCamera.vue) and obeys the player: capture a background
 * (coil off), measure the arc while each note plays, and report per-note
 * statistics. Everything is computed here; only small aggregates travel.
 */
const { t } = useI18n();
const route = useRoute();
const sessionId = String(route.params.sessionId ?? '');
const token = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
const cam = ref<InstanceType<typeof ArcCamera> | null>(null);

/* ------------------------------------------------------------------- link */
const link = new SessionLink({ id: sessionId, token, side: 'camera' });
const linkOk = ref(false);
const linkError = ref<string | null>(null);
link.onState((s) => { linkOk.value = s.connected; linkError.value = s.error; });
const errorKey = ref<string | null>(null);
watch(linkError, (e) => { if (e === 'session-gone' || e === 'session-token') errorKey.value = 'tune.cam.sessionGone'; });

function sendHello(): void {
  const c = cam.value;
  void link.send('camera:hello', { userAgent: navigator.userAgent, width: c?.size.width ?? 0, height: c?.size.height ?? 0, exposureLocked: c?.exposureLocked ?? false });
}
function sendStatus(state: CameraStatus['state'], message?: string): void {
  void link.send('camera:status', message ? { state, message } : { state });
}

function onStarted(): void {
  link.open();
  sendHello();
  sendStatus('setup');
}
function onZone(meter: ArcMeter): void {
  window_ = null;
  void link.send('camera:geometry', meter.geom);
  sendStatus('ready');
  void currentPosition().then((p) => { if (p) void link.send('camera:position', p); });
}
function onSetup(): void {
  window_ = null;
  measuring.value = false;
  sendStatus('setup');
}

/* ------------------------------------------------------------- processing */
let window_: { trialId: string; noteIndex: number; note: number; win: ArcWindow; lastHeatAt: number } | null = null;
const measuring = ref(false);

function onMeasure(m: Measurement, _meter: ArcMeter, now: number): void {
  const w = window_;
  if (!w) return;
  w.win.add(m);
  // stream the silhouette as it builds up (≈ 2 Hz)
  if (now - w.lastHeatAt > 500) {
    w.lastHeatAt = now;
    void link.send('measure:heat', { trialId: w.trialId, noteIndex: w.noteIndex, heat: w.win.heat() });
  }
}

const liveTimer = setInterval(() => {
  const c = cam.value;
  if (!c?.meter || !linkOk.value) return;
  const l = c.live;
  void link.send('measure:live', { L: l.L, p90: l.p90, conf: l.conf, dx: l.dx, dy: l.dy, fps: l.fps, measuring: !!window_ });
}, 250);

async function startCapture(trialId: string, frames: number): Promise<void> {
  const c = cam.value;
  if (!c?.meter) return;
  window_ = null;
  const pending = c.captureBackground(frames);
  sendStatus('capturing');
  try {
    const bg = await pending;
    if (!bg) return; // stopped, or the zone changed meanwhile
    void link.send('background:ready', { trialId, frames: bg.frames, sigmaMedian: bg.sigmaMedian });
    sendStatus('ready');
  } catch (e) {
    sendStatus('error', String(e));
  }
}

/* ---------------------------------------------------- what the phone shows about the trial */
type NoteState = 'pending' | 'measuring' | 'done' | 'skipped';
const trial = reactive<{
  info: TrialBegin | null;
  phase: 'none' | 'background' | 'notes' | 'done';
  bgFrames: number; bgTarget: number;
  notes: { note: number; state: NoteState; p90: number | null; hitRate: number | null; startedAt: number }[];
  progress: number; // 0..1 of the current note hold
  result: TrialDone | null;
}>({ info: null, phase: 'none', bgFrames: 0, bgTarget: 0, notes: [], progress: 0, result: null });
watch(() => [cam.value?.capture.frames ?? 0, cam.value?.capture.target ?? 0], ([n, total]) => {
  if (trial.phase === 'background') { trial.bgFrames = n; trial.bgTarget = total; }
});
let progressTimer: ReturnType<typeof setInterval> | null = null;
function tickProgress(): void {
  const cur = trial.notes.find((n) => n.state === 'measuring');
  if (!cur || !trial.info) { trial.progress = 0; return; }
  trial.progress = Math.min(1, (performance.now() - cur.startedAt) / Math.max(1, trial.info.holdMs));
}
function beginTrial(info: TrialBegin): void {
  trial.info = info; trial.phase = 'background'; trial.result = null; trial.bgFrames = 0; trial.bgTarget = 0; trial.progress = 0;
  trial.notes = info.notes.map((note) => ({ note, state: 'pending', p90: null, hitRate: null, startedAt: 0 }));
  if (!progressTimer) progressTimer = setInterval(tickProgress, 100);
}
function finishTrial(done: TrialDone): void {
  trial.result = done; trial.phase = 'done'; trial.progress = 0;
  for (const n of trial.notes) if (n.state !== 'done') n.state = 'skipped';
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}
const trialDelta = computed(() => {
  const r = trial.result;
  if (!r || r.score == null || r.bestScore == null || r.isBest) return null;
  return r.score - r.bestScore;
});

function onEvent(ev: SessionEvent): void {
  if (isEvent(ev, 'capture:background')) void startCapture(ev.payload!.trialId, ev.payload!.frames);
  else if (isEvent(ev, 'trial:begin')) beginTrial(ev.payload!);
  else if (isEvent(ev, 'trial:done')) finishTrial(ev.payload!);
  else if (isEvent(ev, 'tone:start')) {
    const meter = cam.value?.meter;
    if (!meter?.ready) return;
    window_ = { trialId: ev.payload!.trialId, noteIndex: ev.payload!.noteIndex, note: ev.payload!.note, win: new ArcWindow(meter), lastHeatAt: 0 };
    trial.phase = 'notes';
    measuring.value = true;
    const chip = trial.notes[ev.payload!.noteIndex];
    if (chip) { chip.state = 'measuring'; chip.startedAt = performance.now(); }
    sendStatus('measuring');
  } else if (isEvent(ev, 'tone:end')) {
    const w = window_;
    if (!w || w.trialId !== ev.payload!.trialId || w.noteIndex !== ev.payload!.noteIndex) return;
    window_ = null;
    measuring.value = false;
    const st = w.win.stats();
    const chip = trial.notes[w.noteIndex];
    if (chip) { chip.state = 'done'; chip.p90 = st.p90; chip.hitRate = st.hitRate; }
    trial.progress = 0;
    void link.send('measure:note', { trialId: w.trialId, noteIndex: w.noteIndex, note: w.note, frames: st.frames, hitRate: st.hitRate, p90: st.p90, median: st.median, max: st.max, unstableRate: w.win.unstableRate, heat: w.win.heat() });
    sendStatus('ready');
  } else if (isEvent(ev, 'stop')) {
    window_ = null; cam.value?.cancelCapture(); measuring.value = false;
    for (const n of trial.notes) if (n.state === 'measuring') n.state = 'skipped';
    trial.progress = 0;
    sendStatus(cam.value?.meter ? 'ready' : 'setup');
  } else if (isEvent(ev, 'desktop:hello')) {
    sendHello();
    const g = cam.value?.meter?.geom;
    if (g) void link.send('camera:geometry', g);
  }
}
link.on(onEvent);

function emergencyStop(): void {
  window_ = null; cam.value?.cancelCapture(); measuring.value = false;
  void link.send('camera:stop', { reason: 'user' });
}

/* --------------------------------------------------------------- lifecycle */
const stateText = computed(() => {
  const c = cam.value;
  if (c?.capture.active) return t('tune.cam.capturing');
  if (measuring.value) {
    // the note being measured, so the pulled-down sheet still tells where the trial is
    const i = trial.notes.findIndex((n) => n.state === 'measuring');
    return i < 0 ? t('tune.cam.measuring') : `${t('tune.cam.measuring')} · ${noteName(trial.notes[i].note)} ${i + 1}/${trial.notes.length}`;
  }
  if (!c?.hasBackground) return t('tune.cam.waiting');
  return t('tune.cam.idle');
});
onBeforeUnmount(() => {
  clearInterval(liveTimer);
  if (progressTimer) clearInterval(progressTimer);
  link.close();
});
</script>

<template>
  <arc-camera ref="cam" :title="t('tune.cam.title')" :error="errorKey" @started="onStarted" @zone="onZone" @setup="onSetup" @measure="onMeasure">
    <template #head>
      <span class="cam__link" :class="{ 'is-ok': linkOk }">{{ linkOk ? t('tune.cam.linkOk') : t('tune.cam.linkLost') }}</span>
    </template>

    <!-- STOP stays at hand with the sheet pulled down -->
    <template #peek="{ live }">
      <arc-readout :live="live" :state="stateText" :active="measuring" />
      <button class="cam-btn cam-btn--danger" type="button" @click="emergencyStop"><i class="fas fa-stop"></i>{{ t('tune.stop') }}</button>
    </template>

    <template #ready="{ redoZone }">
      <!-- the trial as it runs -->
      <div v-if="trial.info" class="cam__trial" :class="{ 'is-done': trial.phase === 'done', 'is-best': trial.result?.isBest }">
        <div class="cam__trial-head">
          <span class="cam__trial-n">{{ t('tune.cam.trialN', { n: trial.info.index }) }}</span>
          <span class="cam__trial-tap">{{ t('tune.cam.tapAt', { tap: trial.info.tapLabel }) }}</span>
          <span v-if="trial.info.bestScore != null" class="cam__trial-best dim">{{ t('tune.cam.bestSoFar', { s: trial.info.bestScore, tap: trial.info.bestTapLabel }) }}</span>
        </div>
        <div v-if="trial.phase === 'background'" class="cam__bg">
          <i class="fas fa-circle-notch fa-spin"></i>
          <span>{{ t('tune.cam.bgProgress', { n: trial.bgFrames, total: trial.bgTarget || '…' }) }}</span>
        </div>
        <ol class="cam__notes">
          <li v-for="(n, i) in trial.notes" :key="i" class="cam__note" :class="'is-' + n.state">
            <span class="cam__note-name">{{ noteName(n.note) }} <small>{{ noteHzLabel(n.note) }}</small></span>
            <span v-if="n.state === 'measuring'" class="cam__note-bar"><i :style="{ width: (trial.progress * 100).toFixed(1) + '%' }"></i></span>
            <span v-else-if="n.state === 'done'" class="cam__note-val mono">{{ n.p90!.toFixed(0) }} px <small>· {{ Math.round((n.hitRate ?? 0) * 100) }} %</small></span>
            <span v-else-if="n.state === 'skipped'" class="cam__note-val dim">—</span>
            <span v-else class="cam__note-val dim">{{ t('tune.cam.pending') }}</span>
          </li>
        </ol>
        <div v-if="trial.result" class="cam__result">
          <template v-if="trial.result.score != null">
            <span class="cam__result-score">{{ trial.result.score }} <small>px</small></span>
            <span v-if="trial.result.isBest" class="cam__result-tag is-best"><i class="fas fa-trophy"></i>{{ t('tune.cam.newBest') }}</span>
            <span v-else-if="trialDelta != null" class="cam__result-tag" :class="trialDelta >= 0 ? 'is-up' : 'is-down'">
              <i class="fas" :class="trialDelta >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'"></i>{{ t('tune.cam.vsBest', { d: (trialDelta > 0 ? '+' : '') + trialDelta, s: trial.result.bestScore, tap: trial.result.bestTapLabel }) }}
            </span>
          </template>
          <span v-else class="cam__result-tag is-down"><i class="fas fa-ban"></i>{{ t('tune.cam.trialAborted') }}</span>
        </div>
      </div>
      <p v-else class="cam__hint dim"><i class="fas fa-hourglass-half"></i>{{ t('tune.cam.waitingTrial') }}</p>

      <p class="cam__hint dim">{{ t('tune.cam.keepStill') }}</p>
      <button class="cam-btn" type="button" @click="redoZone"><i class="fas fa-crosshairs"></i>{{ t('tune.cam.redo') }}</button>
    </template>
  </arc-camera>
</template>
