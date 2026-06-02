<script setup lang="ts" generic="T extends string | number">
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
withDefaults(
  defineProps<{
    options: SegmentedOption<T>[];
    fill?: boolean; // .segmented--fill (stretch to full width)
    ariaLabel?: string;
    ariaLabelledby?: string;
    labelClass?: string; // wrap the label (e.g. PlayView's responsive mode-switch__label)
    pressed?: boolean; // expose aria-pressed on each button (toggle semantics)
  }>(),
  { fill: false, ariaLabel: '', ariaLabelledby: '', labelClass: '', pressed: false },
);
</script>

<template>
  <div class="segmented" :class="{ 'segmented--fill': fill }" role="group"
    :aria-label="ariaLabel || undefined" :aria-labelledby="ariaLabelledby || undefined">
    <button v-for="o in options" :key="String(o.value)" type="button"
      :class="{ 'is-active': model === o.value }" :disabled="o.disabled" :title="o.title || undefined"
      :aria-pressed="pressed ? model === o.value : undefined" @click="model = o.value">
      <span v-if="o.icon" class="icon"><i class="fas" :class="o.icon"></i></span>
      <span v-if="o.label != null && labelClass" :class="labelClass">{{ o.label }}</span>
      <template v-else-if="o.label != null">{{ o.label }}</template>
    </button>
  </div>
</template>
