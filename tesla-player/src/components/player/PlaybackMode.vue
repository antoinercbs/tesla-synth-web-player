<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useMidiStore } from '@/stores/midi';
import MidiPlayer from '@/components/player/MidiPlayer.vue';
import ResizeHandle from '@/components/ui/ResizeHandle.vue';
import SongPlaylistPicker from '@/components/player/SongPlaylistPicker.vue';
import QueuePanel from '@/components/player/QueuePanel.vue';
import { formatDuration, totalDurationMs, hasUnknownDuration } from '@/utils/format';
import type { Song } from '@/types/domain';

const router = useRouter();
const midiStore = useMidiStore();
const player = ref<InstanceType<typeof MidiPlayer> | null>(null);
const isPlaying = ref(false); // mirrors the player; lets the queue keep chaining

/* ----- resizable split between the source/queue (left) and the player (right) ----- */
const leftEl = ref<HTMLElement | null>(null);
// null until the user first drags — keeps the default 5:7 proportion.
const leftWidth = ref<number | null>(
  Number(localStorage.getItem('playLeftWidth')) || null,
);
const leftStyle = computed(() =>
  leftWidth.value != null
    ? { flex: `0 0 ${leftWidth.value}px`, minWidth: '0' }
    : { flex: '5 1 0', minWidth: '0' },
);
const rightStyle = computed(() =>
  leftWidth.value != null
    ? { flex: '1 1 0', minWidth: '0' }
    : { flex: '7 1 0', minWidth: '0' },
);
function onLeftResizeStart(): void {
  if (leftWidth.value == null && leftEl.value) {
    leftWidth.value = leftEl.value.offsetWidth; // seed from the current render
  }
}
function onLeftResize(dx: number): void {
  if (leftWidth.value == null) return;
  leftWidth.value = Math.max(320, Math.min(900, leftWidth.value + dx));
}
function saveLeftWidth(): void {
  if (leftWidth.value != null) {
    localStorage.setItem('playLeftWidth', String(leftWidth.value));
  }
}

function editSong(song: Song): void {
  router.push({ name: 'edit', params: { id: String(song.id) } });
}

/* --------------------------------- queue ---------------------------------- */
type Repeat = 'off' | 'all' | 'one';
const queue = ref<Song[]>([]);
const order = ref<number[]>([]); // play order: positions hold indices into `queue`
const pos = ref(-1); // current position within `order`
const repeat = ref<Repeat>('off');
const shuffle = ref(false);

const current = computed<Song | null>(() =>
  pos.value >= 0 && pos.value < order.value.length
    ? queue.value[order.value[pos.value]] ?? null
    : null,
);
const hasPrev = computed(() => pos.value > 0 || repeat.value === 'all');
const hasNext = computed(
  () => pos.value < order.value.length - 1 || repeat.value === 'all',
);
// total play length of the whole queue ("~" prefix if any track's length is unknown)
const queueTotalLabel = computed(() => {
  const label = formatDuration(totalDurationMs(queue.value));
  return hasUnknownDuration(queue.value) ? `~${label}` : label;
});

function shuffledOrder(n: number, first: number): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}
function rebuildOrder(startQueueIdx: number): void {
  const n = queue.value.length;
  if (n === 0) { order.value = []; pos.value = -1; return; }
  if (shuffle.value) { order.value = shuffledOrder(n, startQueueIdx); pos.value = 0; }
  else { order.value = Array.from({ length: n }, (_, i) => i); pos.value = startQueueIdx; }
}
// Activate the current item. It PLAYS when autoplay is on, OR something is
// already playing (navigating an active queue). Otherwise it just LOADS (cues)
// the track — so with autoplay off the next song is queued up but waits for Play.
function playCurrent(): void {
  if (!current.value) return;
  if (midiStore.autoplay || isPlaying.value) player.value?.playSong(current.value);
  else player.value?.loadSong(current.value);
}

/** Insert a freshly-pushed queue index into the play order (random spot if shuffling). */
function pushToOrder(newQueueIdx: number): void {
  if (shuffle.value && order.value.length > 0) {
    const span = Math.max(1, order.value.length - pos.value);
    const at = Math.min(order.value.length, pos.value + 1 + Math.floor(Math.random() * span));
    order.value.splice(at, 0, newQueueIdx);
  } else {
    order.value.push(newQueueIdx);
  }
}

// "Play now": start a fresh queue with just this song (or the whole playlist).
function playNow(song: Song): void {
  queue.value = [song];
  rebuildOrder(0);
  playCurrent();
}
function playPlaylist(songs: Song[]): void {
  if (!songs.length) return;
  queue.value = [...songs];
  rebuildOrder(0);
  playCurrent();
}
// "Add to queue": append. Only auto-activate when the queue was empty (so it
// never hijacks the current track or restarts after the user stopped).
function enqueue(song: Song): void {
  const wasEmpty = pos.value < 0;
  queue.value.push(song);
  pushToOrder(queue.value.length - 1);
  if (wasEmpty) { pos.value = order.value.indexOf(queue.value.length - 1); playCurrent(); }
}

function next(auto = false): void {
  if (order.value.length === 0) return;
  if (auto && repeat.value === 'one') { playCurrent(); return; }
  if (pos.value < order.value.length - 1) { pos.value++; playCurrent(); }
  else if (repeat.value === 'all') { pos.value = 0; playCurrent(); }
}
function prev(): void {
  if (order.value.length === 0) return;
  if (pos.value > 0) { pos.value--; playCurrent(); }
  else if (repeat.value === 'all') { pos.value = order.value.length - 1; playCurrent(); }
}
function jumpToPos(p: number): void { pos.value = p; playCurrent(); }
function clearQueue(): void {
  player.value?.stop();
  queue.value = [];
  order.value = [];
  pos.value = -1;
}
// remove one entry from the up-next list (by its position in the play order)
function removeAt(opos: number): void {
  order.value.splice(opos, 1);
  if (opos < pos.value) {
    pos.value--; // an earlier item went away → keep pointing at the same track
  } else if (opos === pos.value) {
    // removed the current track → fall onto the next one (or stop if none left)
    if (order.value.length === 0) { player.value?.stop(); pos.value = -1; }
    else { if (pos.value >= order.value.length) pos.value = order.value.length - 1; playCurrent(); }
  }
}
// drag-and-drop reorder: QueuePanel tracks the drag and emits the final move.
function onReorder(from: number, toPos: number): void {
  const curQi = pos.value >= 0 ? order.value[pos.value] : -1; // remember the playing track
  const arr = order.value.slice();
  const [moved] = arr.splice(from, 1);
  arr.splice(from < toPos ? toPos - 1 : toPos, 0, moved); // adjust for the removal shift
  order.value = arr;
  if (curQi >= 0) pos.value = order.value.indexOf(curQi); // keep current following its track
}
function toggleShuffle(): void {
  shuffle.value = !shuffle.value;
  if (queue.value.length) rebuildOrder(pos.value >= 0 ? order.value[pos.value] : 0);
}
function cycleRepeat(): void {
  repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off';
}

// once a track has been playing, finishing it always advances the queue
function onSongFinished(): void { next(true); }
</script>

<template>
  <div class="playback">
    <!-- LEFT: source (songs / playlists) + the up-next queue -->
    <div class="playback-left" ref="leftEl" :style="leftStyle">
      <song-playlist-picker :current-id="current?.id ?? null" @play-now="playNow"
        @enqueue="enqueue" @play-playlist="playPlaylist" @edit="editSong" />

      <queue-panel v-if="queue.length > 1" :queue="queue" :order="order" :pos="pos" :current="current"
        :has-prev="hasPrev" :has-next="hasNext" :total-label="queueTotalLabel" :shuffle="shuffle" :repeat="repeat"
        @prev="prev" @next="next(false)" @jump="jumpToPos" @remove="removeAt" @reorder="onReorder"
        @toggle-shuffle="toggleShuffle" @cycle-repeat="cycleRepeat" @clear="clearQueue" />
    </div>

    <resize-handle class="playback__split" @resize-start="onLeftResizeStart"
      @resize="onLeftResize" @resize-end="saveLeftWidth" />

    <!-- RIGHT: the player, alone, filling the column -->
    <div class="playback-right" :style="rightStyle">
      <midi-player ref="player" @songFinished="onSongFinished" @playing-change="isPlaying = $event" />
    </div>
  </div>
</template>

<style scoped>
/* full-height two-column layout: left = source + queue, right = player.
   A draggable ResizeHandle sits between them; widths come from inline styles. */
.playback { display: flex; flex: 1 1 auto; min-height: 0; align-items: stretch; }
.playback-left { display: flex; flex-direction: column; gap: 1.1rem; min-height: 0; }
.playback-right { display: flex; flex-direction: column; min-height: 0; }
.playback-right :deep(.player-panel) { flex: 1 1 auto; min-height: 0; }

/* narrow screens: stack and drop the divider (override the inline flex) */
@media (max-width: 900px) {
  .playback { flex-direction: column; }
  .playback-left, .playback-right { flex: 1 1 auto !important; }
  .playback__split { display: none; }
}
</style>
