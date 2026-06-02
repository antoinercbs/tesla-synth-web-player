<script setup lang="ts">
import { ref } from 'vue';

/**
 * A draggable vertical divider. Emits the horizontal delta (px) of each pointer
 * move; the parent accumulates + clamps it into a pane width. Layout (width,
 * height, stickiness) is left to the consumer's class so the same handle works
 * in a flex row (stretch) or beside a sticky pane.
 */
const emit = defineEmits<{
  (e: 'resize-start'): void;
  (e: 'resize', dx: number): void;
  (e: 'resize-end'): void;
}>();

const dragging = ref(false);
let lastX = 0;

function onPointerDown(e: PointerEvent): void {
  dragging.value = true;
  lastX = e.clientX;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  emit('resize-start');
  e.preventDefault();
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return;
  const dx = e.clientX - lastX;
  if (dx === 0) return;
  lastX = e.clientX;
  emit('resize', dx);
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    /* pointer already released */
  }
  emit('resize-end');
}
</script>

<template>
  <div class="resize-handle" :class="{ 'is-active': dragging }" role="separator"
    aria-orientation="vertical" @pointerdown="onPointerDown" @pointermove="onPointerMove"
    @pointerup="onPointerUp" @pointercancel="onPointerUp">
    <span class="resize-handle__grip"></span>
  </div>
</template>

<style scoped>
.resize-handle {
  width: 14px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
}
.resize-handle__grip {
  width: 2px;
  height: 100%;
  border-radius: 2px;
  background: var(--line-strong);
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.resize-handle:hover .resize-handle__grip,
.resize-handle.is-active .resize-handle__grip {
  background: var(--volt);
  box-shadow: 0 0 8px -1px var(--volt);
}
</style>
