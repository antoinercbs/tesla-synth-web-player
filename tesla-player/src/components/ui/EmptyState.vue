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
    <span class="icon"><i class="fas" :class="icon"></i></span><slot></slot>
  </p>
  <div v-else class="empty-stub">
    <span class="empty-stub__icon"><i class="fas" :class="icon"></i></span>
    <div><slot></slot></div>
  </div>
</template>

<style scoped>
/* .player-hint is global (styles/_player.scss); the stub carries its own style. */
.empty-stub {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  color: var(--text-mute);
  text-align: center;
  padding: 2rem;
}
.empty-stub__icon { font-size: 2rem; color: var(--volt); opacity: 0.5; }
</style>
