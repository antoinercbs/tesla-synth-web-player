<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArcMeter, DEFAULT_PARAMS, summarize, type Background, type BackgroundBuilder, type Measurement, type Shift } from '@/vision/arc-meter';
import { ICONS } from '@/ui/icons';

/**
 * The camera side of the arc meter, shared by the phone page of a tuning session
 * and the free meter: rear camera, the zone the operator points, the coil-off
 * background and the per-frame measurement drawn over the picture. The page
 * decides what the measurements are for (`measure`) and lays out its own panel
 * once the zone is set (`#ready`). See src/vision/arc-meter.ts for the method.
 */
const props = withDefaults(defineProps<{
  title: string;
  icon?: string;
  /** i18n key: covers the picture with this error (e.g. the session is gone). */
  error?: string | null;
}>(), { icon: ICONS.tuning, error: null });
const emit = defineEmits<{
  (e: 'started', size: { width: number; height: number }): void;
  /** A new meter, without background yet. */
  (e: 'zone', meter: ArcMeter): void;
  /** Back to placing the zone: the meter is gone. */
  (e: 'setup'): void;
  /** `meter.keep` is this frame's mask until the next frame. */
  (e: 'measure', m: Measurement, meter: ArcMeter, now: number): void;
}>();
const { t } = useI18n();

type Step = 'intro' | 'starting' | 'setup' | 'ready' | 'error';
const step = ref<Step>('intro');
const errorKey = ref('');
const isSecure = window.isSecureContext;
const view = computed<Step>(() => (props.error ? 'error' : step.value));
const shownError = computed(() => props.error || errorKey.value);

/* ----------------------------------------------------------------- camera */
const video = ref<HTMLVideoElement | null>(null);
const overlay = ref<HTMLCanvasElement | null>(null);
const stage = ref<HTMLDivElement | null>(null);
let stream: MediaStream | null = null;
let track: MediaStreamTrack | null = null;
const WORK_W = 384, WORK_LONG = 512;
let workW = WORK_W, workH = 288;
const size = reactive({ width: workW, height: workH });
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
    // a portrait frame keeps the pixel count of a landscape one: the zone now reaches the frame's edges
    const aspect = v.videoHeight / v.videoWidth;
    workW = Math.round(Math.min(WORK_W, WORK_LONG / Math.max(1, aspect))); workH = Math.max(16, Math.round(aspect * workW));
    work.width = workW; work.height = workH;
    size.width = workW; size.height = workH;
    geom.breakout = { x: Math.round(workW / 2), y: Math.round(workH * 0.45) };
    geom.wallBack = WALL_MIN;
    geom.floorY = Math.round(workH * 0.8);
    clampZone();
    step.value = 'setup';
    void requestWakeLock();
    emit('started', { width: workW, height: workH });
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
/*
 * The zone is a corner: the pin's tip (where the arcs start), a vertical wall
 * just behind it (the coil's side is ignored) and the floor, at the ground or
 * the strike rail: the arcs head for it, and a strike is measured down to it.
 * The wall follows the pin when it moves; the floor stays where the ground is.
 */
const geom = reactive({ breakout: { x: 192, y: 120 }, side: 1 as 1 | -1, wallBack: 0, floorY: 240 });
const breakoutSet = ref(false);
/** Finger reach around a handle, in screen px. */
const GRAB_PX = 28;
// the wall must leave the root disk whole, or no arc ever connects to the pin
const WALL_MIN = DEFAULT_PARAMS.rootPx + 4;
const FLOOR_MIN = DEFAULT_PARAMS.rootPx + 2;
const wallX = (): number => geom.breakout.x - geom.side * geom.wallBack;
const floorY = (): number => geom.floorY;
/** Where the arrow that flips the side sits, beside the pin. */
const arrowAt = (): { x: number; y: number } => ({ x: geom.breakout.x + geom.side * 26, y: geom.breakout.y });
/** Grips drawn on the lines, away from the pin. */
const wallGripY = (): number => Math.max(14, geom.breakout.y - Math.max(48, workH * 0.2));
const floorGripX = (): number => {
  const room = geom.side > 0 ? workW - geom.breakout.x : geom.breakout.x;
  return geom.breakout.x + geom.side * Math.max(48, room * 0.45);
};

/** Work px ↔ client px, through the video's object-fit: contain letterboxing. */
function videoBox(): { ox: number; oy: number; k: number } | null {
  const v = video.value;
  if (!v || !v.videoWidth) return null;
  const r = v.getBoundingClientRect();
  const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
  return { ox: r.left + (r.width - dw) / 2, oy: r.top + (r.height - dh) / 2, k: dw / workW };
}
function clampZone(): void {
  const b = geom.breakout;
  geom.wallBack = clamp(geom.wallBack, WALL_MIN, Math.max(WALL_MIN, geom.side > 0 ? b.x : workW - 1 - b.x));
  geom.floorY = clamp(geom.floorY, b.y + FLOOR_MIN, Math.max(b.y + FLOOR_MIN, workH));
}

type Handle = 'pin' | 'arrow' | 'wall' | 'floor';
let drag: { kind: Handle | 'aim'; pointerId: number; x0: number; dx: number; dy: number; moved: boolean } | null = null;
const dragging = ref(false);

/** The handle nearest the finger, within reach. */
function handleAt(x: number, y: number, reach: number): Handle | null {
  const b = geom.breakout, a = arrowAt(), fy = floorY(), wx = wallX();
  const near: [Handle, number][] = [['pin', Math.hypot(x - b.x, y - b.y)], ['arrow', Math.hypot(x - a.x, y - a.y)]];
  if (y <= fy + reach) near.push(['wall', Math.abs(x - wx) * 1.2]);
  if ((x - wx) * geom.side >= -reach) near.push(['floor', Math.abs(y - fy) * 1.2]);
  near.sort((p, q) => p[1] - q[1]);
  return near[0][1] <= reach ? near[0][0] : null;
}

function onStageDown(e: PointerEvent): void {
  if (view.value !== 'setup') return;
  const box = videoBox();
  if (!box) return;
  const x = (e.clientX - box.ox) / box.k, y = (e.clientY - box.oy) / box.k;
  let kind: Handle | 'aim' | null = breakoutSet.value ? handleAt(x, y, GRAB_PX / box.k) : null;
  if (!kind) {
    if (x < 0 || y < 0 || x >= workW || y >= workH) return;
    // a new pin here; the swipe that follows says which way the arcs go
    geom.breakout = { x: Math.round(x), y: Math.round(y) };
    if (!breakoutSet.value) geom.side = x < workW / 2 ? 1 : -1;
    breakoutSet.value = true;
    clampZone();
    kind = 'aim';
  }
  // grabbed off-centre, the pin keeps that offset instead of jumping under the finger
  drag = { kind, pointerId: e.pointerId, x0: x, dx: kind === 'pin' ? geom.breakout.x - x : 0, dy: kind === 'pin' ? geom.breakout.y - y : 0, moved: false };
  dragging.value = true;
  stage.value?.setPointerCapture(e.pointerId);
}
function onStageMove(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const box = videoBox();
  if (!box) return;
  const x = (e.clientX - box.ox) / box.k, y = (e.clientY - box.oy) / box.k;
  if (Math.abs(x - drag.x0) * box.k > 6) drag.moved = true;
  if (drag.kind === 'aim') {
    if (drag.moved) geom.side = x >= drag.x0 ? 1 : -1;
  } else if (drag.kind === 'pin') {
    geom.breakout = { x: clamp(Math.round(x + drag.dx), 0, workW - 1), y: clamp(Math.round(y + drag.dy), 0, workH - 1) };
  } else if (drag.kind === 'wall') {
    geom.wallBack = Math.round((geom.breakout.x - x) * geom.side);
  } else if (drag.kind === 'floor') {
    geom.floorY = Math.round(y);
  }
  clampZone();
}
function onStageUp(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (drag.kind === 'arrow' && !drag.moved) geom.side = geom.side > 0 ? -1 : 1;
  clampZone();
  drag = null;
  dragging.value = false;
}
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function validateZone(): void {
  if (!breakoutSet.value) return;
  cancelCapture();
  const fy = floorY();
  const m = new ArcMeter({ width: workW, height: workH, breakout: { ...geom.breakout }, wall: { x: wallX(), side: geom.side }, excludeBelowY: fy < workH ? fy : null });
  maskCanvas.width = m.crop.w; maskCanvas.height = m.crop.h;
  meter.value = m;
  hasBackground.value = false;
  lastShift = null;
  step.value = 'ready';
  emit('zone', m);
}
function redoZone(): void {
  cancelCapture();
  meter.value = null;
  hasBackground.value = false;
  step.value = 'setup';
  emit('setup');
}

/* ------------------------------------------------------------- processing */
const meter = shallowRef<ArcMeter | null>(null);
const hasBackground = ref(false);
let capture: { builder: BackgroundBuilder; resolve: (bg: Background | null) => void; reject: (e: unknown) => void } | null = null;
const captureState = reactive({ active: false, frames: 0, target: 0 });
let lastShift: Shift | null = null;
let reuseShift = 0;
let lastProcess = 0;
let frameTimes: number[] = [];
const recent: { t: number; L: number; edge: Measurement['edge'] }[] = [];
const live = reactive({ L: 0, p90: 0, conf: 1, dx: 0, dy: 0, fps: 0, moved: false, stable: true, msPerFrame: 0, edge: null as Measurement['edge'] });
let rafId = 0, vfcId = 0;

/**
 * Coil-off frames → the meter's background. Resolves null when cancelled: by
 * another capture, a new zone or `cancelCapture`. No measurement meanwhile.
 */
function captureBackground(frames: number): Promise<Background | null> {
  const m = meter.value;
  if (!m) return Promise.resolve(null);
  cancelCapture();
  const builder = m.backgroundBuilder(Math.min(40, Math.max(8, frames)));
  captureState.active = true; captureState.frames = 0; captureState.target = builder.maxFrames;
  return new Promise((resolve, reject) => { capture = { builder, resolve, reject }; });
}
function cancelCapture(): void {
  const c = capture;
  if (!c) return;
  capture = null; captureState.active = false;
  c.resolve(null);
}
function finishCapture(m: ArcMeter): void {
  const c = capture!;
  capture = null; captureState.active = false;
  try {
    const bg = m.buildBackground(c.builder);
    lastShift = null;
    hasBackground.value = true;
    void lockExposure();
    c.resolve(bg);
  } catch (e) {
    c.reject(e);
  }
}

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
  const mt = meter.value;
  if (mt) {
    const c = mt.crop;
    const crop = wctx.getImageData(c.x0, c.y0, c.w, c.h).data;
    if (capture) {
      capture.builder.add(crop);
      captureState.frames = capture.builder.count;
      if (capture.builder.full) finishCapture(mt);
    } else if (mt.ready) {
      const t0 = performance.now();
      // reuse the alignment for a couple of frames when the phone is slow
      const shift = reuseShift > 0 && lastShift ? lastShift : undefined;
      m = mt.measureCrop(crop, shift);
      if (!shift) lastShift = m.shift;
      const dt = performance.now() - t0;
      live.msPerFrame = dt;
      reuseShift = shift ? reuseShift - 1 : dt > 45 ? 2 : 0;
      updateLive(m, now);
      emit('measure', m, mt, now);
    }
  }
  frameTimes.push(now); frameTimes = frameTimes.filter((x) => now - x < 1000); live.fps = frameTimes.length;
  drawOverlay(m, mt);
}

function updateLive(m: Measurement, now: number): void {
  live.L = m.L; live.conf = m.shift.conf; live.dx = m.shift.dx; live.dy = m.shift.dy; live.moved = m.moved; live.stable = m.stable;
  recent.push({ t: now, L: m.L, edge: m.edge });
  while (recent.length && now - recent[0].t > 1000) recent.shift();
  live.p90 = summarize(recent.map((r) => r.L)).p90;
  // a limit the arcs keep running into is worth a word; one frame is not
  let arcs = 0, frame = 0, zone = 0;
  for (const r of recent) if (r.L > 0) { arcs++; if (r.edge === 'frame') frame++; else if (r.edge === 'zone') zone++; }
  live.edge = arcs >= 3 && frame + zone >= 0.3 * arcs ? (zone >= frame ? 'zone' : 'frame') : null;
}

/* ---------------------------------------------------------------- overlay */
function drawOverlay(m: Measurement | null, mt: ArcMeter | null): void {
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
  if (!breakoutSet.value) return;
  const b = geom.breakout, wx = wallX(), fy = floorY(), side = geom.side;
  const editing = view.value === 'setup';
  const left = X(0), top = Y(0), right = X(workW), bottom = Y(workH);
  // what the meter ignores, dimmed: behind the wall, below the floor
  ctx.fillStyle = `rgb(${css.getPropertyValue('--lo-rgb').trim()} / 0.45)`;
  if (side > 0) ctx.fillRect(left, top, X(wx) - left, bottom - top);
  else ctx.fillRect(X(wx), top, right - X(wx), bottom - top);
  const zx0 = side > 0 ? X(wx) : left, zx1 = side > 0 ? right : X(wx);
  if (fy < workH) ctx.fillRect(zx0, Y(fy), zx1 - zx0, bottom - Y(fy));
  // arc mask
  if (m && mt && m.L > 0) {
    const cr = mt.crop;
    const img = mctx.createImageData(cr.w, cr.h);
    const keep = mt.keep;
    for (let i = 0, j = 0; i < keep.length; i++, j += 4) if (keep[i]) { img.data[j] = mr; img.data[j + 1] = mg; img.data[j + 2] = mb; img.data[j + 3] = 200; }
    mctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(maskCanvas, X(cr.x0), Y(cr.y0), cr.w * k, cr.h * k);
  }
  // the wall and the floor; a limit an arc runs into turns red
  ctx.lineWidth = editing ? 2 : 1.5;
  ctx.strokeStyle = m?.edge === 'zone' ? danger : `rgb(${zone} / 0.9)`;
  ctx.beginPath(); ctx.moveTo(X(wx), top); ctx.lineTo(X(wx), Y(Math.min(fy, workH))); ctx.stroke();
  ctx.strokeStyle = `rgb(${zone} / 0.9)`;
  if (fy < workH) {
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(zx0, Y(fy)); ctx.lineTo(zx1, Y(fy)); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (m?.edge === 'frame') { ctx.strokeStyle = danger; ctx.lineWidth = 3; ctx.strokeRect(left + 1.5, top + 1.5, right - left - 3, bottom - top - 3); }
  if (editing) {
    const ink = css.getPropertyValue('--cam-bg').trim();
    ctx.fillStyle = `rgb(${zone})`; ctx.strokeStyle = ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(X(wx) - 5, Y(wallGripY()) - 14, 10, 28, 5); ctx.fill(); ctx.stroke();
    if (fy < workH) { const gx = X(clamp(floorGripX(), 8, workW - 8)); ctx.beginPath(); ctx.roundRect(gx - 14, Y(fy) - 5, 28, 10, 5); ctx.fill(); ctx.stroke(); }
    // the side the arcs go: an arrow beside the pin, touched to flip
    const ar = arrowAt(), ax = X(ar.x), ay = Y(ar.y);
    ctx.fillStyle = `rgb(${zone} / 0.25)`;
    ctx.beginPath(); ctx.arc(ax, ay, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgb(${zone})`;
    ctx.beginPath(); ctx.moveTo(ax + side * 8, ay); ctx.lineTo(ax - side * 6, ay - 8); ctx.lineTo(ax - side * 6, ay + 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // the pin + the arc's reach
  ctx.fillStyle = danger;
  ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), editing ? 8 : 5, 0, Math.PI * 2); ctx.fill();
  if (editing) { ctx.strokeStyle = css.getPropertyValue('--text-bright').trim(); ctx.lineWidth = 2; ctx.stroke(); }
  if (m && m.tip) {
    ctx.strokeStyle = danger; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(b.x), Y(b.y)); ctx.lineTo(X(m.tip.x), Y(m.tip.y)); ctx.stroke();
  }
}

/* ------------------------------------------------------------------ sheet */
// Over the picture, so the picture never moves. Pulled down, it keeps what must
// stay at hand (Zone OK, the reading, STOP); pulled up, the rest.
const sheetBody = ref<HTMLElement | null>(null);
const sheetOpen = ref(false);
const bodyH = ref(0);
const sheetDrag = ref<number | null>(null);
// no slide on the first layout, only once the sheet has its height
const sheetSettled = ref(false);
const sheetY = computed(() => sheetDrag.value ?? (sheetOpen.value ? 0 : bodyH.value));
let grip: { pointerId: number; y0: number; t0: number; lastY: number; lastT: number; v: number; moved: boolean } | null = null;
let gripDragged = false;

// pulled down whenever the step changes: the picture first
watch(view, () => { sheetOpen.value = false; });
watch(sheetBody, (el, _old, onCleanup) => {
  if (!el) { sheetSettled.value = false; return; }
  const ro = new ResizeObserver(() => { bodyH.value = el.offsetHeight; });
  ro.observe(el);
  bodyH.value = el.offsetHeight;
  requestAnimationFrame(() => { sheetSettled.value = true; });
  onCleanup(() => ro.disconnect());
}, { flush: 'post' });

function onGripDown(e: PointerEvent): void {
  gripDragged = false;
  grip = { pointerId: e.pointerId, y0: e.clientY, t0: sheetY.value, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onGripMove(e: PointerEvent): void {
  if (!grip || e.pointerId !== grip.pointerId) return;
  const dy = e.clientY - grip.y0;
  if (Math.abs(dy) > 4) grip.moved = true;
  if (!grip.moved) return;
  const dt = e.timeStamp - grip.lastT;
  if (dt > 0) grip.v = (e.clientY - grip.lastY) / dt;
  grip.lastY = e.clientY; grip.lastT = e.timeStamp;
  sheetDrag.value = clamp(grip.t0 + dy, 0, bodyH.value);
}
function onGripUp(e: PointerEvent): void {
  if (!grip || e.pointerId !== grip.pointerId) return;
  if (grip.moved) {
    // a flick wins over where the finger let go
    sheetOpen.value = Math.abs(grip.v) > 0.4 ? grip.v < 0 : (sheetDrag.value ?? 0) < bodyH.value / 2;
    gripDragged = true;
  }
  sheetDrag.value = null;
  grip = null;
}
function onGripClick(): void {
  if (gripDragged) { gripDragged = false; return; }
  sheetOpen.value = !sheetOpen.value;
}

/* --------------------------------------------------------------- lifecycle */
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility);
  document.body.classList.add('tune-cam-body');
});
onBeforeUnmount(() => {
  cancelCapture();
  document.removeEventListener('visibilitychange', onVisibility);
  document.body.classList.remove('tune-cam-body');
  if (rafId) cancelAnimationFrame(rafId);
  const vv = video.value as (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }) | null;
  if (vfcId && vv?.cancelVideoFrameCallback) vv.cancelVideoFrameCallback(vfcId);
  stream?.getTracks().forEach((tr) => tr.stop());
  void wakeLock?.release();
});

defineExpose({ captureBackground, cancelCapture, redoZone, meter, hasBackground, capture: captureState, live, exposureLocked, size });
</script>

<template>
  <div class="cam">
    <div ref="stage" class="cam__stage" :class="{ 'is-editing': view === 'setup', 'is-dragging': dragging }"
      @pointerdown="onStageDown" @pointermove="onStageMove" @pointerup="onStageUp" @pointercancel="onStageUp">
      <video ref="video" class="cam__video" playsinline muted autoplay></video>
      <canvas ref="overlay" class="cam__overlay"></canvas>
    </div>

    <header class="cam__head">
      <span class="cam__title"><i class="fas" :class="icon"></i>{{ title }}</span>
      <slot name="head" />
    </header>

    <div v-if="view === 'setup' && !breakoutSet" class="cam__tapme">
      <i class="fas fa-hand-pointer"></i>
      <span>{{ t('tune.cam.aimPrompt') }}</span>
    </div>

    <div v-if="view === 'intro' || view === 'starting' || view === 'error'" class="cam__gate">
      <template v-if="view === 'error'">
        <i class="fas fa-triangle-exclamation cam__gate-icon"></i>
        <p>{{ t(shownError) }}</p>
      </template>
      <template v-else>
        <p>{{ t('tune.cam.intro') }}</p>
        <button class="cam-btn cam-btn--volt" type="button" :disabled="view === 'starting'" @click="startCamera">
          <i class="fas" :class="view === 'starting' ? 'fa-spinner fa-spin' : 'fa-video'"></i>{{ t('tune.cam.start') }}
        </button>
        <p v-if="!isSecure" class="cam__warn">{{ t('tune.cam.needHttps') }}</p>
      </template>
    </div>

    <section v-if="view === 'setup' || view === 'ready'" class="cam__sheet"
      :class="{ 'is-settled': sheetSettled, 'is-dragging': sheetDrag != null }" :style="{ transform: `translateY(${sheetY}px)` }">
      <button class="cam__grip" type="button" :aria-expanded="sheetOpen" :aria-label="sheetOpen ? t('tune.cam.sheetLess') : t('tune.cam.sheetMore')"
        @pointerdown="onGripDown" @pointermove="onGripMove" @pointerup="onGripUp" @pointercancel="onGripUp" @click="onGripClick">
        <span class="cam__grip-bar"></span>
      </button>
      <div class="cam__peek">
        <template v-if="view === 'setup'">
          <ul v-if="breakoutSet" class="cam__legend">
            <li><span class="cam__swatch cam__swatch--dot"></span>{{ t('tune.cam.legendBreakout') }}</li>
            <li><span class="cam__swatch cam__swatch--arrow"></span>{{ t('tune.cam.legendSide') }}</li>
            <li><span class="cam__swatch cam__swatch--wall"></span>{{ t('tune.cam.legendWall') }}</li>
            <li><span class="cam__swatch cam__swatch--floor"></span>{{ t('tune.cam.legendFloor') }}</li>
          </ul>
          <button class="cam-btn cam-btn--volt" type="button" :disabled="!breakoutSet" @click="validateZone">
            <i class="fas" :class="breakoutSet ? 'fa-check' : 'fa-hand-pointer'"></i>{{ breakoutSet ? t('tune.cam.validate') : t('tune.cam.aimFirst') }}
          </button>
        </template>
        <slot v-else name="peek" :live="live" :capture="captureState" :hasBackground="hasBackground" />
      </div>
      <div ref="sheetBody" class="cam__sheet-body">
        <ul v-if="view === 'setup'" class="cam__howto">
          <li><span class="cam__swatch cam__swatch--dot"></span><span>{{ t('tune.cam.howBreakout') }}</span></li>
          <li><span class="cam__swatch cam__swatch--arrow"></span><span>{{ t('tune.cam.howSide') }}</span></li>
          <li><span class="cam__swatch cam__swatch--wall"></span><span>{{ t('tune.cam.howWall') }}</span></li>
          <li><span class="cam__swatch cam__swatch--floor"></span><span>{{ t('tune.cam.howFloor') }}</span></li>
        </ul>
        <template v-else>
          <div class="cam__meta">
            <span>{{ live.fps }} fps · {{ live.msPerFrame.toFixed(0) }} ms</span>
            <span>conf {{ live.conf.toFixed(2) }}</span>
            <span v-if="exposureLocked"><i class="fas fa-lock"></i>{{ t('tune.cam.exposureLocked') }}</span>
          </div>
          <slot name="ready" :live="live" :capture="captureState" :hasBackground="hasBackground" :redoZone="redoZone" />
        </template>
      </div>
    </section>

    <!-- a page's other tab, over the picture: the camera keeps measuring beneath -->
    <div v-if="$slots.cover && view === 'ready'" class="cam__cover">
      <slot name="cover" />
    </div>
  </div>
</template>
