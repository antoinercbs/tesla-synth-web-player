<script setup lang="ts">
/**
 * A text field with its magnifier: the libraries' search, the play page's, the
 * playlist editor's. Its tooltip says how utils/search.ts reads a query.
 */
const model = defineModel<string>({ required: true });
defineProps<{ placeholder?: string }>();
</script>

<template>
  <div class="search-field">
    <span class="search-field__icon"><i class="fas fa-search"></i></span>
    <input class="text-field" type="text" v-model="model" :placeholder="placeholder" :aria-label="placeholder"
      :title="$t('label.searchHelp')" />
  </div>
</template>
