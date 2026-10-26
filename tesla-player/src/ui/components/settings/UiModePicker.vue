<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import { uiMode, type UiMode } from '@/ui/helpers/ui-mode';

/** Débutant / Expert (the sidebar menu and the welcome dialog); remembered per device (ui/helpers/ui-mode.ts). */
const { t } = useI18n();
const options = computed(() => [
  { value: 'beginner' as const, label: t('uiMode.beginner'), icon: 'fa-seedling' },
  { value: 'expert' as const, label: t('uiMode.expert'), icon: 'fa-sliders' },
]);
</script>

<template>
  <segmented-control :model-value="uiMode" :options="options" :aria-label="$t('uiMode.title')"
    @update:model-value="uiMode = $event as UiMode" />
</template>
