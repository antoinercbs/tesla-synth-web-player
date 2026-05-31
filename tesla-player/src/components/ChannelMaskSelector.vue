<script setup lang="ts">
import { MIDI_CHANNEL_COUNT } from '@/types/domain';

/**
 * 16 MIDI-channel toggle grid bound to a 16-bit mask (v-model). Active cells
 * light up in `color` (a coil colour, or the default electric accent).
 */
const mask = defineModel<number>({ required: true });
withDefaults(defineProps<{ color?: string; label?: string }>(), {
  color: 'var(--volt)',
  label: 'MIDI channels',
});

function isOn(channel: number): boolean {
  return (mask.value & (1 << channel)) !== 0;
}
function toggle(channel: number): void {
  mask.value = mask.value ^ (1 << channel);
}
</script>

<template>
  <div class="chan-grid" role="group" :aria-label="label">
    <button
      v-for="i in MIDI_CHANNEL_COUNT"
      :key="i - 1"
      type="button"
      class="chan-cell"
      :class="{ 'is-on': isOn(i - 1) }"
      :style="isOn(i - 1) ? { '--cell': color } : undefined"
      :aria-pressed="isOn(i - 1)"
      @click="toggle(i - 1)"
    >
      {{ i - 1 }}
    </button>
  </div>
</template>
