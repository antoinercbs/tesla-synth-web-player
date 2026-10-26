<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import { LOCALES, isLocale, putLocale } from '@/ui/translations/locales';

/** The EN / FR switch (sidebar menu and the welcome dialog); remembered per device. */
const i18n = useI18n({ useScope: 'global' });
const { locale } = i18n;
const options = LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }));

async function setLocale(l: string): Promise<void> {
  if (!isLocale(l)) return;
  await putLocale(i18n, l);
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
