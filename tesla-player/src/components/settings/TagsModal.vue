<script setup lang="ts">
import { reactive, watch } from 'vue';
import { DEFAULT_TAG_COLOR, type AppTag } from '@/types/domain';
import BaseModal from '@/components/ui/BaseModal.vue';

/** The tags that sort the songs (the sidebar's ⋯ menu opens it): names and colours. */
const props = defineProps<{ open: boolean; tags: AppTag[] }>();
const emit = defineEmits<{
  (e: 'save', tags: AppTag[]): void;
  (e: 'close'): void;
}>();

const draft = reactive<{ tags: AppTag[] }>({ tags: [] });

watch(
  () => props.open,
  (open) => {
    if (open) draft.tags = props.tags.map((t) => ({ ...t }));
  },
  { immediate: true },
);

function addTag(): void {
  draft.tags.push({ name: '', color: DEFAULT_TAG_COLOR });
}

function removeTag(index: number): void {
  draft.tags.splice(index, 1);
}

function save(): void {
  // Blank rows are the "add" button's leftovers, not tags to create.
  emit('save', draft.tags
    .map((t) => ({ ...t, name: t.name.trim() }))
    .filter((t) => t.name !== ''));
}
</script>

<template>
  <BaseModal :open="open" :title="$t('label.tags')" icon="fa-tags" card-class="cfg-modal"
    :close-label="$t('label.cancel')" @close="emit('close')">
    <div class="cfg-modal__body">
      <div class="cfg-names">
        <div v-if="draft.tags.length === 0" class="cfg-empty-tags">
          {{ $t('label.noTagAvailable') }}
        </div>

        <div v-for="(tag, i) in draft.tags" :key="tag.id ?? i" class="cfg-name-row">
          <input class="cfg-tag-color" type="color" v-model="tag.color" :title="$t('label.tagColor')">
          <input class="text-field" type="text" v-model="tag.name" :placeholder="$t('label.tagName')" maxlength="24">
          <button class="cfg-tag-del" type="button" :title="$t('label.delete')" :aria-label="$t('label.delete')"
            @click="removeTag(i)">
            <i class="fas fa-trash"></i>
          </button>
        </div>

        <button class="btn btn--ghost cfg-add-tag" type="button" @click="addTag">
          <i class="fas fa-plus"></i> {{ $t('label.addTag') }}
        </button>
      </div>
    </div>

    <template #actions>
      <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
      <button class="btn btn--volt" type="button" @click="save">{{ $t('label.save') }}</button>
    </template>
  </BaseModal>
</template>
