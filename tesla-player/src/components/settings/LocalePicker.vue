<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

/** The EN / FR switch (sidebar menu and the welcome dialog); remembered per device. */
const { locale, availableLocales } = useI18n({ useScope: 'global' });
const options = computed(() => availableLocales.map((l) => ({ value: l, label: l.toUpperCase() })));

function setLocale(l: string): void {
  locale.value = l;
  try {
    localStorage.setItem('locale', l);
  } catch {
    /* storage blocked: the language still applies for this visit */
  }
}
</script>

<template>
  <segmented-control :model-value="locale" :options="options" :aria-label="$t('label.language')"
    @update:model-value="setLocale" />
</template>
