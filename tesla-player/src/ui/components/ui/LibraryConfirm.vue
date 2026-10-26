<script setup lang="ts">
/**
 * The question above a library's table before a delete: « name » ? with Confirm
 * and Cancel, or `message` for several at once. A strip, not a modal: the MIDI
 * library may already be one.
 */
defineProps<{ name?: string; message?: string }>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();
</script>

<template>
  <div class="lib__msg is-confirm" role="alert">
    <span class="lib__confirm-text">
      <i class="fas fa-triangle-exclamation"></i>
      <template v-if="message">{{ message }}</template>
      <template v-else>{{ $t('label.deleteQuestion') }} « {{ name }} » ?</template>
    </span>
    <span class="lib__confirm-actions">
      <button class="btn btn--danger" type="button" @click="emit('confirm')">{{ $t('label.confirm') }}</button>
      <button class="btn btn--ghost" type="button" @click="emit('cancel')">{{ $t('label.cancel') }}</button>
    </span>
  </div>
</template>
