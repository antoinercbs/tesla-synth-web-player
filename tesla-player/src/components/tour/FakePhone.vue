<script lang="ts">
// where the phone was dragged to, kept for the rest of the visit
let placed: { x: number; y: number } | null = null;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { noteName } from '@/ui/piano-layout';
import {
  DRAW_SCALE, GEOMETRY, GROUND_Y, PIN, phoneAdjustZone, phoneStartCamera, phoneTapBreakout, phoneValidateZone, phoneView as view,
  type ZoneKey,
} from '@/tour/demo/fake-camera';

/**
 * The tuning tour's phone: TuneCameraView's screen as the fake phone
 * (tour/demo/fake-camera.ts) shows it, floating over the page. The picture is
 * drawn (a coil at night with its breakout pin on the side, arcs diving for the
 * ground while a note plays) under the page's own overlay: the corner zone (wall, floor, the side's
 * arrow), the detected arcs in green, the line to the farthest tip; the sheet
 * lies over the picture. Its controls work: the tour's pointer presses them for
 * the phone's steps. It can be dragged out of the way.
 */
const { t } = useI18n();
const emit = defineEmits<{ move: [] }>();
const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

const trialDelta = computed(() => {
  const r = view.trial?.result;
  if (!r || r.score == null || r.bestScore == null || r.isBest) return null;
  return r.score - r.bestScore;
});
const stateText = computed(() => {
  const tr = view.trial;
  if (tr?.phase === 'background') return t('tune.cam.capturing');
  if (!view.live.measuring) return t('tune.cam.idle');
  const i = tr ? tr.notes.findIndex((n) => n.state === 'measuring') : -1;
  return i < 0 ? t('tune.cam.measuring') : `${t('tune.cam.measuring')} · ${noteName(tr!.notes[i].note)} ${i + 1}/${tr!.notes.length}`;
});

// the picture, in the camera's work pixels
const { width: WW, height: WH } = GEOMETRY;
const B = PIN;
const pct = (x: number, y: number): Record<string, string> => ({ left: `${(x / WW) * 100}%`, top: `${(y / WH) * 100}%` });
const spotStyle = pct(B.x, B.y);
const wallX = (): number => B.x - view.zone.wallBack;
const floorY = (): number => B.y + view.zone.floorBelow;
// the grips as the camera page draws them, where the tour's finger takes them
const wallGripY = Math.max(14, B.y - Math.max(48, WH * 0.2));
const floorGripX = B.x + Math.max(48, (WW - B.x) * 0.45);
const grips = computed<{ key: ZoneKey; style: Record<string, string> }[]>(() => [
  { key: 'wallBack', style: pct(wallX(), wallGripY) },
  { key: 'floorBelow', style: pct(floorGripX, floorY()) },
]);

/* ------------------------------------------------------------ drawing */
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
type Pt = { x: number; y: number };
let arcs: Pt[][] = [];
let thrownAt = 0;
let scene: HTMLCanvasElement | null = null;
let raf = 0;

function throwArcs(length: number): void {
  arcs = [];
  const walk = (x: number, y: number, dir: number, len: number, depth: number): void => {
    const pts: Pt[] = [{ x, y }];
    for (let d = 0; d < len; d += 5) {
      dir += (Math.random() - 0.38) * 0.7; // the arcs bend down, towards the ground
      x += Math.cos(dir) * 5;
      y += Math.sin(dir) * 5;
      if (y >= floorY() || x < wallX() || x >= WW || y < 0) break;
      pts.push({ x, y });
      if (depth < 2 && Math.random() < 0.06) walk(x, y, dir + (Math.random() - 0.5) * 1.4, (len - d) * 0.5, depth + 1);
    }
    arcs.push(pts);
  };
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) walk(B.x, B.y, 0.15 + (Math.random() - 0.5) * 0.9, DRAW_SCALE * length * (0.4 + 0.7 * Math.random()), 0);
}

function paintScene(ctx: CanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, 0, WH);
  sky.addColorStop(0, '#0b1220');
  sky.addColorStop(1, '#141a24');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WW, WH);
  // the ground, its edge just catching the light
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, GROUND_Y, WW, WH - GROUND_Y);
  ctx.fillStyle = '#1b222d';
  ctx.fillRect(0, GROUND_Y, WW, 2);
  const cx = 100, ty = B.y + 2; // the coil's axis, the toroid's height
  // primary: the flat spiral round the foot of the secondary, seen at an angle
  ctx.strokeStyle = '#b87a3e';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, ty + 128, 40 + i * 9, 6 + i * 1.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // secondary: a copper winding, on its base, on the ground
  const copper = ctx.createLinearGradient(cx - 16, 0, cx + 16, 0);
  copper.addColorStop(0, '#6b3f1c');
  copper.addColorStop(0.45, '#d4944f');
  copper.addColorStop(1, '#5e3718');
  ctx.fillStyle = copper;
  ctx.fillRect(cx - 16, ty + 12, 32, 118);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = ty + 14; y < ty + 130; y += 3) ctx.fillRect(cx - 16, y, 32, 1);
  ctx.fillStyle = '#262b33';
  ctx.fillRect(cx - 52, ty + 130, 104, 12);
  ctx.fillRect(cx - 40, ty + 142, 80, GROUND_Y - ty - 142);
  // toroid, with its breakout pin sticking out sideways
  const metal = ctx.createLinearGradient(0, ty - 16, 0, ty + 16);
  metal.addColorStop(0, '#9aa3ad');
  metal.addColorStop(0.3, '#e3e7ec');
  metal.addColorStop(1, '#4d535c');
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.ellipse(cx, ty, 58, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1f27';
  ctx.beginPath();
  ctx.ellipse(cx, ty - 3, 22, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d7dce2';
  ctx.fillRect(cx + 56, B.y - 1.5, B.x - cx - 56, 3);
  const vignette = ctx.createRadialGradient(WW / 2, WH / 2, WW * 0.4, WW / 2, WH / 2, WH * 0.62);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WW, WH);
}

function line(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

function draw(now: number): void {
  raf = requestAnimationFrame(draw);
  const c = canvas.value;
  if (!c || !c.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(c.clientWidth * dpr);
  if (c.width !== w || !scene) {
    c.width = w;
    c.height = Math.round((w * WH) / WW);
    scene = document.createElement('canvas');
    scene.width = c.width;
    scene.height = c.height;
    const sctx = scene.getContext('2d')!;
    sctx.scale(c.width / WW, c.width / WW);
    paintScene(sctx);
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const css = getComputedStyle(c);
  const zone = css.getPropertyValue('--zone-rgb').trim(), danger = css.getPropertyValue('--danger').trim();
  if (view.step === 'intro') {
    // the camera is not started yet
    ctx.fillStyle = css.getPropertyValue('--cam-bg');
    ctx.fillRect(0, 0, c.width, c.height);
    return;
  }
  const k = c.width / WW; // work px → canvas px
  const px = dpr / k; // one CSS pixel, in work px
  ctx.drawImage(scene, 0, 0);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const editing = view.step === 'setup';
  const wx = wallX(), fy = floorY();
  // the page's overlay: what the meter ignores, dimmed (behind the wall, below the floor)
  if (view.breakoutSet) {
    ctx.fillStyle = `rgb(${css.getPropertyValue('--lo-rgb').trim()} / 0.45)`;
    ctx.fillRect(0, 0, wx, WH);
    ctx.fillRect(wx, fy, WW - wx, WH - fy);
  }
  // a note plays: arcs, re-thrown a few times per second like the real ones
  if (view.arc > 0) {
    if (now - thrownAt > (reduceMotion ? 700 : 90)) {
      throwArcs(view.arc);
      thrownAt = now;
    }
    ctx.strokeStyle = 'rgba(190, 170, 255, 0.45)';
    ctx.lineWidth = 3.5 * px;
    ctx.shadowColor = 'rgba(170, 140, 255, 0.9)';
    ctx.shadowBlur = 8 * dpr;
    arcs.forEach((a) => line(ctx, a));
    ctx.shadowBlur = 0;
    // what the meter keeps, in the page's green
    ctx.strokeStyle = `rgb(${css.getPropertyValue('--mask-rgb')} / 0.8)`;
    ctx.lineWidth = 1.6 * px;
    arcs.forEach((a) => line(ctx, a));
  } else arcs = [];
  if (!view.breakoutSet) return;
  // the wall and the floor
  ctx.strokeStyle = `rgb(${zone} / 0.9)`;
  ctx.lineWidth = (editing ? 2 : 1.2) * px;
  line(ctx, [{ x: wx, y: 0 }, { x: wx, y: fy }]);
  ctx.setLineDash([5 * px, 3 * px]);
  line(ctx, [{ x: wx, y: fy }, { x: WW, y: fy }]);
  ctx.setLineDash([]);
  if (editing) {
    ctx.fillStyle = `rgb(${zone})`;
    ctx.strokeStyle = css.getPropertyValue('--cam-bg').trim();
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); ctx.roundRect(wx - 4 * px, wallGripY - 11 * px, 8 * px, 22 * px, 4 * px); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(floorGripX - 11 * px, fy - 4 * px, 22 * px, 8 * px, 4 * px); ctx.fill(); ctx.stroke();
    // the side the arcs go: an arrow beside the pin
    const ax = B.x + 20, ay = B.y;
    ctx.fillStyle = `rgb(${zone} / 0.25)`;
    ctx.beginPath(); ctx.arc(ax, ay, 12 * px, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgb(${zone})`;
    ctx.beginPath(); ctx.moveTo(ax + 6 * px, ay); ctx.lineTo(ax - 5 * px, ay - 6 * px); ctx.lineTo(ax - 5 * px, ay + 6 * px); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = danger;
  ctx.beginPath();
  ctx.arc(B.x, B.y, (editing ? 5.5 : 3.5) * px, 0, Math.PI * 2);
  ctx.fill();
  if (editing) { ctx.strokeStyle = css.getPropertyValue('--text-bright').trim(); ctx.lineWidth = 1.5 * px; ctx.stroke(); }
  const reach = (p: Pt): number => Math.hypot(p.x - B.x, p.y - B.y);
  const tip = arcs.flat().reduce<Pt | null>((far, p) => (!far || reach(p) > reach(far) ? p : far), null);
  if (tip) {
    ctx.strokeStyle = danger;
    ctx.lineWidth = 1.5 * px;
    line(ctx, [B, tip]);
  }
}

/* ------------------------------------------------------------ floating */
const pos = reactive({ x: 0, y: 0 });
const placedOnce = ref(false);
const dragging = ref(false);
let grab: { dx: number; dy: number } | null = null;
let ro: ResizeObserver | null = null;

function keepOnScreen(): void {
  const r = root.value?.getBoundingClientRect();
  if (!r) return;
  pos.x = Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - r.width - 8));
  pos.y = Math.min(Math.max(pos.y, 8), Math.max(8, window.innerHeight - r.height - 8));
}
function onResize(): void {
  keepOnScreen();
  emit('move');
}
function onDown(e: PointerEvent): void {
  if ((e.target as Element).closest('button') || e.button !== 0) return;
  grab = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  dragging.value = true;
  root.value?.setPointerCapture(e.pointerId);
}
function onMove(e: PointerEvent): void {
  if (!grab) return;
  pos.x = e.clientX - grab.dx;
  pos.y = e.clientY - grab.dy;
  keepOnScreen();
  placed = { ...pos };
  emit('move');
}
function onUp(): void {
  grab = null;
  dragging.value = false;
}

onMounted(() => {
  raf = requestAnimationFrame(draw);
  const r = root.value!.getBoundingClientRect();
  // left side, over the sidebar: the tuning pages keep their content to the right
  Object.assign(pos, placed ?? { x: 20, y: (window.innerHeight - r.height) / 2 });
  keepOnScreen();
  placedOnce.value = true;
  ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
  ro?.observe(root.value!);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <aside ref="root" class="fphone" :class="{ 'is-placed': placedOnce, 'is-dragging': dragging }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }" aria-hidden="true"
    @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
    <span class="fphone__caption" :title="t('tour.phoneMove')">
      <i class="fas fa-mobile-screen"></i>{{ t('tour.phoneCaption') }}<i class="fas fa-up-down-left-right fphone__grip"></i>
    </span>
    <div class="fphone__device">
      <div class="fphone__stage">
        <canvas ref="canvas" class="fphone__canvas"></canvas>
        <header class="fphone__head">
          <span class="fphone__title"><i class="fas fa-bullseye"></i>{{ t('tune.cam.title') }}</span>
          <span class="fphone__link">{{ t('tune.cam.linkOk') }}</span>
        </header>
        <template v-if="view.step === 'setup'">
          <button type="button" class="fphone__spot" :style="spotStyle" tabindex="-1" @click="phoneTapBreakout"></button>
          <template v-if="view.breakoutSet">
            <button v-for="g in grips" :key="g.key" type="button" class="fphone__handle" :data-k="g.key" :style="g.style" tabindex="-1"
              @click="phoneAdjustZone(g.key)"></button>
          </template>
          <span v-else class="fphone__tapme"><i class="fas fa-hand-pointer"></i>{{ t('tune.cam.aimPrompt') }}</span>
        </template>
        <div v-if="view.step === 'intro'" class="fphone__gate">
          <p>{{ t('tune.cam.intro') }}</p>
          <button type="button" class="fphone__btn fphone__btn--volt fphone__start" tabindex="-1" @click="phoneStartCamera">
            <i class="fas fa-video"></i>{{ t('tune.cam.start') }}
          </button>
        </div>

        <!-- the sheet over the picture: pulled down while a trial runs (the arcs on show), up for its result -->
        <div v-if="view.step === 'setup' || view.step === 'ready'" class="fphone__sheet">
          <span class="fphone__sheet-grip"></span>
          <template v-if="view.step === 'setup'">
            <ul v-if="view.breakoutSet" class="fphone__legend">
              <li><span class="fphone__swatch fphone__swatch--dot"></span>{{ t('tune.cam.legendBreakout') }}</li>
              <li><span class="fphone__swatch fphone__swatch--arrow"></span>{{ t('tune.cam.legendSide') }}</li>
              <li><span class="fphone__swatch fphone__swatch--wall"></span>{{ t('tune.cam.legendWall') }}</li>
              <li><span class="fphone__swatch fphone__swatch--floor"></span>{{ t('tune.cam.legendFloor') }}</li>
            </ul>
            <button type="button" class="fphone__btn fphone__btn--volt fphone__validate" tabindex="-1" :disabled="!view.breakoutSet" @click="phoneValidateZone">
              <i class="fas" :class="view.breakoutSet ? 'fa-check' : 'fa-hand-pointer'"></i>{{ view.breakoutSet ? t('tune.cam.validate') : t('tune.cam.aimFirst') }}
            </button>
          </template>
          <template v-else>
            <div class="fphone__readout" :class="{ 'is-measuring': view.live.measuring }">
              <b class="fphone__value">{{ view.live.L.toFixed(0) }}</b><span class="fphone__unit">px</span>
              <span class="fphone__state">{{ stateText }}</span>
            </div>
            <span class="fphone__btn fphone__btn--danger"><i class="fas fa-stop"></i>{{ t('tune.stop') }}</span>
            <div v-if="view.trial?.phase === 'done'" class="fphone__trial" :class="{ 'is-best': view.trial.result?.isBest }">
              <div class="fphone__trial-head">
                <span class="fphone__trial-n">{{ t('tune.cam.trialN', { n: view.trial.index }) }}</span>
                <span class="fphone__trial-tap">{{ t('tune.cam.tapAt', { tap: view.trial.tapLabel }) }}</span>
              </div>
              <ol class="fphone__notes">
                <li v-for="(n, i) in view.trial.notes" :key="i" class="fphone__note" :class="`is-${n.state}`">
                  <span class="fphone__note-name">{{ noteName(n.note) }}</span>
                  <span v-if="n.state === 'measuring'" class="fphone__bar"><i :style="{ width: `${view.trial.progress * 100}%` }"></i></span>
                  <span v-else-if="n.state === 'done'" class="fphone__note-val">{{ n.p90?.toFixed(0) }} px</span>
                  <span v-else class="fphone__note-val is-dim">{{ n.state === 'skipped' ? '—' : t('tune.cam.pending') }}</span>
                </li>
              </ol>
              <div v-if="view.trial.result" class="fphone__result">
                <template v-if="view.trial.result.score != null">
                  <b>{{ view.trial.result.score }} <small>px</small></b>
                  <span v-if="view.trial.result.isBest" class="fphone__tag is-best"><i class="fas fa-trophy"></i>{{ t('tune.cam.newBest') }}</span>
                  <span v-else-if="trialDelta != null" class="fphone__tag" :class="trialDelta >= 0 ? 'is-up' : 'is-down'">
                    <i class="fas" :class="trialDelta >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'"></i>{{ (trialDelta > 0 ? '+' : '') + trialDelta }} px
                  </span>
                </template>
                <span v-else class="fphone__tag is-down"><i class="fas fa-ban"></i>{{ t('tune.cam.trialAborted') }}</span>
              </div>
            </div>
            <p v-else-if="!view.trial" class="fphone__hint">{{ t('tune.cam.waitingTrial') }}</p>
          </template>
        </div>
      </div>
    </div>
  </aside>
</template>
