<script setup lang="ts">
/**
 * A labelled text input (label + `.text-field` + optional hint), the form-row
 * pattern repeated across the config/server modals. Text-like inputs only;
 * dropdowns keep using `.select-field` / SearchableSelect.
 */
const model = defineModel<string | number | null>();
withDefaults(
  defineProps<{
    label: string; // already translated
    type?: 'text' | 'url' | 'password' | 'number';
    hint?: string; // already translated
    placeholder?: string;
    autocomplete?: string;
  }>(),
  { type: 'text', hint: '', placeholder: '', autocomplete: 'off' },
);
</script>

<template>
  <label class="form-field">
    <span class="field-label">{{ label }}</span>
    <input class="text-field" :type="type" v-model="model" :placeholder="placeholder" :autocomplete="autocomplete" />
    <span v-if="hint" class="form-field__hint">{{ hint }}</span>
  </label>
</template>
