<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMidiStore } from '@/stores/midi';
import MidiPlayer from '@/components/player/MidiPlayer.vue';
import ResizeHandle from '@/components/ui/ResizeHandle.vue';
import SongPlaylistPicker from '@/components/player/SongPlaylistPicker.vue';
import QueuePanel from '@/components/player/QueuePanel.vue';
import { formatDuration, totalDurationMs, hasUnknownDuration } from '@/utils/format';
import type { Song } from '@/types/domain';
import { useWakeLock } from '@/utils/wake-lock';
import { isPageKey } from '@/ui/page-keys';
import { GAP_KEY, GAPS, loadGap, loadQueue, saveQueue, type Repeat } from './queue';

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

/* --------------------------------- queue ---------------------------------- */
// kept between visits (./queue.ts): `ids` holds the songs, `order` positions into it
const saved = loadQueue();
const ids = ref<number[]>(saved.ids);
const order = ref<number[]>(saved.order); // play order: positions hold indices into `ids`
const pos = ref(saved.pos); // current position within `order`
const repeat = ref<Repeat>(saved.repeat);
const shuffle = ref(saved.shuffle);
watch([ids, order, pos, repeat, shuffle], () => {
  saveQueue({ ids: ids.value, order: order.value, pos: pos.value, repeat: repeat.value, shuffle: shuffle.value });
}, { deep: true });

const songsById = computed(() => new Map(midiStore.midiSongList.map((s) => [s.id, s])));
// a song not in the library (yet: it loads after the page, or the tour's demo) shows nothing
const queue = computed<(Song | null)[]>(() => ids.value.map((id) => songsById.value.get(id) ?? null));
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
  const songs = queue.value.filter((s): s is Song => !!s);
  const label = formatDuration(totalDurationMs(songs));
  return hasUnknownDuration(songs) ? `~${label}` : label;
});

// back on the page (a reload, Live and back): the song it was on is cued, never played
let cued = false;
watch(current, (s) => {
  if (!s || cued) return;
  cued = true;
  nextTick(() => player.value?.loadSong(s));
}, { immediate: true });

function shuffledOrder(n: number, first: number): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}
function rebuildOrder(startQueueIdx: number): void {
  const n = ids.value.length;
  if (n === 0) { order.value = []; pos.value = -1; return; }
  if (shuffle.value) { order.value = shuffledOrder(n, startQueueIdx); pos.value = 0; }
  else { order.value = Array.from({ length: n }, (_, i) => i); pos.value = startQueueIdx; }
}
// Activate the current item. It PLAYS when autoplay is on, OR something is
// already playing (navigating an active queue). Otherwise it just LOADS (cues)
// the track — so with autoplay off the next song is queued up but waits for Play.
function playCurrent(noAutoPlay = false): void {
  cancelWait();
  cued = true;
  if (!current.value) return;
  if ((midiStore.autoplay || isPlaying.value) && !noAutoPlay) player.value?.playSong(current.value);
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
  ids.value = [song.id];
  rebuildOrder(0);
  playCurrent(true);
}
function playPlaylist(songs: Song[]): void {
  if (!songs.length) return;
  ids.value = songs.map((s) => s.id);
  rebuildOrder(0);
  playCurrent();
}
// "Add to queue": append. Only auto-activate when the queue was empty (so it
// never hijacks the current track or restarts after the user stopped).
function enqueue(song: Song): void {
  const wasEmpty = pos.value < 0;
  ids.value.push(song.id);
  pushToOrder(ids.value.length - 1);
  if (wasEmpty) { pos.value = order.value.indexOf(ids.value.length - 1); playCurrent(); }
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
  cancelWait();
  player.value?.stop();
  ids.value = [];
  order.value = [];
  pos.value = -1;
}
// remove one entry from the up-next list (by its position in the play order)
function removeAt(opos: number): void {
  const queueIdx = order.value[opos];
  order.value.splice(opos, 1);
  ids.value.splice(queueIdx, 1);
  for (let i = 0; i < order.value.length; i++) {
    if (order.value[i] > queueIdx) {
      order.value[i]--;
    }
  }
  if (opos < pos.value) {
    pos.value--
  } else if (opos === pos.value) {
    if (order.value.length === 0) {
      player.value?.stop();
      pos.value = -1;
    } else {
      if (pos.value >= order.value.length) pos.value = order.value.length - 1;
      playCurrent();
    }
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
  if (ids.value.length) rebuildOrder(pos.value >= 0 ? order.value[pos.value] : 0);
}
function cycleRepeat(): void {
  repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off';
}

/* ------------------------------------------------ the pause between songs */
const gap = ref(loadGap());
watch(gap, (v) => {
  try { localStorage.setItem(GAP_KEY, String(v)); } catch { /* the gap lasts the visit */ }
});
function cycleGap(): void {
  gap.value = GAPS[(GAPS.indexOf(gap.value) + 1) % GAPS.length];
}
const waitLeft = ref(0); // seconds before the next song starts by itself
let waitTimer: ReturnType<typeof setInterval> | null = null;
function cancelWait(): void {
  if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
  waitLeft.value = 0;
}
// once a track has been playing, finishing it always advances the queue; with
// autoplay, after the pause asked for (when there is something to play next)
function onSongFinished(): void {
  const more = repeat.value !== 'off' || pos.value < order.value.length - 1;
  if (!gap.value || !midiStore.autoplay || !more) { next(true); return; }
  waitLeft.value = gap.value;
  waitTimer = setInterval(() => {
    if (--waitLeft.value > 0) return;
    cancelWait();
    next(true);
  }, 1000);
}
watch(() => midiStore.panicRev, cancelWait);
onBeforeUnmount(cancelWait);

/* --------------------------------------------------------------- keyboard */
useWakeLock(() => isPlaying.value);

// Space play/pause, ←/→ 5 s, Shift+←/→ (or P/N) the previous/next song, ↑/↓ the
// power by 5 %. Live mode plays notes from the keyboard: they live here, not on the page.
const KEYS: Record<string, () => void> = {
  ' ': () => player.value?.togglePlayPause(),
  ArrowLeft: () => player.value?.seekBy(-5000),
  ArrowRight: () => player.value?.seekBy(5000),
  'Shift+ArrowLeft': prev,
  'Shift+ArrowRight': () => next(false),
  p: prev,
  n: () => next(false),
  ArrowUp: () => player.value?.nudgePower(5),
  ArrowDown: () => player.value?.nudgePower(-5),
};
function keyName(e: KeyboardEvent): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return e.shiftKey && key.startsWith('Arrow') ? `Shift+${key}` : key;
}
function onKeydown(e: KeyboardEvent): void {
  const action = KEYS[keyName(e)];
  if (!action || !isPageKey(e)) return;
  e.preventDefault();
  action();
}
// a focused button would also take the Space it was given, on its keyup
function onKeyup(e: KeyboardEvent): void {
  if (e.key === ' ' && isPageKey(e)) e.preventDefault();
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('keyup', onKeyup);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('keyup', onKeyup);
});
</script>

<template>
  <div class="playback">
    <!-- LEFT: source (songs / playlists) + the up-next queue -->
    <div class="playback-left" ref="leftEl" :style="leftStyle">
      <song-playlist-picker :current-id="current?.id ?? null" @play-now="playNow" @enqueue="enqueue"
        @play-playlist="playPlaylist" />

      <queue-panel v-if="ids.length > 1 || waitLeft > 0" :queue="queue" :order="order" :pos="pos" :current="current"
        :has-prev="hasPrev" :has-next="hasNext" :total-label="queueTotalLabel" :shuffle="shuffle" :repeat="repeat"
        :gap="gap" :wait-left="waitLeft"
        @prev="prev" @next="next(false)" @jump="jumpToPos" @remove="removeAt" @reorder="onReorder"
        @toggle-shuffle="toggleShuffle" @cycle-repeat="cycleRepeat" @cycle-gap="cycleGap" @cancel-wait="cancelWait"
        @clear="clearQueue" />
    </div>

    <resize-handle class="playback__split" @resize-start="onLeftResizeStart" @resize="onLeftResize"
      @resize-end="saveLeftWidth" />

    <!-- RIGHT: the player, alone, filling the column -->
    <div class="playback-right" :style="rightStyle">
      <midi-player ref="player" @songFinished="onSongFinished" @playing-change="isPlaying = $event" />
    </div>
  </div>
</template>
