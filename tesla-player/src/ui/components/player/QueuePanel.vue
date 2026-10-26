<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { formatDuration } from '@/utils/format';
import type { Song } from '@/model/domain';
import { ICONS } from '@/ui/helpers/icons';

/**
 * The "up next" queue panel (presentational). All queue logic lives in the
 * parent (PlaybackMode); this only renders the order and emits intent. Drag
 * state is local; a completed drag, or Alt+↑/↓ on a song, emits `reorder(from, to)`.
 */
const props = defineProps<{
  /** By queue index; null for a song not in the library. */
  queue: (Song | null)[];
  order: number[];
  pos: number;
  totalLabel: string;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  /** Seconds between two songs, with autoplay. */
  gap: number;
}>();
const emit = defineEmits<{
  (e: 'jump', opos: number): void;
  (e: 'remove', opos: number): void;
  (e: 'reorder', from: number, to: number): void;
  (e: 'toggle-shuffle'): void;
  (e: 'cycle-repeat'): void;
  (e: 'cycle-gap'): void;
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

const list = ref<HTMLElement | null>(null);
// Enter / Space plays it, Alt+↑/↓ moves it (the focus follows), Delete takes it out
function onItemKey(opos: number, e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') emit('jump', opos);
  else if (e.key === 'Delete' || e.key === 'Backspace') emit('remove', opos);
  else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const to = e.key === 'ArrowUp' ? opos - 1 : opos + 2;
    if (to < 0 || to > props.order.length) return;
    emit('reorder', opos, to);
    const landed = e.key === 'ArrowUp' ? opos - 1 : opos + 1;
    nextTick(() => list.value?.querySelectorAll<HTMLElement>('.queue-item')[landed]?.focus());
  } else return;
  e.preventDefault();
  e.stopPropagation(); // not the page's shortcuts too
}
</script>

<template>
  <article class="play-panel queue-panel">
    <header class="queue-head">
      <span class="queue-head__total">{{ totalLabel }}</span>
      <div class="queue-toggles">
        <button class="queue-btn queue-btn--gap" type="button" :class="{ 'is-active': gap > 0 }" @click="emit('cycle-gap')"
          :title="gap ? $t('player.gapOn', { s: gap }) : $t('player.gapOff')" :aria-label="gap ? $t('player.gapOn', { s: gap }) : $t('player.gapOff')">
          <i class="fas fa-hourglass-half"></i>
          <span v-if="gap" class="queue-btn__badge">{{ gap }}s</span>
        </button>
        <button class="queue-btn" type="button" :class="{ 'is-active': shuffle }" @click="emit('toggle-shuffle')"
          :title="$t('label.shuffle')" :aria-label="$t('label.shuffle')" :aria-pressed="shuffle">
          <i class="fas fa-shuffle"></i>
        </button>
        <button class="queue-btn" type="button" :class="{ 'is-active': repeat !== 'off' }" @click="emit('cycle-repeat')"
          :title="$t(`player.repeat.${repeat}`)" :aria-label="$t(`player.repeat.${repeat}`)" :aria-pressed="repeat !== 'off'">
          <i class="fas fa-repeat"></i>
          <span v-if="repeat === 'one'" class="repeat-one">1</span>
        </button>
        <button class="queue-btn" type="button" @click="emit('clear')" :title="$t('player.clearQueue')"
          :aria-label="$t('player.clearQueue')">
          <i class="fas fa-trash-can"></i>
        </button>
      </div>
    </header>
    <ol ref="list" class="queue-list" :aria-label="$t('label.upNext')">
      <template v-for="(qi, opos) in order" :key="qi">
        <li v-if="queue[qi]" class="queue-item" tabindex="0" :aria-current="opos === pos ? 'true' : undefined"
          :class="{ 'is-current': opos === pos, 'is-dragover': dragOverPos === opos, 'is-dragging': draggingFrom === opos }"
          draggable="true" @click="emit('jump', opos)" @keydown="onItemKey(opos, $event)" @dragstart="onDragStart(opos, $event)"
          @dragover.prevent="onDragOver(opos)" @drop.prevent="onDrop(opos)" @dragend="onDragEnd">
          <span class="queue-item__grip"><i class="fas fa-grip-vertical"></i></span>
          <span class="queue-item__idx">{{ opos + 1 }}</span>
          <span class="queue-item__name">{{ queue[qi]?.name }}</span>
          <span class="queue-item__dur">{{ formatDuration(queue[qi]?.midiFile?.durationMs) }}</span>
          <span v-if="opos === pos" class="icon queue-item__live"><i class="fas" :class="ICONS.nowPlaying"></i></span>
          <button class="queue-btn queue-item__remove" type="button" tabindex="-1" @click.stop="emit('remove', opos)"
            :title="$t('label.delete')" :aria-label="$t('label.delete')">
            <i class="fas fa-xmark"></i>
          </button>
        </li>
      </template>
    </ol>
  </article>
</template>
