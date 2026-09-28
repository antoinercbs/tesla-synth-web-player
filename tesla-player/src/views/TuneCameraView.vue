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
  const css = getComputedStyle(c);
  const zone = css.getPropertyValue('--zone-rgb').trim(), danger = css.getPropertyValue('--danger').trim();
  const [mr, mg, mb] = css.getPropertyValue('--mask-rgb').trim().split(/\s+/).map(Number);
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
    for (let i = 0, j = 0; i < keep.length; i++, j += 4) if (keep[i]) { img.data[j] = mr; img.data[j + 1] = mg; img.data[j + 2] = mb; img.data[j + 3] = 200; }
    mctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(maskCanvas, X(cr.x0), Y(cr.y0), cr.w * k, cr.h * k);
  }
  // zone
  const b = geom.breakout, R = geom.roiRadius, floorY = b.y + geom.floorBelow;
  const a = (geom.dirDeg * Math.PI) / 180;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgb(${zone} / 0.9)`;
  ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), R * k, a - Math.PI / 2, a + Math.PI / 2); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(X(b.x - R), Y(floorY)); ctx.lineTo(X(b.x + R), Y(floorY)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `rgb(${zone} / 0.15)`;
  ctx.fillRect(X(b.x - R), Y(floorY), 2 * R * k, Math.max(0, (b.y + R - floorY) * k));
  // breakout + tip
  ctx.fillStyle = danger;
  ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), 5, 0, Math.PI * 2); ctx.fill();
  if (m && m.tip) {
    ctx.strokeStyle = danger; ctx.lineWidth = 2;
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
