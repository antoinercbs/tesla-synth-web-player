<script setup lang="ts" generic="T extends string | number">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * The shared `.segmented` toggle group (mode switch, viz tabs, coil count,
 * sync choice…). v-model holds the selected value; options drive the buttons.
 */
export interface SegmentedOption<V> {
  value: V;
  label?: string; // already translated
  icon?: string; // FontAwesome class
  disabled?: boolean;
  title?: string;
}

const model = defineModel<T>({ required: true });
const props = withDefaults(
  defineProps<{
    options: SegmentedOption<T>[];
    fill?: boolean; // .segmented--fill (stretch to full width)
    ariaLabel?: string;
    ariaLabelledby?: string;
    labelClass?: string; // wrap the label (e.g. PlayView's responsive mode-switch__label)
    pressed?: boolean; // expose aria-pressed on each button (toggle semantics)
    tabs?: boolean; // .segmented--tabs: switches content (underlined tabs), not a mode/value
  }>(),
  { fill: false, ariaLabel: '', ariaLabelledby: '', labelClass: '', pressed: false, tabs: false },
);

// tabs: one micro-arc that slides under the active tab (measured, since tab widths vary)
const rootEl = ref<HTMLElement | null>(null);
const arc = ref<{ x: number; w: number } | null>(null);
const arcReady = ref(false); // no slide-in from 0 on first paint
function placeArc(): void {
  const root = rootEl.value;
  const btn = root?.querySelector<HTMLElement>('button.is-active');
  if (!root || !btn || !btn.offsetWidth) { arc.value = null; return; }
  // rects, not offsetLeft/Width: those round to whole pixels
  const r = root.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  arc.value = { x: b.left - r.left - root.clientLeft, w: b.width };
}
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!props.tabs || !rootEl.value) return;
  placeArc();
  requestAnimationFrame(() => { arcReady.value = true; });
  // also covers labels dropping out (container query) and web fonts arriving
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(placeArc);
    ro.observe(rootEl.value);
  }
});
watch(model, () => { if (props.tabs) nextTick(placeArc); });
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div ref="rootEl" class="segmented" :class="{ 'segmented--fill': fill, 'segmented--tabs': tabs }" role="group"
    :aria-label="ariaLabel || undefined"
    :aria-labelledby="ariaLabelledby || undefined">
    <button v-for="o in options" :key="String(o.value)" type="button" :class="{ 'is-active': model === o.value }"
      :disabled="o.disabled" :title="o.title || undefined" :aria-pressed="pressed ? model === o.value : undefined"
      @click="model = o.value">
      <span v-if="o.icon" class="icon"><i class="fas" :class="o.icon"></i></span>
      <span v-if="o.label != null && labelClass" :class="labelClass">{{ o.label }}</span>
      <template v-else-if="o.label != null">{{ o.label }}</template>
    </button>
    <span v-if="tabs && arc" class="segmented__arc" :class="{ 'is-ready': arcReady }"
      :style="{ transform: `translateX(${arc.x}px)`, width: `${arc.w}px` }" aria-hidden="true"></span>
  </div>
</template>
