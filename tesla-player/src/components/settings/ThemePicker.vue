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
