<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArcMeter, summarize, type BackgroundBuilder, type Measurement, type Shift } from '@/vision/arc-meter';
import { SessionLink } from '@/tuning/session-link';
import { isEvent, type CameraStatus, type SessionEvent, type TrialBegin, type TrialDone } from '@/tuning/protocol';
import { noteHzLabel, noteName } from '@/ui/piano-layout';
import { currentPosition } from '@/tuning/weather';
import { downsampleHeat, type HeatPayload } from '@/tuning/heat';

/**
 * The phone side of a tuning session. Opened from the QR code, it streams the
 * rear camera, lets the operator point the breakout and the measurement zone,
 * then obeys the player: capture a background (coil off), measure the arc while
 * each note plays, and report per-note statistics. Everything is computed here;
 * only small aggregates travel. See src/vision/arc-meter.ts for the method.
 */
const { t } = useI18n();
const route = useRoute();
const sessionId = String(route.params.sessionId ?? '');
const token = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));

type Step = 'intro' | 'starting' | 'setup' | 'ready' | 'error';
const step = ref<Step>('intro');
const errorKey = ref('');
const isSecure = window.isSecureContext;

/* ------------------------------------------------------------------- link */
const link = new SessionLink({ id: sessionId, token, side: 'camera' });
const linkOk = ref(false);
const linkError = ref<string | null>(null);
link.onState((s) => { linkOk.value = s.connected; linkError.value = s.error; });

/* ----------------------------------------------------------------- camera */
const video = ref<HTMLVideoElement | null>(null);
const overlay = ref<HTMLCanvasElement | null>(null);
const stage = ref<HTMLDivElement | null>(null);
let stream: MediaStream | null = null;
let track: MediaStreamTrack | null = null;
const WORK_W = 384;
let workW = WORK_W, workH = 288;
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
const maskCanvas = document.createElement('canvas');
const mctx = maskCanvas.getContext('2d') as CanvasRenderingContext2D;
const exposureLocked = ref(false);
let wakeLock: { release(): Promise<void> } | null = null;

async function startCamera(): Promise<void> {
  step.value = 'starting';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nomedia');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    track = stream.getVideoTracks()[0] ?? null;
    const v = video.value!;
    v.srcObject = stream;
    await v.play();
    await new Promise<void>((res) => { if (v.videoWidth) res(); else v.onloadedmetadata = () => res(); });
    workW = WORK_W; workH = Math.max(16, Math.round((v.videoHeight / v.videoWidth) * WORK_W));
    work.width = workW; work.height = workH;
    geom.breakout = { x: Math.round(workW / 2), y: Math.round(workH * 0.4) };
    geom.roiRadius = Math.round(Math.min(workW, workH) * 0.25);
    geom.floorBelow = Math.round(geom.roiRadius * 0.35);
    step.value = 'setup';
    void requestWakeLock();
    link.open();
    void link.send('camera:hello', { userAgent: navigator.userAgent, width: workW, height: workH, exposureLocked: false });
    sendStatus('setup');
    loop();
  } catch (e) {
    errorKey.value = isSecure ? 'tune.cam.noCamera' : 'tune.cam.needHttps';
    step.value = 'error';
    console.error(e);
  }
}

async function requestWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch { wakeLock = null; }
}
function onVisibility(): void { if (document.visibilityState === 'visible' && !wakeLock) void requestWakeLock(); }

/** Freeze exposure / white balance / focus where the browser allows it (Android Chrome). */
async function lockExposure(): Promise<void> {
  if (!track) return;
  try {
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    const settings = track.getSettings() as Record<string, unknown>;
    const adv: Record<string, unknown> = {};
    const has = (k: string, v: string): boolean => Array.isArray(caps[k]) && (caps[k] as string[]).includes(v);
    if (has('exposureMode', 'manual')) { adv.exposureMode = 'manual'; if (typeof settings.exposureTime === 'number') adv.exposureTime = settings.exposureTime; }
    if (has('whiteBalanceMode', 'manual')) adv.whiteBalanceMode = 'manual';
    if (has('focusMode', 'manual')) { adv.focusMode = 'manual'; if (typeof settings.focusDistance === 'number') adv.focusDistance = settings.focusDistance; }
    if (Object.keys(adv).length) {
      await track.applyConstraints({ advanced: [adv as never] });
      exposureLocked.value = 'exposureMode' in adv;
    }
  } catch { exposureLocked.value = false; }
}

/* --------------------------------------------------------------- geometry */
const geom = reactive({ breakout: { x: 192, y: 120 }, roiRadius: 60, floorBelow: 20, dirDeg: -90 });
const radiusPct = computed({
  get: () => Math.round((geom.roiRadius / Math.min(workW, workH)) * 100),
  set: (v: number) => { geom.roiRadius = Math.round((v / 100) * Math.min(workW, workH)); },
});
const floorPct = computed({
  get: () => Math.round((geom.floorBelow / Math.max(1, geom.roiRadius)) * 100),
  set: (v: number) => { geom.floorBelow = Math.round((v / 100) * geom.roiRadius); },
});
const breakoutSet = ref(false);

function displayToWork(clientX: number, clientY: number): { x: number; y: number } | null {
  const v = video.value; if (!v) return null;
  const r = v.getBoundingClientRect();
  // object-fit: contain → letterboxing offsets
  const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
  const ox = r.left + (r.width - dw) / 2, oy = r.top + (r.height - dh) / 2;
  const x = ((clientX - ox) / dw) * workW, y = ((clientY - oy) / dh) * workH;
  if (x < 0 || y < 0 || x >= workW || y >= workH) return null;
  return { x: Math.round(x), y: Math.round(y) };
}
function onStagePointer(e: PointerEvent): void {
  if (step.value !== 'setup') return;
  const p = displayToWork(e.clientX, e.clientY);
  if (!p) return;
  geom.breakout = p; breakoutSet.value = true;
}
function validateZone(): void {
  if (!breakoutSet.value) return;
  meter = new ArcMeter({ width: workW, height: workH, breakout: { ...geom.breakout }, roiRadius: geom.roiRadius, excludeBelowY: geom.breakout.y + geom.floorBelow, dirDeg: geom.dirDeg });
  maskCanvas.width = meter.crop.w; maskCanvas.height = meter.crop.h;
  builder = null; capture = null; window_ = null; lastShift = null;
  step.value = 'ready';
  void link.send('camera:geometry', meter.geom);
  sendStatus('ready');
  void currentPosition().then((p) => { if (p) void link.send('camera:position', p); });
}
function redoZone(): void {
  meter = null; capture = null; window_ = null;
  step.value = 'setup';
  sendStatus('setup');
}

/* ------------------------------------------------------------- processing */
let meter: ArcMeter | null = null;
let builder: BackgroundBuilder | null = null;
let capture: { trialId: string; frames: number } | null = null;
let window_: { trialId: string; noteIndex: number; note: number; Ls: number[]; unstable: number; frames: number; acc: Uint32Array; lastHeatAt: number } | null = null;
let lastShift: Shift | null = null;
let reuseShift = 0;
let lastProcess = 0;
let lastLive = 0;
let frameTimes: number[] = [];
const recent: { t: number; L: number }[] = [];
const live = reactive({ L: 0, p90: 0, conf: 1, dx: 0, dy: 0, fps: 0, measuring: false, moved: false, stable: true, msPerFrame: 0 });
const bgReady = ref(false);
const measuring = ref(false);

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
let rafId = 0, vfcId = 0;

function loop(): void {
  const v = video.value;
  if (!v) return;
  const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  const tick = (): void => { processFrame(); schedule(); };
  const schedule = (): void => {
    if (vv.requestVideoFrameCallback) vfcId = vv.requestVideoFrameCallback(tick);
    else rafId = requestAnimationFrame(tick);
  };
  schedule();
}

function processFrame(): void {
  const v = video.value;
  if (!v || v.readyState < 2) return;
  const now = performance.now();
  if (now - lastProcess < 40) return; // ≤ 25 fps is plenty
  lastProcess = now;
  wctx.drawImage(v, 0, 0, workW, workH);
  let m: Measurement | null = null;
  if (meter) {
    const c = meter.crop;
    const img = wctx.getImageData(c.x0, c.y0, c.w, c.h);
    const crop = img.data;
    if (capture && builder) {
      builder.add(crop);
      trial.bgFrames = builder.count; trial.bgTarget = capture.frames;
      if (builder.count >= capture.frames) finishCapture();
    } else if (meter.ready) {
      const t0 = performance.now();
      // reuse the alignment for a couple of frames when the phone is slow
      const shift = reuseShift > 0 && lastShift ? lastShift : undefined;
      m = meter.measureCrop(crop, shift);
      if (!shift) lastShift = m.shift;
      const dt = performance.now() - t0;
      live.msPerFrame = dt;
      reuseShift = shift ? reuseShift - 1 : dt > 45 ? 2 : 0;
      onMeasure(m, now);
    }
  }
  frameTimes.push(now); frameTimes = frameTimes.filter((x) => now - x < 1000); live.fps = frameTimes.length;
  drawOverlay(m);
  if (now - lastLive > 250) { lastLive = now; publishLive(); }
}

function onMeasure(m: Measurement, now: number): void {
  live.L = m.L; live.conf = m.shift.conf; live.dx = m.shift.dx; live.dy = m.shift.dy; live.moved = m.moved; live.stable = m.stable;
  recent.push({ t: now, L: m.L });
  while (recent.length && now - recent[0].t > 1000) recent.shift();
  live.p90 = summarize(recent.map((r) => r.L)).p90;
  if (window_) {
    window_.frames++;
    if (!m.stable) window_.unstable++;
    if (!m.moved) {
      window_.Ls.push(m.L);
      if (m.L > 0 && meter) { const k = meter.keep, acc = window_.acc; for (let i = 0; i < k.length; i++) if (k[i]) acc[i]++; }
    }
    // stream the silhouette as it builds up (≈ 2 Hz)
    if (now - window_.lastHeatAt > 500) {
      window_.lastHeatAt = now;
      void link.send('measure:heat', { trialId: window_.trialId, noteIndex: window_.noteIndex, heat: currentHeat(window_) });
    }
  }
}

function currentHeat(w: NonNullable<typeof window_>): HeatPayload {
  const c = meter!.crop, g = meter!.geom;
  return downsampleHeat(w.acc, c.w, c.h, { x0: c.x0, y0: c.y0, breakout: g.breakout, roiRadius: g.roiRadius, excludeBelowY: g.excludeBelowY ?? null, dirDeg: g.dirDeg ?? null }, w.frames);
}

function startCapture(trialId: string, frames: number): void {
  if (!meter) return;
  builder = meter.backgroundBuilder(Math.min(40, Math.max(8, frames)));
  capture = { trialId, frames: builder.maxFrames };
  bgReady.value = false;
  window_ = null;
  sendStatus('capturing');
}
function finishCapture(): void {
  if (!meter || !builder || !capture) return;
  const { trialId } = capture;
  try {
    const bg = meter.buildBackground(builder);
    lastShift = null;
    bgReady.value = true;
    void lockExposure();
    void link.send('background:ready', { trialId, frames: bg.frames, sigmaMedian: bg.sigmaMedian });
    sendStatus('ready');
  } catch (e) {
    sendStatus('error', String(e));
  }
  capture = null; builder = null;
}

function publishLive(): void {
  if (step.value !== 'ready' || !linkOk.value) return;
  void link.send('measure:live', { L: live.L, p90: live.p90, conf: live.conf, dx: live.dx, dy: live.dy, fps: live.fps, measuring: !!window_ });
}
function sendStatus(state: CameraStatus['state'], message?: string): void {
  void link.send('camera:status', message ? { state, message } : { state });
}

function onEvent(ev: SessionEvent): void {
  if (isEvent(ev, 'capture:background')) startCapture(ev.payload!.trialId, ev.payload!.frames);
  else if (isEvent(ev, 'trial:begin')) beginTrial(ev.payload!);
  else if (isEvent(ev, 'trial:done')) finishTrial(ev.payload!);
  else if (isEvent(ev, 'tone:start')) {
    if (!meter?.ready) return;
    window_ = { trialId: ev.payload!.trialId, noteIndex: ev.payload!.noteIndex, note: ev.payload!.note, Ls: [], unstable: 0, frames: 0, acc: new Uint32Array(meter.crop.w * meter.crop.h), lastHeatAt: 0 };
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
    const st = summarize(w.Ls);
    const chip = trial.notes[w.noteIndex];
    if (chip) { chip.state = 'done'; chip.p90 = st.p90; chip.hitRate = st.hitRate; }
    trial.progress = 0;
    void link.send('measure:note', { trialId: w.trialId, noteIndex: w.noteIndex, note: w.note, frames: st.frames, hitRate: st.hitRate, p90: st.p90, median: st.median, max: st.max, unstableRate: w.frames ? w.unstable / w.frames : 0, heat: meter ? currentHeat(w) : null });
    sendStatus('ready');
  } else if (isEvent(ev, 'stop')) {
    window_ = null; capture = null; builder = null; measuring.value = false;
    for (const n of trial.notes) if (n.state === 'measuring') n.state = 'skipped';
    trial.progress = 0;
    sendStatus(meter ? 'ready' : 'setup');
  } else if (isEvent(ev, 'desktop:hello')) {
    void link.send('camera:hello', { userAgent: navigator.userAgent, width: workW, height: workH, exposureLocked: exposureLocked.value });
    if (meter) void link.send('camera:geometry', meter.geom);
  }
}
link.on(onEvent);

function emergencyStop(): void {
  window_ = null; capture = null; builder = null; measuring.value = false;
  void link.send('camera:stop', { reason: 'user' });
}

/* ---------------------------------------------------------------- overlay */
function drawOverlay(m: Measurement | null): void {
  const c = overlay.value, v = video.value, s = stage.value;
  if (!c || !v || !s) return;
  const r = v.getBoundingClientRect(), sr = s.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(sr.width * dpr) || c.height !== Math.round(sr.height * dpr)) { c.width = Math.round(sr.width * dpr); c.height = Math.round(sr.height * dpr); }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sr.width, sr.height);
  const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
  const ox = r.left - sr.left + (r.width - dw) / 2, oy = r.top - sr.top + (r.height - dh) / 2;
  const k = dw / workW; // work px → display px
  const X = (x: number): number => ox + x * k, Y = (y: number): number => oy + y * k;
  // arc mask
  if (m && meter && m.L > 0) {
    const cr = meter.crop;
    const img = mctx.createImageData(cr.w, cr.h);
    const keep = meter.keep;
    for (let i = 0, j = 0; i < keep.length; i++, j += 4) if (keep[i]) { img.data[j] = 70; img.data[j + 1] = 255; img.data[j + 2] = 120; img.data[j + 3] = 200; }
    mctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(maskCanvas, X(cr.x0), Y(cr.y0), cr.w * k, cr.h * k);
  }
  // zone
  const b = geom.breakout, R = geom.roiRadius, floorY = b.y + geom.floorBelow;
  const a = (geom.dirDeg * Math.PI) / 180;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 190, 60, 0.9)';
  ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), R * k, a - Math.PI / 2, a + Math.PI / 2); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(X(b.x - R), Y(floorY)); ctx.lineTo(X(b.x + R), Y(floorY)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 190, 60, 0.15)';
  ctx.fillRect(X(b.x - R), Y(floorY), 2 * R * k, Math.max(0, (b.y + R - floorY) * k));
  // breakout + tip
  ctx.fillStyle = '#ff4d62';
  ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), 5, 0, Math.PI * 2); ctx.fill();
  if (m && m.tip) {
    ctx.strokeStyle = '#ff4d62'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(b.x), Y(b.y)); ctx.lineTo(X(m.tip.x), Y(m.tip.y)); ctx.stroke();
  }
}

/* --------------------------------------------------------------- lifecycle */
const stateText = computed(() => {
  if (trial.phase === 'background' && !bgReady.value) return t('tune.cam.capturing');
  if (measuring.value) return t('tune.cam.measuring');
  if (!bgReady.value) return t('tune.cam.waiting');
  return t('tune.cam.idle');
});
watch(linkError, (e) => { if (e === 'session-gone' || e === 'session-token') { errorKey.value = 'tune.cam.sessionGone'; step.value = 'error'; } });

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility);
  document.body.classList.add('tune-cam-body');
});
onBeforeUnmount(() => {
  if (progressTimer) clearInterval(progressTimer);
  document.removeEventListener('visibilitychange', onVisibility);
  document.body.classList.remove('tune-cam-body');
  if (rafId) cancelAnimationFrame(rafId);
  const vv = video.value as (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }) | null;
  if (vfcId && vv?.cancelVideoFrameCallback) vv.cancelVideoFrameCallback(vfcId);
  stream?.getTracks().forEach((tr) => tr.stop());
  void wakeLock?.release();
  link.close();
});
</script>

<template>
  <div class="cam">
    <header class="cam__head">
      <span class="cam__title"><i class="fas fa-bullseye"></i>{{ t('tune.cam.title') }}</span>
      <span class="cam__link" :class="{ 'is-ok': linkOk }">{{ linkOk ? t('tune.cam.linkOk') : t('tune.cam.linkLost') }}</span>
    </header>

    <div ref="stage" class="cam__stage" @pointerdown="onStagePointer">
      <video ref="video" class="cam__video" playsinline muted autoplay></video>
      <canvas ref="overlay" class="cam__overlay"></canvas>
      <div v-if="step === 'setup' && !breakoutSet" class="cam__tapme">
        <i class="fas fa-hand-pointer"></i>
        <span>{{ t('tune.cam.tapPrompt') }}</span>
      </div>
      <div v-if="step === 'intro' || step === 'starting' || step === 'error'" class="cam__gate">
        <template v-if="step === 'error'">
          <i class="fas fa-triangle-exclamation cam__gate-icon"></i>
          <p>{{ t(errorKey) }}</p>
        </template>
        <template v-else>
          <p>{{ t('tune.cam.intro') }}</p>
          <button class="cam-btn cam-btn--volt" type="button" :disabled="step === 'starting'" @click="startCamera">
            <i class="fas" :class="step === 'starting' ? 'fa-spinner fa-spin' : 'fa-video'"></i>{{ t('tune.cam.start') }}
          </button>
          <p v-if="!isSecure" class="cam__warn">{{ t('tune.cam.needHttps') }}</p>
        </template>
      </div>
    </div>

    <section v-if="step === 'setup'" class="cam__panel">
      <ol class="cam__steps">
        <li :class="{ 'is-current': !breakoutSet, 'is-done': breakoutSet }">
          <span class="cam__steps-n"><i v-if="breakoutSet" class="fas fa-check"></i><template v-else>1</template></span>
          <span>{{ t('tune.cam.step1') }}</span>
        </li>
        <li :class="{ 'is-current': breakoutSet, 'is-todo': !breakoutSet }">
          <span class="cam__steps-n">2</span>
          <span>{{ t('tune.cam.step2') }}</span>
        </li>
      </ol>
      <div class="cam__sliders" :class="{ 'is-idle': !breakoutSet }" :aria-disabled="!breakoutSet">
        <label class="cam__slider"><span>{{ t('tune.cam.radius') }}</span><input type="range" min="8" max="90" :disabled="!breakoutSet" v-model.number="radiusPct" /><b class="mono">{{ radiusPct }} %</b></label>
        <label class="cam__slider"><span>{{ t('tune.cam.direction') }}</span><input type="range" min="-180" max="180" step="5" :disabled="!breakoutSet" v-model.number="geom.dirDeg" /><b class="mono">{{ geom.dirDeg }}°</b></label>
        <label class="cam__slider"><span>{{ t('tune.cam.floor') }}</span><input type="range" min="-50" max="100" :disabled="!breakoutSet" v-model.number="floorPct" /><b class="mono">{{ floorPct }} %</b></label>
      </div>
      <button class="cam-btn cam-btn--volt" type="button" :disabled="!breakoutSet" @click="validateZone">
        <i class="fas" :class="breakoutSet ? 'fa-check' : 'fa-hand-pointer'"></i>{{ breakoutSet ? t('tune.cam.validate') : t('tune.cam.tapFirst') }}
      </button>
    </section>

    <section v-else-if="step === 'ready'" class="cam__panel cam__panel--ready">
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

      <div class="cam__readout" :class="{ 'is-measuring': measuring }">
        <span class="cam__value">{{ live.L.toFixed(0) }}</span>
        <span class="cam__unit">px</span>
        <span class="cam__p90 mono">P90 {{ live.p90.toFixed(0) }}</span>
        <span class="cam__state">{{ stateText }}</span>
      </div>
      <div class="cam__meta">
        <span>{{ live.fps }} fps · {{ live.msPerFrame.toFixed(0) }} ms</span>
        <span>conf {{ live.conf.toFixed(2) }}</span>
        <span v-if="exposureLocked"><i class="fas fa-lock"></i>{{ t('tune.cam.exposureLocked') }}</span>
        <span v-if="live.moved" class="cam__warn"><i class="fas fa-triangle-exclamation"></i>{{ t('tune.cam.moved') }}</span>
      </div>
      <p class="cam__hint dim">{{ t('tune.cam.keepStill') }}</p>
      <div class="cam__actions">
        <button class="cam-btn cam-btn--danger" type="button" @click="emergencyStop"><i class="fas fa-stop"></i>{{ t('tune.stop') }}</button>
        <button class="cam-btn" type="button" @click="redoZone"><i class="fas fa-crosshairs"></i>{{ t('tune.cam.redo') }}</button>
      </div>
    </section>
  </div>
</template>

<style>
/* keep the page dark: the phone sits in the scene and must not light it up */
body.tune-cam-body { background: #000; }
</style>

<style scoped>
.cam { min-height: 100dvh; display: flex; flex-direction: column; background: #000; color: #cdd9e6; font-family: var(--font-body); }
.cam__head { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.9rem; font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: #7e90a6; }
.cam__title { display: inline-flex; gap: 0.5rem; align-items: center; color: #cdd9e6; }
.cam__link { display: inline-flex; align-items: center; gap: 0.4rem; }
.cam__link::before { content: ""; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: #ff4d62; }
.cam__link.is-ok { color: #3ddc97; } .cam__link.is-ok::before { background: #3ddc97; box-shadow: 0 0 8px #3ddc97; }
.cam__stage { position: relative; flex: 1 1 auto; min-height: 42vh; background: #000; touch-action: none; }
.cam__video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.cam__overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.cam__gate { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; padding: 1.5rem; text-align: center; background: rgba(0, 0, 0, 0.75); }
.cam__gate p { max-width: 30ch; margin: 0; }
.cam__gate-icon { font-size: 2rem; color: #ff4d62; }
.cam__panel { padding: 0.9rem; display: flex; flex-direction: column; gap: 0.7rem; background: #080b11; border-top: 1px solid rgba(120, 160, 205, 0.15); }
.cam__hint { margin: 0; display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.92rem; }
.cam__hint.dim { color: #7e90a6; font-size: 0.8rem; }
/* placing the zone: the picture asks for the first tap, the panel shows where you are */
.cam__tapme { position: absolute; left: 50%; bottom: 1.1rem; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 0.5rem; max-width: calc(100% - 2rem); padding: 0.55rem 0.95rem; border-radius: 999px; background: rgb(8 17 26 / 0.86); border: 1px solid #46e0ff; color: #cdd9e6; font-size: 0.85rem; text-align: center; pointer-events: none; animation: tapme 1.6s ease-in-out infinite; }
.cam__tapme i { color: #46e0ff; }
@keyframes tapme { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .cam__tapme { animation: none; } }
.cam__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
.cam__steps li { display: flex; align-items: flex-start; gap: 0.6rem; font-size: 0.85rem; color: #7e90a6; }
.cam__steps li.is-current { color: #cdd9e6; }
.cam__steps-n { flex: 0 0 auto; width: 1.4rem; height: 1.4rem; border-radius: 50%; display: grid; place-items: center; font-family: var(--font-mono); font-size: 0.72rem; border: 1px solid #22303f; color: #7e90a6; }
.cam__steps li.is-current .cam__steps-n { background: #46e0ff; border-color: #46e0ff; color: #06090f; font-weight: 700; }
.cam__steps li.is-done .cam__steps-n { border-color: #3ddc97; color: #3ddc97; }
.cam__sliders { display: flex; flex-direction: column; gap: 0.5rem; transition: opacity 0.2s; }
.cam__sliders.is-idle { opacity: 0.4; }
.cam__slider { display: grid; grid-template-columns: 6.5rem 1fr 3rem; align-items: center; gap: 0.6rem; font-size: 0.82rem; color: #7e90a6; }
.cam__slider b { text-align: right; color: #cdd9e6; font-weight: 500; }
.cam__slider input { width: 100%; accent-color: #46e0ff; height: 2rem; }
.cam-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.6rem; padding: 0.85rem 1.2rem; border-radius: 12px; border: 1px solid rgba(120, 160, 205, 0.3); background: #131c28; color: #cdd9e6; font-family: var(--font-display); font-weight: 600; letter-spacing: 0.04em; font-size: 1rem; cursor: pointer; min-height: 3rem; }
.cam-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cam-btn--volt { background: #46e0ff; color: #06090f; border-color: #46e0ff; }
.cam-btn--danger { background: #ff4d62; color: #fff; border-color: #ff4d62; font-size: 1.15rem; flex: 1; }
.cam__panel--ready { gap: 0.6rem; }
.cam__trial { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.7rem 0.8rem; border-radius: 12px; border: 1px solid rgba(120, 160, 205, 0.18); background: #0c111a; }
.cam__trial.is-done { border-color: rgba(120, 160, 205, 0.3); }
.cam__trial.is-best { border-color: #3ddc97; box-shadow: 0 0 18px -8px #3ddc97; }
.cam__trial-head { display: flex; flex-wrap: wrap; gap: 0.2rem 0.8rem; align-items: baseline; }
.cam__trial-n { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: #7e90a6; }
.cam__trial-tap { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; color: #46e0ff; }
.cam__trial-best { font-size: 0.74rem; }
.cam__bg { display: flex; gap: 0.5rem; align-items: center; font-size: 0.85rem; color: #cdd9e6; }
.cam__notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.cam__note { display: grid; grid-template-columns: 6.2rem 1fr; align-items: center; gap: 0.6rem; min-height: 1.5rem; }
.cam__note-name { font-family: var(--font-mono); font-weight: 600; color: #7e90a6; white-space: nowrap; }
.cam__note-name small { font-weight: 400; font-size: 0.72rem; opacity: 0.8; }
.cam__note.is-measuring .cam__note-name { color: #46e0ff; }
.cam__note.is-done .cam__note-name { color: #cdd9e6; }
.cam__note-bar { display: block; height: 0.55rem; border-radius: 999px; background: rgba(70, 224, 255, 0.15); overflow: hidden; }
.cam__note-bar i { display: block; height: 100%; background: #46e0ff; box-shadow: 0 0 10px #46e0ff; transition: width 0.1s linear; }
.cam__note-val { font-size: 0.9rem; color: #cdd9e6; }
.cam__note-val small { color: #7e90a6; }
.cam__result { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem 0.9rem; padding-top: 0.4rem; border-top: 1px dashed rgba(120, 160, 205, 0.25); }
.cam__result-score { font-family: var(--font-display); font-size: 1.8rem; font-weight: 700; color: #cdd9e6; line-height: 1; }
.cam__result-score small { font-size: 0.8rem; color: #7e90a6; font-family: var(--font-mono); }
.cam__result-tag { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; }
.cam__result-tag.is-best { color: #3ddc97; }
.cam__result-tag.is-up { color: #3ddc97; }
.cam__result-tag.is-down { color: #ff8c42; }
.cam__p90 { color: #7e90a6; font-size: 0.85rem; }
.cam__readout { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; padding: 0.5rem 0.8rem; border-radius: 12px; border: 1px solid rgba(120, 160, 205, 0.15); }
.cam__readout.is-measuring { border-color: #46e0ff; box-shadow: 0 0 22px -8px #46e0ff; }
.cam__value { font-family: var(--font-display); font-size: 3rem; font-weight: 700; line-height: 1; color: #46e0ff; font-variant-numeric: tabular-nums; }
.cam__unit { color: #7e90a6; font-family: var(--font-mono); }
.cam__state { margin-left: auto; color: #cdd9e6; font-size: 0.9rem; }
.cam__meta { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; font-family: var(--font-mono); font-size: 0.74rem; color: #7e90a6; }
.cam__meta span { display: inline-flex; gap: 0.35rem; align-items: center; }
.cam__warn { color: #ff4d62; }
.cam__actions { display: flex; gap: 0.6rem; }
</style>
