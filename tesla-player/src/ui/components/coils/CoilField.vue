<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * A number of the coil sheet, in the unit it is read in (µH, kHz, mm…): the
 * sheet keeps SI, `factor` turns it into the shown unit. An optional one left
 * empty shows what the model computes in its place, or what stands for it
 * (`emptyText`: the board's own default, « auto »).
 */
const props = withDefaults(defineProps<{
  label: string;
  modelValue: number | undefined;
  unit: string;
  factor?: number;
  digits?: number;
  optional?: boolean;
  /** The value the model uses when this one is empty (SI). */
  computedValue?: number;
  min?: number;
  max?: number;
  hint?: string;
  /** What an empty optional one stands for, when the model computes nothing in its place. */
  emptyText?: string;
}>(), { factor: 1, digits: 2, optional: false, computedValue: undefined, min: undefined, max: undefined, hint: undefined, emptyText: undefined });
const emit = defineEmits<{ (e: 'update:modelValue', v: number | undefined): void }>();
const { locale } = useI18n();

const fmt = (v: number | undefined) => (v == null || !Number.isFinite(v) ? ''
  : (v * props.factor).toLocaleString(locale.value, { maximumFractionDigits: props.digits, useGrouping: false }));
const text = ref(fmt(props.modelValue));
const focused = ref(false);
watch(() => props.modelValue, (v) => { if (!focused.value) text.value = fmt(v); });

const parsed = computed<number | undefined | null>(() => {
  const s = text.value.trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v / props.factor : null;
});
const invalid = computed(() => {
  const v = parsed.value;
  if (v === undefined) return !props.optional;
  if (v === null) return true;
  const shown = v * props.factor;
  return (props.min != null && shown < props.min) || (props.max != null && shown > props.max);
});

function onInput(e: Event): void {
  text.value = (e.target as HTMLInputElement).value;
  if (!invalid.value) emit('update:modelValue', parsed.value ?? undefined);
}
function onBlur(): void {
  focused.value = false;
  if (!invalid.value) text.value = fmt(props.modelValue);
}
</script>

<template>
  <label class="coil-field" :class="{ 'is-invalid': invalid }" :title="hint">
    <span class="coil-field__label">{{ label }}</span>
    <span class="coil-field__box">
      <input class="coil-field__input" type="text" inputmode="decimal" :value="text"
        :placeholder="computedValue != null ? fmt(computedValue) : emptyText ?? ''" :aria-invalid="invalid" @focus="focused = true"
        @input="onInput" @blur="onBlur">
      <span class="coil-field__unit">{{ unit }}</span>
    </span>
  </label>
</template>
