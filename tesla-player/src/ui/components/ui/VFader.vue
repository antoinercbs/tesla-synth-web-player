<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * A vertical fader on a 0–`scale` scale (a power: 0–200): dragged anywhere on
 * it (a finger too), stepped by the arrows and Page keys, back to `home` (100)
 * on a double click. Held under `max` (the ≤ 100 % lock); a notch marks where a
 * coil's bass stops following, or a limit, or several (`marks`, the general
 * Power: one per coil, tagged with its outputs). The fill is the value, or
 * `level` when it differs (a coil's strip: what the coil receives once the
 * general Power multiplies its share). The model streams the drag, `change`
 * fires once it is let go.
 */
export interface FaderMark { at: number; color: string; title: string; tags: { label: string; color: string }[]; ahead: boolean }
const value = defineModel<number>({ required: true });
const props = withDefaults(defineProps<{
  label: string;
  max?: number;
  notch?: number | null;
  notchTitle?: string;
  marks?: FaderMark[];
  /** What the fill shows instead of the value (0–200). */
  level?: number | null;
  levelTitle?: string;
  disabled?: boolean;
  /** The top of the track; `max` defaults to it. */
  scale?: number;
  /** Where a double click brings it back, marked on the track; null: nowhere. */
  home?: number | null;
  /** What a screen reader says of the value; default "<value> %". */
  valueText?: string;
}>(), {
  max: undefined, notch: null, notchTitle: undefined, marks: () => [], level: null, levelTitle: undefined, disabled: false,
  scale: 200, home: 100, valueText: undefined,
});
const emit = defineEmits<{ (e: 'change'): void }>();

// near home on release is home: the song as it was set
const HOME_SNAP = 3;
const track = ref<HTMLElement | null>(null);
const top = computed(() => props.max ?? props.scale);
const clamp = (v: number): number => Math.max(0, Math.min(top.value, Math.round(v)));
function at(e: PointerEvent): number {
  const r = track.value!.getBoundingClientRect();
  return clamp((1 - (e.clientY - r.top) / r.height) * props.scale);
}

let dragging = false;
function down(e: PointerEvent): void {
  if (props.disabled || e.button !== 0) return;
  dragging = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  value.value = at(e);
}
function move(e: PointerEvent): void {
  if (dragging) value.value = at(e);
}
function up(): void {
  if (!dragging) return;
  dragging = false;
  if (props.home != null && Math.abs(value.value - props.home) <= HOME_SNAP && top.value >= props.home) value.value = props.home;
  emit('change');
}
const STEPS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
function key(e: KeyboardEvent): void {
  if (props.disabled) return;
  if (e.key in STEPS) value.value = clamp(value.value + STEPS[e.key]);
  else if (e.key === 'Home') value.value = 0;
  else if (e.key === 'End') value.value = top.value;
  else return;
  e.preventDefault();
  emit('change');
}
function goHome(): void {
  if (props.disabled || props.home == null) return;
  value.value = Math.min(props.home, top.value);
  emit('change');
}
const pct = (v: number): string => `${(Math.min(v, props.scale) / props.scale) * 100}%`;
</script>

<template>
  <div class="vfader" :class="{ 'is-disabled': disabled, 'has-marks': marks.length }" role="slider" :tabindex="disabled ? -1 : 0"
    :aria-label="label" aria-orientation="vertical" aria-valuemin="0" :aria-valuemax="top" :aria-valuenow="value"
    :aria-valuetext="valueText ?? `${value} %`" :aria-disabled="disabled" @pointerdown="down" @pointermove="move" @pointerup="up"
    @pointercancel="up" @keydown="key" @dblclick="goHome">
    <span ref="track" class="vfader__track">
      <span class="vfader__fill" :style="{ height: pct(level ?? value) }"></span>
      <span v-if="level != null && level !== value" class="vfader__level" :style="{ bottom: pct(level) }" :title="levelTitle"></span>
      <span v-if="home != null" class="vfader__mid" :style="{ bottom: pct(home) }"></span>
      <span v-if="notch != null" class="vfader__notch" :class="{ 'is-ahead': (level ?? value) <= notch }" :style="{ bottom: pct(notch) }"
        :title="notchTitle"></span>
      <span v-for="(m, i) in marks" :key="i" class="vfader__notch vfader__mark" :class="{ 'is-ahead': m.ahead }"
        :style="{ bottom: pct(m.at), '--c': m.color }" :title="m.title">
        <span class="vfader__tag"><span v-for="tg in m.tags" :key="tg.label" class="fiber-cap fiber-cap--xs"
            :style="{ '--c': tg.color }"><span class="fiber-cap__n">{{ tg.label }}</span></span></span>
      </span>
      <span class="vfader__thumb" :style="{ bottom: pct(value) }"></span>
    </span>
  </div>
</template>
