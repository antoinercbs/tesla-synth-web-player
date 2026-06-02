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
    <input class="text-field" :type="type" v-model="model" :placeholder="placeholder"
      :autocomplete="autocomplete" />
    <span v-if="hint" class="form-field__hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.form-field { display: block; }
/* the mono label variant the config/server modals used (the global .field-label
   is the editor's display variant — don't inherit that here). */
.field-label {
  font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--text-mute);
}
.form-field .text-field { width: 100%; margin-top: 0.3rem; }
.form-field__hint {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.74rem;
  color: var(--text-mute);
}
</style>
