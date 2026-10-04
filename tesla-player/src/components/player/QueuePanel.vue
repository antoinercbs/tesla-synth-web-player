<script setup lang="ts">
import { ref } from 'vue';
import { formatDuration } from '@/utils/format';
import type { Song } from '@/types/domain';
import { ICONS } from '@/ui/icons';

/**
 * The "up next" queue panel (presentational). All queue logic lives in the
 * parent (PlaybackMode); this only renders the order and emits intent. Drag
 * state is local; a completed drag emits `reorder(from, to)`.
 */
defineProps<{
  queue: Song[];
  order: number[];
  pos: number;
  current: Song | null;
  hasPrev: boolean;
  hasNext: boolean;
  totalLabel: string;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
}>();
const emit = defineEmits<{
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'jump', opos: number): void;
  (e: 'remove', opos: number): void;
  (e: 'reorder', from: number, to: number): void;
  (e: 'toggle-shuffle'): void;
  (e: 'cycle-repeat'): void;
  (e: 'clear'): void;
}>();

const draggingFrom = ref<number | null>(null);
const dragOverPos = ref<number | null>(null);
function onDragStart(opos: number, e: DragEvent): void {
  draggingFrom.value = opos;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(opos));
  }
}
function onDragOver(opos: number): void { dragOverPos.value = opos; }
function onDragEnd(): void { draggingFrom.value = null; dragOverPos.value = null; }
function onDrop(toPos: number): void {
  const from = draggingFrom.value;
  onDragEnd();
  if (from === null || from === toPos) return;
  emit('reorder', from, toPos);
}
</script>

<template>
  <article class="play-panel queue-panel">
    <header class="queue-head">
      <span class="queue-head__title">
        <span class="icon"><i class="fas fa-list-ol"></i></span>{{ $t('label.upNext') }}
        <span class="queue-head__total">{{ totalLabel }}</span>
      </span>
      <div class="queue-toggles">
        <button class="queue-btn" type="button" :class="{ 'is-active': shuffle }" @click="emit('toggle-shuffle')"
          :title="$t('label.shuffle')">
          <i class="fas fa-shuffle"></i>
        </button>
        <button class="queue-btn" type="button" :class="{ 'is-active': repeat !== 'off' }" @click="emit('cycle-repeat')"
          :title="$t('label.repeat')">
          <i class="fas fa-repeat"></i>
          <span v-if="repeat === 'one'" class="repeat-one">1</span>
        </button>
        <button class="queue-btn" type="button" @click="emit('clear')" :title="$t('label.delete')">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
    </header>
    <div class="queue-nav">
      <button class="queue-btn" type="button" :disabled="!hasPrev" @click="emit('prev')" :title="$t('label.previous')">
        <i class="fas fa-backward-step"></i>
      </button>
      <span class="queue-now">
        <span class="queue-now__label">{{ $t('label.nowPlaying') }}</span>
        <span class="queue-now__name">{{ current?.name ?? '—' }}</span>
      </span>
      <button class="queue-btn" type="button" :disabled="!hasNext" @click="emit('next')" :title="$t('label.next')">
        <i class="fas fa-forward-step"></i>
      </button>
    </div>
    <ol class="queue-list">
      <li v-for="(qi, opos) in order" :key="qi" class="queue-item"
        :class="{ 'is-current': opos === pos, 'is-dragover': dragOverPos === opos, 'is-dragging': draggingFrom === opos }"
        draggable="true" @click="emit('jump', opos)" @dragstart="onDragStart(opos, $event)"
        @dragover.prevent="onDragOver(opos)" @drop.prevent="onDrop(opos)" @dragend="onDragEnd">
        <span class="queue-item__grip"><i class="fas fa-grip-vertical"></i></span>
        <span class="queue-item__idx">{{ opos + 1 }}</span>
        <span class="queue-item__name">{{ queue[qi]?.name }}</span>
        <span class="queue-item__dur">{{ formatDuration(queue[qi]?.midiFile?.durationMs) }}</span>
        <span v-if="opos === pos" class="icon queue-item__live"><i class="fas" :class="ICONS.nowPlaying"></i></span>
        <button class="queue-btn queue-item__remove" type="button" @click.stop="emit('remove', opos)"
          :title="$t('label.delete')">
          <i class="fas fa-xmark"></i>
        </button>
      </li>
    </ol>
  </article>
</template>
