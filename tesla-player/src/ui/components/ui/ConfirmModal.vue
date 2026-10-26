<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue';
import BaseModal from '@/ui/components/ui/BaseModal.vue';

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  warn?: boolean; // a delete: the warning triangle before the title
}>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'close'): void }>();

const msgId = `${useId()}-msg`;
const cancelBtn = ref<HTMLButtonElement | null>(null);
// a confirmation that follows another in the same modal (a critical change asks twice)
// starts again on Cancel: Enter must not answer both
watch(() => [props.open, props.title, props.message] as const, ([open], [wasOpen]) => {
  if (open && wasOpen) void nextTick(() => cancelBtn.value?.focus());
});
</script>

<template>
  <BaseModal :open="open" :title="title" :warn="warn" card-class="modal-card--confirm"
    :close-label="cancelLabel" :described-by="msgId" @close="emit('close')">
    <p :id="msgId" class="confirm-modal__msg">{{ message }}</p>
    <template #actions>
      <button ref="cancelBtn" class="btn btn--ghost" type="button" data-autofocus @click="emit('close')">{{ cancelLabel }}</button>
      <button class="btn btn--danger" type="button" @click="emit('confirm')">{{ confirmLabel }}</button>
    </template>
  </BaseModal>
</template>
