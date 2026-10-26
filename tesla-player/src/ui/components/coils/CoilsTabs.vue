<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';

/** The Coils page's two tabs, in its head as Lecture's modes are: the coils, and the scenes they are posed in. */
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const tab = computed(() => (route.name === 'coilScenes' ? 'scenes' : 'coils'));
const options = computed(() => [
  { value: 'coils', label: t('coils.tabs.coils'), icon: 'fa-bolt' },
  { value: 'scenes', label: t('coils.tabs.scenes'), icon: 'fa-cubes', title: t('coils.tabs.scenesHint') },
]);
const go = (v: string | number) => { if (v !== tab.value) void router.push({ name: v === 'scenes' ? 'coilScenes' : 'coils' }); };
</script>

<template>
  <segmented-control :model-value="tab" class="mode-switch" label-class="mode-switch__label" :options="options" :aria-label="$t('coils.tabs.label')"
    @update:model-value="go" />
</template>
