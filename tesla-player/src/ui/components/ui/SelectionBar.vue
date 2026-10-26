<script setup lang="ts">
/**
 * The bar a library's table shows while rows are ticked (DataTable's
 * `selectable`): how many, what can be done to them (the default slot), and
 * the way out. It sits at the bottom of the library, over the rows.
 */
defineProps<{ count: number; label: string }>();
const emit = defineEmits<{ (e: 'clear'): void }>();
</script>

<template>
  <div class="sel-bar" role="toolbar" :aria-label="label">
    <span class="sel-bar__count">{{ label }}</span>
    <span class="sel-bar__sep" aria-hidden="true"></span>
    <slot></slot>
    <span class="sel-bar__spacer"></span>
    <button class="icon-btn icon-btn--sm" type="button" :title="$t('table.clearSelection')"
      :aria-label="$t('table.clearSelection')" @click="emit('clear')">
      <i class="fas fa-xmark"></i>
    </button>
  </div>
</template>
