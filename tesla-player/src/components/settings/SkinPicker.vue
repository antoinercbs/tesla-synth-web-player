<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import { SKINS, currentSkin, setSkin, type SkinId } from '@/ui/skins';

/** The look switch (sidebar menu): type, shape, depth, and a skin's own chrome; remembered per device. */
const { t } = useI18n();
const options = computed(() => SKINS.map((id) => ({ value: id, label: t(`skin.${id}`) })));
</script>

<template>
  <segmented-control :model-value="currentSkin" :options="options" :aria-label="$t('skin.title')"
    @update:model-value="(v) => setSkin(v as SkinId)" />
</template>
