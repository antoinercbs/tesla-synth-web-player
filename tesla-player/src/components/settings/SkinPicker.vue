<script setup lang="ts">
import { SKINS, currentSkin, setSkin, type SkinId } from '@/ui/skins';

/** The look switch (sidebar menu): type, shape, depth, and a skin's own chrome; remembered per device. */
function onChange(e: Event): void {
  setSkin((e.target as HTMLSelectElement).value as SkinId);
}
</script>

<template>
  <span class="select-field">
    <select :value="currentSkin" :aria-label="$t('skin.title')" @change="onChange">
      <option v-for="id in SKINS" :key="id" :value="id">{{ $t(`skin.${id}`) }}</option>
    </select>
  </span>
</template>
