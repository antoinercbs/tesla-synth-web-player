<script setup lang="ts">
import { ref } from 'vue';
import { formatDuration } from '@/utils/format';
import type { Song } from '@/types/domain';

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
    <header class="play-panel__head queue-head">
      <span class="queue-head__title">
        <span class="icon"><i class="fas fa-list-ol"></i></span>{{ $t('label.upNext') }}
        <span class="queue-head__total">{{ totalLabel }}</span>
      </span>
      <div class="queue-toggles">
        <button class="row-btn" type="button" :class="{ 'is-active': shuffle }"
          @click="emit('toggle-shuffle')" :title="$t('label.shuffle')">
          <i class="fas fa-shuffle"></i>
        </button>
        <button class="row-btn" type="button" :class="{ 'is-active': repeat !== 'off' }"
          @click="emit('cycle-repeat')" :title="$t('label.repeat')">
          <i class="fas fa-repeat"></i>
          <span v-if="repeat === 'one'" class="repeat-one">1</span>
        </button>
        <button class="row-btn" type="button" @click="emit('clear')" :title="$t('label.delete')">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
    </header>
    <div class="queue-nav">
      <button class="row-btn" type="button" :disabled="!hasPrev" @click="emit('prev')" :title="$t('label.previous')">
        <i class="fas fa-backward-step"></i>
      </button>
      <span class="queue-now">
        <span class="queue-now__label">{{ $t('label.nowPlaying') }}</span>
        <span class="queue-now__name">{{ current?.name ?? '—' }}</span>
      </span>
      <button class="row-btn" type="button" :disabled="!hasNext" @click="emit('next')" :title="$t('label.next')">
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
        <span v-if="opos === pos" class="icon queue-item__live"><i class="fas fa-volume-high"></i></span>
        <button class="row-btn queue-item__remove" type="button" @click.stop="emit('remove', opos)"
          :title="$t('label.delete')">
          <i class="fas fa-xmark"></i>
        </button>
      </li>
    </ol>
  </article>
</template>

<style scoped>
/* panel shell + compact row buttons (shared play primitives) */
.play-panel {
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
}
.queue-panel { flex: 1 1 50%; min-height: 0; display: flex; flex-direction: column; }
.play-panel__head {
  display: flex; align-items: center; gap: 0.6rem; flex: 0 0 auto;
  padding: 0.7rem 0.9rem; background: var(--volt-06); border-bottom: 1px solid var(--line);
}
.row-btn {
  position: relative;
  width: 2rem; height: 2rem; border-radius: var(--radius-3, 7px); flex: 0 0 auto;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(255, 255, 255, 0.03); border: 1px solid var(--line-strong);
  color: var(--text-dim); font-size: 0.8rem; transition: 0.13s;
}
.row-btn:hover { color: var(--volt); border-color: var(--volt); }
.row-btn.is-active { color: var(--ink); background: var(--volt); border-color: var(--volt); }
.row-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.row-btn:disabled:hover { color: var(--text-dim); border-color: var(--line-strong); }
.repeat-one {
  position: absolute; right: 1px; bottom: 0;
  font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700; line-height: 1;
}

/* queue panel */
.queue-head { justify-content: space-between; }
.queue-head__title {
  display: inline-flex; align-items: center; gap: 0.45rem;
  font-family: var(--font-display); text-transform: uppercase;
  letter-spacing: 0.06em; font-size: 0.8rem; color: var(--text);
}
.queue-head__title .icon { color: var(--volt); }
.queue-head__total {
  font-family: var(--font-mono); font-size: 0.72rem; font-weight: 400;
  letter-spacing: 0; text-transform: none; color: var(--text-mute);
  font-variant-numeric: tabular-nums;
}
.queue-toggles { display: flex; gap: 0.4rem; }
.queue-nav {
  display: flex; align-items: center; gap: 0.8rem; flex: 0 0 auto;
  padding: 0.7rem 1rem; border-bottom: 1px solid var(--line);
}
.queue-now { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.queue-now__label {
  font-family: var(--font-mono); font-size: 0.68rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-mute);
}
.queue-now__name {
  font-weight: 600; color: var(--volt);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.queue-list { list-style: none; margin: 0; padding: 0; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.queue-item {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.4rem 0.7rem 0.4rem 0.4rem; cursor: grab; min-width: 0;
  border-top: 1px solid var(--line); transition: background 0.12s;
}
.queue-item:hover { background: var(--line-005); }
.queue-item.is-current { background: var(--volt-08); }
.queue-item.is-dragging { opacity: 0.4; cursor: grabbing; }
.queue-item.is-dragover { box-shadow: inset 0 2px 0 var(--volt); }
.queue-item__grip { flex: 0 0 auto; color: var(--text-mute); font-size: 0.8rem; cursor: grab; }
.queue-item__idx { flex: 0 0 auto; width: 1.4rem; text-align: right; color: var(--text-mute); font-family: var(--font-mono); font-size: 0.8rem; }
.queue-item__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-item__dur { flex: 0 0 auto; color: var(--text-mute); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.queue-item.is-current .queue-item__name { color: var(--volt); font-weight: 600; }
.queue-item__live { color: var(--volt); flex: 0 0 auto; }
.queue-item__remove { width: 1.7rem; height: 1.7rem; font-size: 0.7rem; }
.queue-item__remove:hover { color: var(--danger); border-color: var(--danger); }
</style>
