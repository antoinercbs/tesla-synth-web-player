<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import MidiPlayer from '@/components/MidiPlayer.vue';
import SearchableSelect from '@/components/SearchableSelect.vue';
import ResizeHandle from '@/components/ResizeHandle.vue';
import { coilColor } from '@/ui/coil-colors';
import { formatDuration, totalDurationMs, hasUnknownDuration } from '@/utils/format';
import type { Song, Playlist } from '@/types/domain';

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

/* ------------------------------ source picker ----------------------------- */
type Source = 'songs' | 'playlists';
const source = ref<Source>('songs');
const songs = computed<Song[]>(() => midiStore.midiSongList);

// songs library: text search + coil-count filter
const search = ref('');
const coilFilter = ref<number | null>(null); // null = all counts
const availableCoilCounts = computed(() =>
  [...new Set(songs.value.map((s) => s.coilCount))].sort((a, b) => a - b),
);
const filteredSongs = computed<Song[]>(() => {
  const q = search.value.trim().toLowerCase();
  return songs.value.filter(
    (s) =>
      (coilFilter.value == null || s.coilCount === coilFilter.value) &&
      (q === '' || s.name.toLowerCase().includes(q)),
  );
});

// playlists
const playlists = ref<Playlist[]>([]);
const selectedPlaylistId = ref<number | null>(null);
const selectedPlaylist = computed<Playlist | null>(
  () => playlists.value.find((p) => p.id === selectedPlaylistId.value) ?? null,
);
const playlistItems = computed(() =>
  playlists.value.map((p) => ({ id: p.id, label: `${p.name} — ${p.coilCount} ⚡` })),
);
function songById(id: number): Song | undefined {
  return songs.value.find((s) => s.id === id);
}
interface PlaylistEntry { song: Song; compatible: boolean }
const playlistEntries = computed<PlaylistEntry[]>(() => {
  const pl = selectedPlaylist.value;
  if (!pl) return [];
  return pl.songIds
    .map((id) => songById(id))
    .filter((s): s is Song => !!s)
    .map((s) => ({ song: s, compatible: s.coilCount === pl.coilCount }));
});
const compatibleSongs = computed<Song[]>(() =>
  playlistEntries.value.filter((e) => e.compatible).map((e) => e.song),
);

function loadPlaylists(): void {
  axios.get('/api/playlists').then((r) => {
    playlists.value = r.data as Playlist[];
  });
}
loadPlaylists();
// Re-read after a desktop sync may have changed playlists locally (songs/MIDI
// come from the store, which App refreshes directly).
watch(() => midiStore.dataRevision, loadPlaylists);

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
function playPlaylist(): void {
  if (!compatibleSongs.value.length) return;
  queue.value = [...compatibleSongs.value];
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

// drag-and-drop reordering of the up-next list
const draggingFrom = ref<number | null>(null);
const dragOverPos = ref<number | null>(null);
function onDragStart(opos: number, e: DragEvent): void {
  draggingFrom.value = opos;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(opos)); }
}
function onDragOver(opos: number): void { dragOverPos.value = opos; }
function onDragEnd(): void { draggingFrom.value = null; dragOverPos.value = null; }
function onDrop(toPos: number): void {
  const from = draggingFrom.value;
  onDragEnd();
  if (from === null || from === toPos) return;
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
function isCurrent(song: Song): boolean { return current.value?.id === song.id; }
function coilChips(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
</script>

<template>
  <div class="playback">
    <!-- LEFT: source (songs / playlists) + the up-next queue -->
    <div class="playback-left" ref="leftEl" :style="leftStyle">
      <article class="play-panel source-panel">
        <header class="play-panel__head">
          <div class="segmented segmented--fill">
            <button type="button" :class="{ 'is-active': source === 'songs' }" @click="source = 'songs'">
              <span class="icon"><i class="fas fa-music"></i></span>{{ $t('label.sourceSongs') }}
            </button>
            <button type="button" :class="{ 'is-active': source === 'playlists' }" @click="source = 'playlists'">
              <span class="icon"><i class="fas fa-list"></i></span>{{ $t('label.sourcePlaylists') }}
            </button>
          </div>
        </header>

        <!-- songs library -->
        <template v-if="source === 'songs'">
          <div class="play-pick play-pick--row">
            <div class="play-search">
              <span class="play-search__icon"><i class="fas fa-search"></i></span>
              <input class="text-field" type="text" :placeholder="$t('label.search')" v-model="search" />
            </div>
            <div v-if="availableCoilCounts.length > 1" class="select-field coil-select">
              <select v-model="coilFilter">
                <option :value="null">⚡ {{ $t('label.allCoils') }}</option>
                <option v-for="c in availableCoilCounts" :key="c" :value="c">⚡ {{ c }}</option>
              </select>
            </div>
          </div>
          <ul class="play-rows">
            <li v-for="song in filteredSongs" :key="song.id" class="play-row" :class="{ 'is-current': isCurrent(song) }">
              <button class="row-btn row-btn--play" type="button" @click="playNow(song)" :title="$t('label.playNow')">
                <i class="fas" :class="isCurrent(song) ? 'fa-volume-high' : 'fa-play'"></i>
              </button>
              <button class="row-btn" type="button" @click="enqueue(song)" :title="$t('label.addToQueue')">
                <i class="fas fa-plus"></i>
              </button>
              <span class="play-row__name">{{ song.name }}</span>
              <span class="play-row__dur">{{ formatDuration(song.midiFile?.durationMs) }}</span>
              <span class="coil-dots">
                <span v-for="i in coilChips(song.coilCount)" :key="i" class="coil-dot" :style="{ '--c': coilColor(i) }"></span>
              </span>
              <button class="row-btn" type="button" @click="editSong(song)" :title="$t('nav.edit')">
                <i class="fas fa-pen"></i>
              </button>
            </li>
            <li v-if="filteredSongs.length === 0" class="play-empty">{{ $t('label.noResults') }}</li>
          </ul>
        </template>

        <!-- playlists -->
        <template v-else>
          <div class="play-pick play-pick--combo">
            <searchable-select v-model="selectedPlaylistId" :items="playlistItems"
              :placeholder="$t('label.pickPlaylist')" clearable />
          </div>
          <template v-if="selectedPlaylist">
            <div class="playlist-bar">
              <span class="coil-badge"><span class="icon"><i class="fas fa-bolt"></i></span>{{ selectedPlaylist.coilCount }}</span>
              <button class="btn btn--volt playlist-bar__play" type="button" :disabled="compatibleSongs.length === 0"
                @click="playPlaylist">
                <span class="icon"><i class="fas fa-play"></i></span>{{ $t('label.playAll') }}
              </button>
            </div>
            <ul class="play-rows">
              <li v-for="entry in playlistEntries" :key="entry.song.id" class="play-row"
                :class="{ 'is-current': isCurrent(entry.song), 'is-incompatible': !entry.compatible }">
                <button class="row-btn row-btn--play" type="button" :disabled="!entry.compatible"
                  @click="entry.compatible && playNow(entry.song)" :title="$t('label.playNow')">
                  <i class="fas" :class="isCurrent(entry.song) ? 'fa-volume-high' : 'fa-play'"></i>
                </button>
                <button class="row-btn" type="button" :disabled="!entry.compatible"
                  @click="entry.compatible && enqueue(entry.song)" :title="$t('label.addToQueue')">
                  <i class="fas fa-plus"></i>
                </button>
                <span class="play-row__name">{{ entry.song.name }}</span>
                <span v-if="!entry.compatible" class="incompat-flag"
                  :title="$t('label.incompatibleCoils', { n: entry.song.coilCount })">
                  <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ entry.song.coilCount }}
                </span>
                <span v-else class="coil-dots">
                  <span v-for="i in coilChips(entry.song.coilCount)" :key="i" class="coil-dot"
                    :style="{ '--c': coilColor(i) }"></span>
                </span>
                <button class="row-btn" type="button" @click="editSong(entry.song)" :title="$t('nav.edit')">
                  <i class="fas fa-pen"></i>
                </button>
              </li>
              <li v-if="playlistEntries.length === 0" class="play-empty">{{ $t('label.emptyPlaylist') }}</li>
              <li v-else-if="compatibleSongs.length === 0" class="play-empty">{{ $t('label.noCompatibleSongs') }}</li>
            </ul>
          </template>
          <div v-else class="play-stub">
            <span class="play-stub__icon"><i class="fas fa-list"></i></span>
            <p>{{ $t('label.pickPlaylist') }}</p>
          </div>
        </template>
      </article>

      <!-- up-next queue (only meaningful with more than one track) -->
      <article v-if="queue.length > 1" class="play-panel queue-panel">
        <header class="play-panel__head queue-head">
          <span class="queue-head__title">
            <span class="icon"><i class="fas fa-list-ol"></i></span>{{ $t('label.upNext') }}
            <span class="queue-head__total">{{ queueTotalLabel }}</span>
          </span>
          <div class="queue-toggles">
            <button class="row-btn" type="button" :class="{ 'is-active': shuffle }" @click="toggleShuffle"
              :title="$t('label.shuffle')">
              <i class="fas fa-shuffle"></i>
            </button>
            <button class="row-btn" type="button" :class="{ 'is-active': repeat !== 'off' }" @click="cycleRepeat"
              :title="$t('label.repeat')">
              <i class="fas fa-repeat"></i>
              <span v-if="repeat === 'one'" class="repeat-one">1</span>
            </button>
            <button class="row-btn" type="button" @click="clearQueue" :title="$t('label.delete')">
              <i class="fas fa-xmark"></i>
            </button>
          </div>
        </header>
        <div class="queue-nav">
          <button class="row-btn" type="button" :disabled="!hasPrev" @click="prev" :title="$t('label.previous')">
            <i class="fas fa-backward-step"></i>
          </button>
          <span class="queue-now">
            <span class="queue-now__label">{{ $t('label.nowPlaying') }}</span>
            <span class="queue-now__name">{{ current?.name ?? '—' }}</span>
          </span>
          <button class="row-btn" type="button" :disabled="!hasNext" @click="next(false)" :title="$t('label.next')">
            <i class="fas fa-forward-step"></i>
          </button>
        </div>
        <ol class="queue-list">
          <li v-for="(qi, opos) in order" :key="qi" class="queue-item"
            :class="{ 'is-current': opos === pos, 'is-dragover': dragOverPos === opos, 'is-dragging': draggingFrom === opos }"
            draggable="true" @click="jumpToPos(opos)" @dragstart="onDragStart(opos, $event)"
            @dragover.prevent="onDragOver(opos)" @drop.prevent="onDrop(opos)" @dragend="onDragEnd">
            <span class="queue-item__grip"><i class="fas fa-grip-vertical"></i></span>
            <span class="queue-item__idx">{{ opos + 1 }}</span>
            <span class="queue-item__name">{{ queue[qi]?.name }}</span>
            <span class="queue-item__dur">{{ formatDuration(queue[qi]?.midiFile?.durationMs) }}</span>
            <span v-if="opos === pos" class="icon queue-item__live"><i class="fas fa-volume-high"></i></span>
            <button class="row-btn queue-item__remove" type="button" @click.stop="removeAt(opos)" :title="$t('label.delete')">
              <i class="fas fa-xmark"></i>
            </button>
          </li>
        </ol>
      </article>
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

/* panel shell — mirrors .player-panel */
.play-panel {
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
}
/* when a queue exists, source and up-next split the column ~50/50 by default */
.source-panel { flex: 1 1 50%; min-height: 0; display: flex; flex-direction: column; }
.queue-panel { flex: 1 1 50%; min-height: 0; display: flex; flex-direction: column; }
.play-panel__head {
  display: flex; align-items: center; gap: 0.6rem; flex: 0 0 auto;
  padding: 0.7rem 0.9rem; background: rgba(70, 224, 255, 0.06); border-bottom: 1px solid var(--line);
}

/* search row: text field + compact coil-count dropdown on one line */
.play-pick { display: flex; align-items: center; gap: 0.6rem; padding: 0.8rem 1rem; flex: 0 0 auto; }
.play-pick--combo { display: block; } /* the playlist combo takes the full width */
.play-search { position: relative; flex: 1 1 auto; min-width: 0; }
.play-search .text-field { width: 100%; padding-left: 2.2rem; }
.play-search__icon {
  position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%);
  color: var(--text-mute); pointer-events: none; font-size: 0.85rem;
}
.coil-select { flex: 0 0 auto; width: auto; }
.coil-select select { padding: 0.5rem 1.9rem 0.5rem 0.7rem; font-family: var(--font-mono); font-size: 0.85rem; }

/* playlist action bar */
.playlist-bar { display: flex; align-items: center; gap: 0.6rem; padding: 0 1rem 0.7rem; flex: 0 0 auto; }
.coil-badge {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.3rem 0.6rem; border-radius: 8px;
  background: rgba(70, 224, 255, 0.1); border: 1px solid var(--line-strong);
  color: var(--volt); font-family: var(--font-mono); font-weight: 600; font-size: 0.85rem;
}
.playlist-bar__play { flex: 1 1 auto; justify-content: center; padding: 0.45rem 0.9rem; }

/* empty / stub states */
.play-empty { padding: 1.2rem 1rem; color: var(--text-mute); text-align: center; font-family: var(--font-mono); font-size: 0.85rem; }
.play-stub {
  flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.6rem; color: var(--text-mute); text-align: center; padding: 2rem;
}
.play-stub__icon { font-size: 2rem; color: var(--volt); opacity: 0.5; }

/* song / playlist rows */
.play-rows { list-style: none; margin: 0; padding: 0; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.play-row {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.5rem 1rem; min-width: 0;
  border-top: 1px solid var(--line); transition: background 0.13s;
}
.play-row:hover { background: rgba(120, 160, 205, 0.05); }
.play-row.is-current { background: rgba(70, 224, 255, 0.08); }
.play-row.is-incompatible { opacity: 0.5; }
.play-row__name {
  flex: 1 1 auto; min-width: 0; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.play-row.is-current .play-row__name { color: var(--volt); }
.play-row__dur { flex: 0 0 auto; color: var(--text-mute); font-size: 0.75rem; font-variant-numeric: tabular-nums; }

/* coil colour dots */
.coil-dots { display: inline-flex; gap: 3px; flex: 0 0 auto; }
.coil-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px -1px var(--c); }
.incompat-flag {
  display: inline-flex; align-items: center; gap: 0.25rem; flex: 0 0 auto;
  color: var(--coil-1); font-family: var(--font-mono); font-size: 0.78rem;
}

/* compact row buttons */
.row-btn {
  position: relative;
  width: 2rem; height: 2rem; border-radius: 7px; flex: 0 0 auto;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(255, 255, 255, 0.03); border: 1px solid var(--line-strong);
  color: var(--text-dim); font-size: 0.8rem; transition: 0.13s;
}
.row-btn:hover { color: var(--volt); border-color: var(--volt); }
.row-btn.is-active { color: #06090f; background: var(--volt); border-color: var(--volt); }
.row-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.row-btn:disabled:hover { color: var(--text-dim); border-color: var(--line-strong); }
.row-btn--play:hover { color: var(--plasma); border-color: var(--plasma); }
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
.queue-item:hover { background: rgba(120, 160, 205, 0.05); }
.queue-item.is-current { background: rgba(70, 224, 255, 0.08); }
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
