<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('cancel')">
      <div class="modal-card modal-card--confirm">
        <div class="modal-card__head">
          <span class="modal-card__title">
            <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ title }}
          </span>
          <button class="icon-btn" type="button" :aria-label="cancelLabel" @click="emit('cancel')">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
        <p class="confirm-modal__msg">{{ message }}</p>
        <div class="confirm-modal__actions">
          <button class="btn btn--ghost" type="button" @click="emit('cancel')">{{ cancelLabel }}</button>
          <button class="btn btn--danger" type="button" @click="emit('confirm')">{{ confirmLabel }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-card--confirm { max-width: 440px; }
.modal-card--confirm .modal-card__title .icon { color: var(--danger); }
.confirm-modal__msg { color: var(--text-dim); margin: 0 0 1.4rem; line-height: 1.5; }
.confirm-modal__actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
</style>
