<script setup lang="ts">
import BaseModal from './ui/BaseModal.vue';

defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'close'): void }>();
</script>

<template>
  <BaseModal :open="open" :title="title" icon="fa-triangle-exclamation"
    card-class="modal-card--confirm" :close-label="cancelLabel" @close="emit('close')">
    <p class="confirm-modal__msg">{{ message }}</p>
    <template #actions>
      <button class="btn btn--ghost" type="button" @click="emit('close')">{{ cancelLabel }}</button>
      <button class="btn btn--danger" type="button" @click="emit('confirm')">{{ confirmLabel }}</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.confirm-modal__msg { color: var(--text-dim); margin: 0 0 1.4rem; line-height: 1.5; }
</style>
