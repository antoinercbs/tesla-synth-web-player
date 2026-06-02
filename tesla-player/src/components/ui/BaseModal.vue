<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';

/**
 * The shared modal shell: Teleport + dark overlay + card + head (icon/title/×).
 * Body goes in the default slot, footer buttons in the `actions` slot. Every
 * modal in the app reuses this instead of re-implementing the overlay markup.
 * Dismissal emits `close` (backdrop click, × button, or Esc).
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string; // already translated
    icon?: string; // FontAwesome class, e.g. 'fa-server'
    cardClass?: string; // extra class on .modal-card (width/variant)
    closeLabel?: string; // aria-label for the × button (already translated)
    closeOnEsc?: boolean;
    closeOnBackdrop?: boolean;
  }>(),
  {
    icon: 'fa-circle-info',
    cardClass: '',
    closeLabel: '',
    closeOnEsc: true,
    closeOnBackdrop: true,
  },
);

const emit = defineEmits<{ (e: 'close'): void }>();

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open && props.closeOnEsc) emit('close');
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown);
    else window.removeEventListener('keydown', onKeydown);
  },
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="closeOnBackdrop && emit('close')">
      <div class="modal-card" :class="cardClass">
        <div class="modal-card__head">
          <span class="modal-card__title">
            <span class="icon"><i class="fas" :class="icon"></i></span>{{ title }}
          </span>
          <button class="icon-btn" type="button" :aria-label="closeLabel" @click="emit('close')">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
        <slot></slot>
        <div v-if="$slots.actions" class="modal-card__actions">
          <slot name="actions"></slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* The actions footer was duplicated as 6 identical local classes; it lives here now. */
.modal-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.2rem;
}
</style>
