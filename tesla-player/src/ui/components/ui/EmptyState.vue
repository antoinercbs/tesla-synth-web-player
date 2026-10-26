<script setup lang="ts">
/**
 * A muted icon + message block. `hint` = the inline `.player-hint` strip;
 * `stub` = a large centred placeholder for an empty pane. Message = default slot.
 */
withDefaults(
  defineProps<{ icon?: string; variant?: 'hint' | 'stub' }>(),
  { icon: 'fa-circle-info', variant: 'hint' },
);
</script>

<template>
  <p v-if="variant === 'hint'" class="player-hint">
    <span class="icon"><i class="fas" :class="icon"></i></span>
    <slot></slot>
  </p>
  <div v-else class="empty-stub">
    <span class="empty-stub__icon"><i class="fas" :class="icon"></i></span>
    <div>
      <slot></slot>
    </div>
  </div>
</template>
