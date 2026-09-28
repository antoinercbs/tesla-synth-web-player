<script setup lang="ts">
import { computed } from 'vue';
import { THEMES, currentTheme, setTheme, type ThemeId } from '@/ui/themes';
import { currentSkin } from '@/ui/skins';

/**
 * The current look's palettes as swatches, with the current one's name (sidebar
 * menu and the welcome dialog). Each swatch carries its palette's data-theme, so
 * it paints with that palette's own colours (--swatch, else its gradient).
 */
const themes = computed<readonly ThemeId[]>(() => THEMES[currentSkin.value]);
</script>

<template>
  <div class="theme-picker">
    <span class="theme-picker__head">{{ $t('theme.title') }}<b>{{ $t(`theme.${currentTheme}`) }}</b></span>
    <div class="theme-picker__swatches" role="radiogroup" :aria-label="$t('theme.title')">
      <button v-for="id in themes" :key="id" type="button" class="theme-swatch"
        :class="{ 'is-active': currentTheme === id }" :data-theme="id" role="radio" :aria-checked="currentTheme === id"
        :title="$t(`theme.${id}`)" :aria-label="$t(`theme.${id}`)" @click="setTheme(currentSkin, id)"></button>
    </div>
  </div>
</template>
