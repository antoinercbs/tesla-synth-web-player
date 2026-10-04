<script setup lang="ts">
import { reactive, watch } from 'vue';
import { coilColor } from '@/ui/coil-colors';
import { MAX_COILS, MIN_COILS, type AppConfig } from '@/types/domain';
import BaseModal from '@/components/ui/BaseModal.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import { ICONS } from '@/ui/icons';

/** The installation's coils (the sidebar's coil list opens it): how many, and their names. */
const props = defineProps<{ open: boolean; config: AppConfig }>();
const emit = defineEmits<{
  (e: 'save', config: AppConfig): void;
  (e: 'close'): void;
}>();

// Names are kept for all MAX_COILS slots so they survive count changes; only the
// first `defaultCoilCount` are shown/edited.
const draft = reactive<{ coilNames: string[]; defaultCoilCount: number }>({
  coilNames: Array(MAX_COILS).fill(''),
  defaultCoilCount: 3,
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    draft.coilNames = Array.from({ length: MAX_COILS }, (_, i) => props.config.coilNames[i] ?? '');
    draft.defaultCoilCount = Math.min(MAX_COILS, Math.max(MIN_COILS, props.config.defaultCoilCount || 3));
  },
  { immediate: true },
);

const coilCountOptions = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => ({
  value: MIN_COILS + i,
  label: String(MIN_COILS + i),
}));

function save(): void {
  emit('save', {
    coilNames: draft.coilNames.map((n) => (n ?? '').trim()),
    defaultCoilCount: draft.defaultCoilCount,
  });
}
</script>

<template>
  <BaseModal :open="open" :title="$t('title.coils')" :icon="ICONS.coil" card-class="cfg-modal"
    :close-label="$t('label.cancel')" @close="emit('close')">
    <div class="cfg-modal__body">
      <div class="cfg-field">
        <span class="field-label">{{ $t('label.defaultCoilCount') }}</span>
        <segmented-control v-model="draft.defaultCoilCount" :options="coilCountOptions" fill />
      </div>

      <div class="cfg-field">
        <span class="field-label">{{ $t('label.coilNames') }}</span>
        <div class="cfg-names">
          <div v-for="i in draft.defaultCoilCount" :key="i - 1" class="cfg-name-row">
            <span class="cfg-name-dot" :style="{ '--c': coilColor(i - 1) }"></span>
            <span class="cfg-name-idx">{{ i - 1 }}</span>
            <input class="text-field" type="text" v-model="draft.coilNames[i - 1]"
              :placeholder="$t('label.coilNamePlaceholder', { n: i - 1 })" maxlength="24">
          </div>
        </div>
      </div>
    </div>

    <template #actions>
      <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
      <button class="btn btn--volt" type="button" @click="save">{{ $t('label.save') }}</button>
    </template>
  </BaseModal>
</template>
