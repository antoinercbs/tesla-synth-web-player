<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  MIDI_NOTE_COUNT,
  clampStart,
  endNote,
  fitOctaves,
  keyboardLayout,
  noteName,
} from '@/ui/piano-layout';

/**
 * On-screen piano. Whole octaves (+ closing C) sized to the available width;
 * every key lights up in the colour the parent gives it (`colorOf`) while
 * `held[note]` is non-zero — so the same keyboard MONITORS what reaches the
 * coils and, when `interactive`, PLAYS: pointer (mouse / multi-touch, with
 * glissando) and the computer keyboard (DAW-style letter rows, ← → = octave)
 * emit noteOn/noteOff. The parent owns the MIDI side (channel, velocity, sends).
 *
 * `held` is the parent's reactive 128-slot array (per-note channel bitmask);
 * reading it here keeps the keys reactive without copying it each frame.
 */
const props = withDefaults(defineProps<{
  held: number[];
  /** Fill (colour or gradient) of a lit key. Only called for held notes. */
  colorOf: (note: number) => string;
  /** Keys send noteOn/noteOff when true; display-only otherwise. */
  interactive?: boolean;
  /** Minimum white-key width (px) — drives how many octaves fit. */
  minKeyPx?: number;
}>(), { interactive: false, minKeyPx: 26 });
const startNote = defineModel<number>('startNote', { default: 36 });
const emit = defineEmits<{
  (e: 'noteOn', note: number): void;
  (e: 'noteOff', note: number): void;
}>();

/* ------------------------------- geometry --------------------------------- */
const keysEl = ref<HTMLElement | null>(null);
const widthPx = ref(0);
let ro: ResizeObserver | null = null;

const octaves = computed(() => fitOctaves(widthPx.value, props.minKeyPx));
const start = computed(() => clampStart(startNote.value, octaves.value));
const end = computed(() => endNote(start.value, octaves.value));
const layout = computed(() => keyboardLayout(start.value, octaves.value));
const whitePx = computed(() => (layout.value.whiteCount ? widthPx.value / layout.value.whiteCount : 0));
const rangeLabel = computed(() => `${noteName(start.value)} – ${noteName(end.value)}`);
// keep the persisted model snapped/clamped once the octave count is known
watch(start, (s) => { if (s !== startNote.value) startNote.value = s; });

const canDown = computed(() => start.value > 0);
const canUp = computed(() => clampStart(start.value + 12, octaves.value) > start.value);
function shift(dir: -1 | 1): void {
  startNote.value = clampStart(start.value + 12 * dir, octaves.value);
}
// held notes outside the visible window (shown as badges on the octave buttons)
const belowCount = computed(() => {
  let n = 0;
  for (let i = 0; i < start.value; i++) if (props.held[i]) n++;
  return n;
});
const aboveCount = computed(() => {
  let n = 0;
  for (let i = end.value + 1; i < MIDI_NOTE_COUNT; i++) if (props.held[i]) n++;
  return n;
});

/* ----------------------- press/release bookkeeping ------------------------ */
// a note may be held by several sources at once (two fingers, key + mouse):
// emit noteOn on the first press and noteOff on the last release only.
const pressCount = new Map<number, number>();
function press(note: number): void {
  const c = pressCount.get(note) ?? 0;
  pressCount.set(note, c + 1);
  if (c === 0) emit('noteOn', note);
}
function release(note: number): void {
  const c = pressCount.get(note) ?? 0;
  if (c <= 1) { pressCount.delete(note); if (c === 1) emit('noteOff', note); }
  else pressCount.set(note, c - 1);
}
function releaseAll(): void {
  for (const note of [...pressCount.keys()]) { pressCount.set(note, 1); release(note); }
  pointerNotes.clear();
  kbNotes.clear();
}

/* ------------------------------- pointer ---------------------------------- */
const NO_KEY = -1;
const pointerNotes = new Map<number, number>(); // pointerId → note (NO_KEY = captured, off the keys)
function noteAt(e: PointerEvent): number {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const key = el?.closest<HTMLElement>('[data-note]');
  if (!key || !keysEl.value?.contains(key)) return NO_KEY;
  return Number(key.dataset.note);
}
function onPointerDown(e: PointerEvent): void {
  if (!props.interactive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const note = noteAt(e);
  if (note === NO_KEY) return;
  e.preventDefault();
  try { keysEl.value?.setPointerCapture(e.pointerId); } catch { /* synthetic/foreign pointer: no capture */ }
  pointerNotes.set(e.pointerId, note);
  press(note);
}
function onPointerMove(e: PointerEvent): void {
  const cur = pointerNotes.get(e.pointerId);
  if (cur === undefined) return;
  const note = noteAt(e);
  if (note === cur) return;
  if (cur !== NO_KEY) release(cur);
  pointerNotes.set(e.pointerId, note); // glissando: slide onto the next key
  if (note !== NO_KEY) press(note);
}
function onPointerEnd(e: PointerEvent): void {
  const cur = pointerNotes.get(e.pointerId);
  if (cur === undefined) return;
  pointerNotes.delete(e.pointerId);
  if (cur !== NO_KEY) release(cur);
}

/* --------------------------- computer keyboard ---------------------------- */
// physical key codes (layout-independent): the classic two-row DAW mapping,
// A/W/S/E/D… = C/C#/D/D#/E… from `kbBase`. Labels come from the real layout.
const KEY_SEMITONES: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8,
  KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const kbNotes = new Map<string, number>(); // code → note
// the letter rows cover 1½ octaves — anchor them on the middle of the window
const kbBase = computed(() => start.value + 12 * Math.floor((octaves.value - 1) / 2));
const kbLabels = ref(new Map<number, string>()); // semitone offset → key cap label
function kbLabel(note: number): string {
  if (!props.interactive || kbLabels.value.size === 0) return '';
  return kbLabels.value.get(note - kbBase.value) ?? '';
}
function inFormField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
function onKeyDown(e: KeyboardEvent): void {
  if (!props.interactive || e.ctrlKey || e.metaKey || e.altKey || inFormField(e)) return;
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    if (!e.repeat) shift(e.code === 'ArrowLeft' ? -1 : 1);
    e.preventDefault();
    return;
  }
  const semi = KEY_SEMITONES[e.code];
  if (semi === undefined) return;
  e.preventDefault();
  if (e.repeat || kbNotes.has(e.code)) return;
  const note = kbBase.value + semi;
  if (note >= MIDI_NOTE_COUNT) return;
  kbNotes.set(e.code, note);
  press(note);
}
function onKeyUp(e: KeyboardEvent): void {
  const note = kbNotes.get(e.code);
  if (note === undefined) return;
  kbNotes.delete(e.code);
  release(note);
}
function onBlur(): void { releaseAll(); }

interface KeyboardLayoutMapLike { get(code: string): string | undefined }
interface NavigatorKeyboard { keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMapLike> } }

onMounted(async () => {
  if (keysEl.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => { widthPx.value = entries[0].contentRect.width; });
    ro.observe(keysEl.value);
    widthPx.value = keysEl.value.clientWidth;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  // key-cap labels for the letter rows (Chromium desktop only; silently absent elsewhere)
  try {
    const map = await (navigator as NavigatorKeyboard).keyboard?.getLayoutMap?.();
    if (map) {
      const out = new Map<number, string>();
      for (const [code, semi] of Object.entries(KEY_SEMITONES)) {
        const cap = map.get(code);
        if (cap) out.set(semi, cap.toUpperCase());
      }
      kbLabels.value = out;
    }
  } catch { /* no layout map → no labels */ }
});
onBeforeUnmount(() => {
  releaseAll();
  ro?.disconnect();
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
});
// leaving Play mode (or the session stopping) lets go of everything still held
watch(() => props.interactive, (on) => { if (!on) releaseAll(); });
</script>

<template>
  <div class="piano">
    <div class="piano__bar">
      <slot name="toolbar" />
      <div class="piano__nav">
        <button type="button" class="piano__oct" :disabled="!canDown" :title="$t('label.octaveDown')"
          :aria-label="$t('label.octaveDown')" @click="shift(-1)">
          <i class="fas fa-chevron-left"></i>
          <span v-if="belowCount" class="piano__off">{{ belowCount }}</span>
        </button>
        <span class="piano__range">{{ rangeLabel }}</span>
        <button type="button" class="piano__oct" :disabled="!canUp" :title="$t('label.octaveUp')"
          :aria-label="$t('label.octaveUp')" @click="shift(1)">
          <i class="fas fa-chevron-right"></i>
          <span v-if="aboveCount" class="piano__off">{{ aboveCount }}</span>
        </button>
      </div>
    </div>

    <div class="piano__body">
      <div ref="keysEl" class="piano__keys" :class="{
        'is-interactive': interactive,
        'is-dense': whitePx > 0 && whitePx < 30,
        'is-tiny': whitePx > 0 && whitePx < 21,
      }" role="img" :aria-label="rangeLabel" @pointerdown="onPointerDown" @pointermove="onPointerMove"
        @pointerup="onPointerEnd" @pointercancel="onPointerEnd" @lostpointercapture="onPointerEnd"
        @contextmenu.prevent>
        <div v-for="k in layout.whites" :key="k.note" class="pkey pkey--white" :class="{ 'is-on': held[k.note] !== 0 }"
          :data-note="k.note" :style="held[k.note] ? { '--k': colorOf(k.note) } : undefined">
          <span v-if="kbLabel(k.note)" class="pkey__kb">{{ kbLabel(k.note) }}</span>
          <span v-if="k.note % 12 === 0" class="pkey__name">{{ noteName(k.note) }}</span>
        </div>
        <div v-for="k in layout.blacks" :key="k.note" class="pkey pkey--black" :class="{ 'is-on': held[k.note] !== 0 }"
          :data-note="k.note" :style="{
            left: k.left + '%', width: k.width + '%',
            ...(held[k.note] ? { '--k': colorOf(k.note) } : {}),
          }">
          <span v-if="kbLabel(k.note)" class="pkey__kb">{{ kbLabel(k.note) }}</span>
        </div>
      </div>
      <slot name="overlay" />
    </div>
  </div>
</template>

<style scoped>
.piano {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.piano__bar {
  display: flex;
  align-items: center;
  gap: 0.6rem 1rem;
  flex-wrap: wrap;
}

.piano__nav {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
}

.piano__oct {
  position: relative;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 7px;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line-strong);
  color: var(--text-dim);
  font-size: 0.7rem;
  transition: 0.13s;
}

.piano__oct:hover:not(:disabled) {
  color: var(--volt);
  border-color: var(--volt);
}

.piano__oct:disabled {
  opacity: 0.35;
  cursor: default;
}

.piano__oct:focus-visible {
  outline: 2px solid var(--volt);
  outline-offset: 2px;
}

/* "n notes held beyond this edge" badge */
.piano__off {
  position: absolute;
  top: -0.45rem;
  right: -0.45rem;
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 0.25rem;
  border-radius: var(--radius-pill);
  display: grid;
  place-items: center;
  background: var(--volt);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  font-weight: 700;
  box-shadow: 0 0 8px -2px var(--volt);
}

.piano__range {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--text-dim);
  min-width: 5.6rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.piano__body {
  position: relative;
}

/* the keybed: a dark chassis with the keys inset */
.piano__keys {
  position: relative;
  display: flex;
  height: clamp(130px, 24vh, 210px);
  padding: 0 0 5px;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(180deg, #05080d, #0a0f16);
  border: 1px solid var(--line-strong);
  box-shadow:
    inset 0 8px 16px -10px rgba(0, 0, 0, 0.95),
    inset 0 -1px 0 rgba(255, 255, 255, 0.04);
  user-select: none;
  -webkit-user-select: none;
}

.piano__keys.is-interactive {
  touch-action: none;
}

.pkey {
  position: relative;
  box-sizing: border-box;
  transition:
    background 0.06s ease-out,
    box-shadow 0.12s ease-out;
}

.pkey--white {
  flex: 1 1 0;
  min-width: 0;
  background: linear-gradient(180deg, #dce4ee 0%, #c6d1dd 72%, #b1bfcd 100%);
  border-right: 1px solid rgba(5, 8, 13, 0.7);
  border-radius: 0 0 4px 4px;
  box-shadow: inset 0 -7px 0 rgba(5, 8, 13, 0.14);
}

.pkey--white:last-child {
  border-right: 0;
}

.pkey--black {
  position: absolute;
  top: 0;
  height: 62%;
  z-index: 2;
  background: linear-gradient(180deg, #1c2532 0%, #0b1017 80%, #060a10 100%);
  border: 1px solid rgba(3, 5, 9, 0.95);
  border-top: 0;
  border-radius: 0 0 4px 4px;
  box-shadow:
    0 4px 7px rgba(0, 0, 0, 0.65),
    inset 0 -5px 0 rgba(255, 255, 255, 0.045),
    inset 1px 0 0 rgba(255, 255, 255, 0.05);
}

/* lit = the coil colour(s) of the channel(s) holding the note */
.pkey.is-on {
  background: var(--k, var(--volt));
  box-shadow:
    0 0 16px -2px var(--volt-50),
    inset 0 0 0 1px rgba(255, 255, 255, 0.28),
    inset 0 -7px 0 rgba(5, 8, 13, 0.2);
}

.pkey--black.is-on {
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.3),
    inset 0 -5px 0 rgba(5, 8, 13, 0.25);
}

/* only a playable keyboard invites the hand */
.piano__keys.is-interactive .pkey {
  cursor: pointer;
}

@media (hover: hover) {
  .piano__keys.is-interactive .pkey--white:not(.is-on):hover {
    background: linear-gradient(180deg, #eaf0f6 0%, #d5dee8 72%, #c0ccd9 100%);
  }

  .piano__keys.is-interactive .pkey--black:not(.is-on):hover {
    background: linear-gradient(180deg, #2a3545 0%, #141b25 80%, #0a0f16 100%);
  }
}

/* C labels at the foot of the white keys */
.pkey__name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.45rem;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  color: rgba(5, 8, 13, 0.5);
  pointer-events: none;
}

.pkey.is-on .pkey__name {
  color: var(--ink);
}

/* computer-keyboard key caps */
.pkey__kb {
  position: absolute;
  left: 50%;
  bottom: 1.45rem;
  transform: translateX(-50%);
  padding: 0 0.24rem;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  font-weight: 600;
  line-height: 1.35;
  color: rgba(5, 8, 13, 0.5);
  border: 1px solid rgba(5, 8, 13, 0.28);
  pointer-events: none;
}

.pkey--black .pkey__kb {
  bottom: 0.45rem;
  color: rgba(205, 217, 230, 0.6);
  border-color: rgba(205, 217, 230, 0.28);
}

.pkey.is-on .pkey__kb {
  color: var(--ink);
  border-color: rgba(5, 8, 13, 0.4);
}

/* narrow keys: drop the key caps, then the C names */
.piano__keys.is-dense .pkey__kb {
  display: none;
}

.piano__keys.is-tiny .pkey__name {
  display: none;
}
</style>
