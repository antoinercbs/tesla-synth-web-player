<script lang="ts">
// where the phone was dragged to, kept for the rest of the visit
let placed: { x: number; y: number } | null = null;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { noteName } from '@/ui/piano-layout';
import {
  DEMO_ZONE, GEOMETRY, phoneAdjustZone, phoneStartCamera, phoneTapBreakout, phoneValidateZone, phoneView as view,
  type PhoneView, type ZoneKey,
} from '@/tour/demo/fake-camera';

/**
 * The tuning tour's phone: TuneCameraView's screen as the fake phone
 * (tour/demo/fake-camera.ts) shows it, floating over the page. The picture is
 * drawn (a coil at night, arcs while a note plays) under the page's own
 * overlay: the zone, the breakout, the detected arcs in green, the line to the
 * farthest tip. Its controls work: the tour's pointer presses them for the
 * phone's steps. It can be dragged out of the way.
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
  if (view.trial?.phase === 'background') return t('tune.cam.capturing');
  return view.live.measuring ? t('tune.cam.measuring') : t('tune.cam.idle');
});

// the picture, in the camera's work pixels
const { width: WW, height: WH, breakout: B } = GEOMETRY;
const ARC_R = GEOMETRY.roiRadius;
const ARC_FLOOR = GEOMETRY.excludeBelowY ?? WH;
const spotStyle = { left: `${(B.x / WW) * 100}%`, top: `${(B.y / WH) * 100}%` };

// the zone's sliders, shown as the camera page shows them
type Zone = PhoneView['zone'];
const SLIDERS: { key: ZoneKey; label: string; min: number; max: number; unit: string; value: (z: Zone) => number }[] = [
  { key: 'radius', label: 'tune.cam.radius', min: 8, max: 90, unit: ' %', value: (z) => Math.round((z.radius / Math.min(WW, WH)) * 100) },
  { key: 'dirDeg', label: 'tune.cam.direction', min: -180, max: 180, unit: '°', value: (z) => Math.round(z.dirDeg) },
  { key: 'floorBelow', label: 'tune.cam.floor', min: -50, max: 100, unit: ' %', value: (z) => Math.round((z.floorBelow / Math.max(1, z.radius)) * 100) },
];
const sliders = computed(() => SLIDERS.map((s) => {
  const at = (v: number): number => ((v - s.min) / (s.max - s.min)) * 100;
  const v = s.value(view.zone);
  return { key: s.key, label: t(s.label), text: `${v}${s.unit}`, pos: at(v), target: at(s.value(DEMO_ZONE)) };
}));

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
    for (let d = 0; d < len; d += 6) {
      dir += (Math.random() - 0.5) * 0.9;
      x += Math.cos(dir) * 6;
      y += Math.sin(dir) * 6;
      if (y > ARC_FLOOR || Math.hypot(x - B.x, y - B.y) > ARC_R) break;
      pts.push({ x, y });
      if (depth < 2 && Math.random() < 0.06) walk(x, y, dir + (Math.random() - 0.5) * 1.4, (len - d) * 0.5, depth + 1);
    }
    arcs.push(pts);
  };
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) walk(B.x, B.y, -Math.PI / 2 + (Math.random() - 0.5) * 2.2, length * (0.4 + 0.7 * Math.random()), 0);
}

function paintScene(ctx: CanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, 0, WH);
  sky.addColorStop(0, '#0b1220');
  sky.addColorStop(1, '#141a24');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WW, WH);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 452, WW, WH - 452);
  // primary: the flat spiral round the foot of the secondary, seen at an angle
  ctx.strokeStyle = '#b87a3e';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(B.x, 440, 52 + i * 11, 7 + i * 1.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // secondary: a copper winding
  const copper = ctx.createLinearGradient(302, 0, 338, 0);
  copper.addColorStop(0, '#6b3f1c');
  copper.addColorStop(0.45, '#d4944f');
  copper.addColorStop(1, '#5e3718');
  ctx.fillStyle = copper;
  ctx.fillRect(302, 326, 36, 124);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = 328; y < 450; y += 3) ctx.fillRect(302, y, 36, 1);
  ctx.fillStyle = '#262b33';
  ctx.fillRect(262, 450, 116, 14);
  // toroid, with its breakout on top
  const metal = ctx.createLinearGradient(0, 299, 0, 333);
  metal.addColorStop(0, '#9aa3ad');
  metal.addColorStop(0.3, '#e3e7ec');
  metal.addColorStop(1, '#4d535c');
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.ellipse(B.x, 316, 70, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1f27';
  ctx.beginPath();
  ctx.ellipse(B.x, 313, 26, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d7dce2';
  ctx.fillRect(B.x - 1.5, B.y - 4, 3, 6);
  const vignette = ctx.createRadialGradient(WW / 2, WH / 2, WH * 0.3, WW / 2, WH / 2, WW * 0.62);
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
  // the page's overlay: zone, floor line, breakout, tip
  const { radius: R, dirDeg, floorBelow } = view.zone;
  const dir = (dirDeg * Math.PI) / 180;
  const floor = B.y + floorBelow;
  ctx.strokeStyle = `rgb(${zone} / 0.9)`;
  ctx.lineWidth = 1.2 * px;
  ctx.beginPath();
  ctx.arc(B.x, B.y, R, dir - Math.PI / 2, dir + Math.PI / 2);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([5 * px, 3 * px]);
  ctx.beginPath();
  ctx.moveTo(B.x - R, floor);
  ctx.lineTo(B.x + R, floor);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `rgb(${zone} / 0.15)`;
  ctx.fillRect(B.x - R, floor, 2 * R, Math.max(0, B.y + R - floor));
  ctx.fillStyle = danger;
  ctx.beginPath();
  ctx.arc(B.x, B.y, 3.5 * px, 0, Math.PI * 2);
  ctx.fill();
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
      <header class="fphone__head">
        <span class="fphone__title"><i class="fas fa-bullseye"></i>{{ t('tune.cam.title') }}</span>
        <span class="fphone__link">{{ t('tune.cam.linkOk') }}</span>
      </header>
      <div class="fphone__stage">
        <canvas ref="canvas" class="fphone__canvas"></canvas>
        <button v-if="view.step === 'setup'" type="button" class="fphone__spot" :style="spotStyle" tabindex="-1" @click="phoneTapBreakout"></button>
        <span v-if="view.step === 'setup' && !view.breakoutSet" class="fphone__tapme">
          <i class="fas fa-hand-pointer"></i>{{ t('tune.cam.tapPrompt') }}
        </span>
        <div v-if="view.step === 'intro'" class="fphone__gate">
          <p>{{ t('tune.cam.intro') }}</p>
          <button type="button" class="fphone__btn fphone__btn--volt fphone__start" tabindex="-1" @click="phoneStartCamera">
            <i class="fas fa-video"></i>{{ t('tune.cam.start') }}
          </button>
        </div>
      </div>

      <div v-if="view.step === 'intro'" class="fphone__panel">
        <p class="fphone__hint">{{ t('tune.cam.keepStill') }}</p>
      </div>

      <div v-else-if="view.step === 'setup'" class="fphone__panel">
        <p class="fphone__stepline">
          <span class="fphone__stepn">{{ view.breakoutSet ? 2 : 1 }}</span>
          <span>{{ view.breakoutSet ? t('tune.cam.step2') : t('tune.cam.step1') }}</span>
        </p>
        <div class="fphone__sliders" :class="{ 'is-idle': !view.breakoutSet }">
          <div v-for="s in sliders" :key="s.key" class="fphone__slider" :data-k="s.key">
            <span class="fphone__slider-label">{{ s.label }}</span>
            <span class="fphone__track">
              <i class="fphone__thumb" :style="{ left: `${s.pos}%` }"></i>
              <button type="button" class="fphone__hit" :style="{ left: `${s.target}%` }" tabindex="-1" :disabled="!view.breakoutSet"
                @click="phoneAdjustZone(s.key)"></button>
            </span>
            <b class="fphone__slider-val">{{ s.text }}</b>
          </div>
        </div>
        <button type="button" class="fphone__btn fphone__btn--volt fphone__validate" tabindex="-1" :disabled="!view.breakoutSet" @click="phoneValidateZone">
          <i class="fas" :class="view.breakoutSet ? 'fa-check' : 'fa-hand-pointer'"></i>{{ view.breakoutSet ? t('tune.cam.validate') : t('tune.cam.tapFirst') }}
        </button>
      </div>

      <div v-else class="fphone__panel">
        <div v-if="view.trial" class="fphone__trial" :class="{ 'is-best': view.trial.result?.isBest }">
          <div class="fphone__trial-head">
            <span class="fphone__trial-n">{{ t('tune.cam.trialN', { n: view.trial.index }) }}</span>
            <span class="fphone__trial-tap">{{ t('tune.cam.tapAt', { tap: view.trial.tapLabel }) }}</span>
          </div>
          <span v-if="view.trial.phase === 'background'" class="fphone__bg">
            <i class="fas fa-circle-notch fa-spin"></i>{{ t('tune.cam.bgProgress', { n: view.trial.bgFrames, total: 24 }) }}
          </span>
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
        <p v-else class="fphone__hint">{{ t('tune.cam.waiting') }}</p>
        <div class="fphone__readout" :class="{ 'is-measuring': view.live.measuring }">
          <b class="fphone__value">{{ view.live.L.toFixed(0) }}</b><span class="fphone__unit">px</span>
          <span class="fphone__state">{{ stateText }}</span>
        </div>
        <span class="fphone__btn fphone__btn--danger"><i class="fas fa-stop"></i>{{ t('tune.stop') }}</span>
      </div>
    </div>
  </aside>
</template>
