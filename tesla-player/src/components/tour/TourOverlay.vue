<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { TOUR_ICONS, TOURS, type TourNote, type TourPlacement, type TourStep } from '@/tour/steps';
import { stopTour, tour } from '@/tour/tour';
import { enterDemo, exitDemo, isDemoOutputActive, reassertDemo } from '@/tour/demo/demo-mode';
import { DEMO_ENVELOPE_PROGRAM, DEMO_FILE_ID, DEMO_PLAYLIST_ID, DEMO_SONG_ID } from '@/tour/demo/data';
import { phoneView } from '@/tour/demo/fake-camera';
import { mobileLayout } from '@/ui/viewport';
import FakePhone from './FakePhone.vue';
import TourRich from './TourRich.vue';
import WelcomeDialog from './WelcomeDialog.vue';

/**
 * The guided tour: dims the app, cuts a hole round the step's element, and puts
 * the explanation card beside it. Everything the tour needs lives here and in
 * tour/steps.ts: it finds its targets by selector, so no component knows about it.
 * While it runs, the app works on the demo library (tour/demo). Mounted once, in App.vue.
 */
const router = useRouter();
const route = useRoute();
const { locale } = useI18n();

const PAD = 8; // hole margin round the target
const GAP = 14; // hole to card
const EDGE = 12; // card to viewport edge
const WIDE = 640; // narrower: the card docks to the bottom
const UNTIL_MAX = 20_000; // a step waiting for the page never locks the tour: Next comes back after this
const NOTE_ICONS: Record<TourNote, string> = { warn: 'fa-triangle-exclamation', tip: 'fa-lightbulb' };

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

const index = ref(0);
// the demo pointer: glides onto a step's control and clicks it, so the page shows
// the state (and the motion: a playing song) the text talks about
const cursor = reactive({ x: 0, y: 0, shown: false, pressing: false });
const pending = ref(false); // between steps the card hides; the hole slides on once the target is found
const ready = ref(true); // false while the step waits for its `until`
const acted = new Set<string>(); // `once` steps whose clicks already ran in this tour
let untilTimer: ReturnType<typeof setTimeout> | undefined;
const rect = ref<DOMRect | null>(null);
const cardEl = ref<HTMLElement | null>(null);
const cardPos = ref<{ left: number; top: number } | null>(null);
let target: HTMLElement | null = null;
let showSeq = 0; // a newer step wins over a slower, earlier one still resolving
let ro: ResizeObserver | null = null;

const steps = computed(() => TOURS[tour.id].filter((s) => !(s.wide && mobileLayout.value)));
// another tour may have left its index past this one's end, for the render before show(0)
const step = computed(() => steps.value[index.value] ?? steps.value[0]);
const isLast = computed(() => index.value === steps.value.length - 1);
const progress = computed(() => ((index.value + 1) / steps.value.length) * 100);

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function findTarget(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) if (isVisible(el)) return el;
  return null;
}
// a page opened by the tour renders its target a few frames later
function waitFor<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (): void => {
      const found = find();
      if (found || performance.now() - t0 > timeoutMs) resolve(found);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}
const waitForTarget = (selector: string, timeoutMs = 1200): Promise<HTMLElement | null> =>
  waitFor(() => findTarget(selector), timeoutMs);

function aim(el: HTMLElement | null): void {
  ro?.disconnect();
  target = el;
  if (target) {
    // scrolled only when cut off, and no further: the tuning page's header is sticky and transparent
    const r = target.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    ro?.observe(target);
  }
  measure();
}

/** Glide the pointer onto `el`, press, click; the click only happens if `allowed()`
 *  still holds by then (the tour may have been left meanwhile). */
async function clickWithCursor(el: HTMLElement, allowed: () => boolean): Promise<void> {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (!reduceMotion) {
    if (!cursor.shown) {
      if (!cursor.x && !cursor.y) [cursor.x, cursor.y] = [x + 90, y + 70];
      cursor.shown = true;
      await frame();
    }
    [cursor.x, cursor.y] = [x, y];
    await wait(620);
    cursor.pressing = true;
    await wait(120);
  }
  if (allowed()) el.click();
  if (!reduceMotion) {
    await wait(260);
    cursor.pressing = false;
  }
}

async function show(i: number): Promise<void> {
  const seq = ++showSeq;
  const s = steps.value[i];
  index.value = i;
  pending.value = true;
  ready.value = true;
  clearTimeout(untilTimer);
  reassertDemo();
  if (router.resolve(s.route).fullPath !== route.fullPath) await router.push(s.route).catch(() => {});
  if (seq !== showSeq) return;
  s.enter?.();
  const clicks = s.click === undefined ? [] : ([] as string[]).concat(s.click);
  // the page is there once it shows the target, or a control whose click opens it
  const onPage = (): HTMLElement | null =>
    (s.target ? findTarget(s.target) : null) ?? clicks.map(findTarget).find((el) => el !== null) ?? null;
  await waitFor(onPage, s.target || clicks.length ? 1200 : 0);
  if (seq !== showSeq) return;
  // the hole lands on the target first, then the pointer clicks inside it; no
  // target yet: the hole stays put until a control or the target takes it
  const el = s.target ? findTarget(s.target) : null;
  if (el || !clicks.length) aim(el);
  const canClick = (): boolean => seq === showSeq && tour.active && (!s.plays || isDemoOutputActive());
  if (clicks.length && canClick() && !(s.once && acted.has(s.id))) {
    if (s.once) acted.add(s.id);
    let clicked = false;
    for (const selector of clicks) {
      // after a click, the next control may take a moment to show (a confirmation)
      const control = clicked ? await waitForTarget(selector, 400) : findTarget(selector);
      if (seq !== showSeq) return;
      if (!control) continue;
      if (!target?.contains(control)) aim(control);
      if (!reduceMotion) await wait(300);
      await clickWithCursor(control, canClick);
      if (seq !== showSeq) return;
      clicked = true;
      await nextTick();
      await frame(); // let the switched view render
    }
    if (clicked || !target) aim(s.target ? await waitForTarget(s.target) : null);
    if (seq !== showSeq) return;
  }
  cursor.shown = false;
  if (s.until && !findTarget(s.until)) waitUntil(seq, s);
  pending.value = false;
  await nextTick();
  cardEl.value?.querySelector<HTMLElement>('[data-primary]')?.focus();
}

/** Next waits for `until` (a trial running to its end); the page may have moved on by then. */
function waitUntil(seq: number, s: TourStep): void {
  ready.value = false;
  const t0 = performance.now();
  const tick = (): void => {
    if (seq !== showSeq) return;
    if (!findTarget(s.until!) && performance.now() - t0 < UNTIL_MAX) {
      untilTimer = setTimeout(tick, 150);
      return;
    }
    ready.value = true;
    const el = s.target ? findTarget(s.target) : null;
    if (el && el !== target) aim(el);
    else remeasure();
    nextTick(() => cardEl.value?.querySelector<HTMLElement>('[data-primary]')?.focus());
  };
  tick();
}

function measure(): void {
  rect.value = target && target.isConnected && isVisible(target) ? target.getBoundingClientRect() : null;
  nextTick(placeCard);
}
let raf = 0;
function remeasure(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(measure);
}

function placeCard(): void {
  const card = cardEl.value;
  const r = rect.value;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!card || !r || vw < WIDE) {
    cardPos.value = null; // centred, or docked at the bottom on a phone
    return;
  }
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const hole = { l: r.left - PAD, t: r.top - PAD, r: r.right + PAD, b: r.bottom + PAD };
  const room: Record<TourPlacement, boolean> = {
    right: vw - hole.r - GAP >= cw + EDGE,
    left: hole.l - GAP >= cw + EDGE,
    bottom: vh - hole.b - GAP >= ch + EDGE,
    top: hole.t - GAP >= ch + EDGE,
  };
  const order: TourPlacement[] = [step.value.placement ?? 'bottom', 'right', 'bottom', 'left', 'top'];
  const side = order.find((p) => room[p]);
  const midX = (hole.l + hole.r) / 2 - cw / 2;
  const midY = (hole.t + hole.b) / 2 - ch / 2;
  let left = vw - cw - EDGE; // nothing fits (the target fills the screen): bottom-right corner
  let top = vh - ch - EDGE;
  if (side === 'right') [left, top] = [hole.r + GAP, midY];
  else if (side === 'left') [left, top] = [hole.l - GAP - cw, midY];
  else if (side === 'bottom') [left, top] = [midX, hole.b + GAP];
  else if (side === 'top') [left, top] = [midX, hole.t - GAP - ch];
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
  cardPos.value = { left: clamp(left, EDGE, vw - cw - EDGE), top: clamp(top, EDGE, vh - ch - EDGE) };
}

const holeStyle = computed(() => {
  const r = rect.value;
  if (!r) return undefined;
  return { left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + 2 * PAD}px`, height: `${r.height + 2 * PAD}px` };
});
const cardStyle = computed(() => (cardPos.value ? { left: `${cardPos.value.left}px`, top: `${cardPos.value.top}px` } : undefined));

function next(): void {
  if (!ready.value) return;
  if (isLast.value) finish();
  else show(index.value + 1);
}
function prev(): void {
  if (index.value > 0) show(index.value - 1);
}
function finish(): void {
  stopTour();
}

// capture phase on window: runs before the app's own shortcuts (the Live piano
// listens to the arrow keys), and keeps Tab inside the card
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') finish();
  else if (e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'Tab') {
    const items = [...(cardEl.value?.querySelectorAll<HTMLElement>('button') ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
    items[to].focus();
  } else return;
  e.preventDefault();
  e.stopPropagation();
}

/** Where the app's tour leaves the user: off a demo item's page (its library instead), else where it is. */
function afterDemo(): RouteLocationRaw | null {
  const id = String(route.params.id ?? '');
  if (route.name === 'midi-edit' && id === String(DEMO_FILE_ID)) return { name: 'midi' };
  if (route.name === 'envelopes' && String(route.params.program ?? '') === String(DEMO_ENVELOPE_PROGRAM)) return { name: 'envelopes' };
  if ([String(DEMO_SONG_ID), String(DEMO_PLAYLIST_ID)].includes(id)) return { name: route.name ?? 'play' };
  return null;
}

// The page on screen is taken down while the data changes under it, and put back
// on the new data: pages read theirs as they mount (the tuning setup, the device,
// a MIDI file). On the way out it matters more: a player on it stops (a player
// stops as it unmounts) and a trial ends before the real outputs come back.
watch(() => tour.active, async (on) => {
  if (on) {
    index.value = 0;
    pending.value = true;
    tour.swapping = true;
    try {
      await nextTick();
      enterDemo(locale.value);
    } finally {
      tour.swapping = false;
    }
    await nextTick();
    if (!tour.active) return;
    acted.clear();
    ro = 'ResizeObserver' in window ? new ResizeObserver(remeasure) : null;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', remeasure);
    document.addEventListener('scroll', remeasure, true);
    show(0);
  } else {
    showSeq++;
    clearTimeout(untilTimer);
    ready.value = true;
    cursor.shown = false;
    cursor.pressing = false;
    ro?.disconnect();
    ro = null;
    target = null;
    rect.value = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', remeasure);
    document.removeEventListener('scroll', remeasure, true);
    // a page's tour brings the user back where it started
    const dest = tour.origin ?? afterDemo();
    tour.origin = null;
    tour.swapping = true;
    try {
      await nextTick();
      exitDemo();
      if (dest) await router.replace(dest).catch(() => {});
    } finally {
      tour.swapping = false;
    }
  }
});
onBeforeUnmount(() => stopTour());
</script>

<template>
  <Teleport to="body">
    <div v-if="tour.active" class="tour">
      <!-- catches every click: the tour is read, not clicked through -->
      <div class="tour__block" :class="{ 'is-dim': !rect }"></div>
      <div v-if="rect" class="tour__hole" :style="holeStyle"></div>
      <Transition name="tour-phone">
        <fake-phone v-if="step.phone && phoneView.step !== 'off'" @move="remeasure" />
      </Transition>
      <div class="tour__cursor" :class="{ 'is-shown': cursor.shown, 'is-pressing': cursor.pressing }"
        :style="{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }" aria-hidden="true">
        <span class="tour__ripple"></span><i class="fas fa-arrow-pointer"></i>
      </div>
      <section ref="cardEl" class="tour__card" :class="{ 'is-free': !cardPos, 'is-pending': pending }" :style="cardStyle"
        role="dialog"
        aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
        <header class="tour__band">
          <div class="tour__band-top">
            <span class="tour__eyebrow"><i class="fas" :class="TOUR_ICONS[tour.id]"></i>{{ $t(`tour.names.${tour.id}`) }}</span>
            <span class="tour__count">{{ $t('tour.stepOf', { n: index + 1, total: steps.length }) }}</span>
            <button class="tour__x" type="button" :title="$t('tour.skip')" :aria-label="$t('tour.skip')" @click="finish">
              <i class="fas fa-xmark"></i>
            </button>
          </div>
          <h2 id="tour-title" class="tour__title"><i class="fas" :class="step.icon"></i><span>{{
            $t(`tour.steps.${step.id}.title`) }}</span></h2>
          <div class="tour__progress"><span :style="{ width: `${progress}%` }"></span></div>
        </header>
        <div id="tour-body" class="tour__body">
          <p class="tour__lead"><tour-rich :text="$t(`tour.steps.${step.id}.text`)" /></p>
          <ul v-if="step.points?.length" class="tour__points" :class="{ 'is-tiles': step.tiles }">
            <li v-for="(icon, i) in step.points" :key="i">
              <i class="fas" :class="icon"></i><span><tour-rich :text="$t(`tour.steps.${step.id}.points.${i}`)" /></span>
            </li>
          </ul>
          <p v-if="step.note" class="tour__note" :class="`is-${step.note}`">
            <i class="fas" :class="step.noteIcon ?? NOTE_ICONS[step.note]"></i><span><tour-rich
                :text="$t(`tour.steps.${step.id}.note`)" /></span>
          </p>
        </div>
        <footer class="tour__foot">
          <button v-if="!isLast" class="tour__skip" type="button" @click="finish">{{ $t('tour.skip') }}</button>
          <span class="tour__keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd></span>
          <span class="tour__nav">
            <button v-if="index > 0" class="btn" type="button" @click="prev">{{ $t('tour.prev') }}</button>
            <button class="btn btn--volt" type="button" data-primary :disabled="!ready" @click="next">
              <span v-if="!ready" class="icon"><i class="fas fa-spinner fa-spin"></i></span>
              {{ isLast ? $t('tour.finish') : $t('tour.next') }}
            </button>
          </span>
        </footer>
      </section>
    </div>

  </Teleport>
  <welcome-dialog v-if="!tour.active" />
</template>
