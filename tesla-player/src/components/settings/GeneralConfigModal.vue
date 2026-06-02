<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { coilColor } from '@/ui/coil-colors';
import { MAX_COILS, MIN_COILS, type AppConfig } from '@/types/domain';
import BaseModal from '@/components/ui/BaseModal.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

const props = defineProps<{ open: boolean; config: AppConfig }>();
const emit = defineEmits<{ (e: 'save', config: AppConfig): void; (e: 'close'): void }>();

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

const shownCount = computed(() => draft.defaultCoilCount);
</script>

<template>
  <BaseModal :open="open" :title="$t('title.generalConfig')" icon="fa-gear" card-class="cfg-modal"
    :close-label="$t('label.cancel')" @close="emit('close')">
    <div class="cfg-modal__body">
      <div class="cfg-field">
        <span class="field-label">{{ $t('label.defaultCoilCount') }}</span>
        <segmented-control v-model="draft.defaultCoilCount" :options="coilCountOptions" fill />
      </div>

      <div class="cfg-field">
        <span class="field-label">{{ $t('label.coilNames') }}</span>
        <div class="cfg-names">
          <div v-for="i in shownCount" :key="i - 1" class="cfg-name-row">
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

<style scoped>
.cfg-modal__body { display: flex; flex-direction: column; align-items: stretch; gap: 1.3rem; }
.cfg-field { display: flex; flex-direction: column; align-items: stretch; gap: 0.55rem; }
.field-label {
  align-self: flex-start; text-align: left;
  font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--text-mute);
}
.cfg-names { display: flex; flex-direction: column; gap: 0.5rem; }
.cfg-name-row { display: flex; align-items: center; gap: 0.6rem; }
.cfg-name-dot {
  width: 0.7rem; height: 0.7rem; border-radius: 50%; flex: 0 0 auto;
  background: var(--c); box-shadow: 0 0 8px -1px var(--c);
}
.cfg-name-idx { font-family: var(--font-mono); color: var(--text-mute); width: 1rem; text-align: center; flex: 0 0 auto; }
.cfg-name-row .text-field { flex: 1 1 auto; min-width: 0; }
</style>
