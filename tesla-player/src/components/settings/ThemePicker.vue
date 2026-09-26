<script setup lang="ts">
import { THEMES, currentTheme, setTheme } from '@/ui/themes';

/**
 * The colour-theme swatches, with the current theme's name (sidebar menu and the
 * welcome dialog). Each swatch carries its theme's data-theme, so it paints with
 * that theme's own gradient.
 */
</script>

<template>
  <div class="theme-picker">
    <span class="theme-picker__head">{{ $t('theme.title') }}<b>{{ $t(`theme.${currentTheme}`) }}</b></span>
    <div class="theme-picker__swatches" role="radiogroup" :aria-label="$t('theme.title')">
      <button v-for="id in THEMES" :key="id" type="button" class="theme-swatch"
        :class="{ 'is-active': currentTheme === id }" :data-theme="id" role="radio" :aria-checked="currentTheme === id"
        :title="$t(`theme.${id}`)" :aria-label="$t(`theme.${id}`)" @click="setTheme(id)"></button>
    </div>
  </div>
</template>

<style scoped>
.theme-picker {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.theme-picker__head {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-sm);
  color: var(--text-dim);
}

.theme-picker__head b {
  font-weight: 500;
  color: var(--text);
}

/* two rows of seven; capped so the swatches stay swatch-sized in a wide dialog */
.theme-picker__swatches {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.45rem;
  max-width: 18rem;
}

.theme-swatch {
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--grad);
  cursor: pointer;
  transition: transform 0.12s ease;
}

.theme-swatch:hover {
  transform: scale(1.08);
}

.theme-swatch.is-active {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}
</style>
