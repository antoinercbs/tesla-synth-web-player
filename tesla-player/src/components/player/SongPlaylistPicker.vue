<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { coilColor } from '@/ui/coil-colors';
import { formatDuration } from '@/utils/format';
import type { Song, Playlist } from '@/types/domain';

/**
 * The playback source picker: songs library (search + coil-count filter) and
 * playlists. Presentational — it emits intent (play-now / enqueue / edit /
 * play-playlist); the queue lives in the parent. `currentId` drives the
 * now-playing highlight.
 */
defineProps<{ currentId: number | null }>();
const emit = defineEmits<{
  (e: 'play-now', song: Song): void;
  (e: 'enqueue', song: Song): void;
  (e: 'play-playlist', songs: Song[]): void;
}>();

const midiStore = useMidiStore();

type Source = 'songs' | 'playlists';
const source = ref<Source>('songs');
const songs = computed<Song[]>(() => midiStore.midiSongList);

// songs library: text search + coil-count filter
const search = ref('');
const coilFilter = ref<number | null>(null); // null = all counts
const availableCoilCounts = computed(() =>
  [...new Set(songs.value.map((s) => s.coilCount))].sort((a, b) => a - b),
);
// A song matches on its name OR on any one of its tags — never on the two
// concatenated, which would match across the seam ("abc" + "rock" ~ "crock").
function matches(song: Song, q: string): boolean {
  return (
    song.name.toLowerCase().includes(q) ||
    (song.tags ?? []).some((t) => t.name.toLowerCase().includes(q))
  );
}
const filteredSongs = computed<Song[]>(() => {
  const q = search.value.trim().toLowerCase();
  return songs.value.filter(
    (s) =>
      (coilFilter.value == null || s.coilCount === coilFilter.value) &&
      (q === '' || matches(s, q)),
  );
});

// playlists
const playlists = ref<Playlist[]>([]);
const selectedPlaylistId = ref<number | null>(null);
const selectedPlaylist = computed<Playlist | null>(
  () => playlists.value.find((p) => p.id === selectedPlaylistId.value) ?? null,
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
/** Songs of a playlist that match its coil count (what "play all" plays). */
function compatibleOf(pl: Playlist): Song[] {
  return pl.songIds
    .map((id) => songById(id))
    .filter((s): s is Song => !!s && s.coilCount === pl.coilCount);
}
function playlistDurationMs(pl: Playlist): number {
  return pl.songIds.reduce((sum, id) => sum + (songById(id)?.midiFile?.durationMs ?? 0), 0);
}

function loadPlaylists(): void {
  axios.get('/api/playlists').then((r) => {
    playlists.value = r.data as Playlist[];
  });
}
loadPlaylists();
// Re-read after a desktop sync may have changed playlists locally (songs/MIDI
// come from the store, which App refreshes directly).
watch(() => midiStore.dataRevision, loadPlaylists);

function coilChips(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
/** Does the song mirror any channel to the 2nd (speaker) output? */
function usesSpeaker(song: Song): boolean { return (song.output2Mask ?? 0) !== 0; }
</script>

<template>
  <article class="play-panel source-panel">
    <header class="play-panel__head">
      <segmented-control v-model="source" tabs :options="[
        { value: 'songs', label: $t('label.sourceSongs'), icon: 'fa-music' },
        { value: 'playlists', label: $t('label.sourcePlaylists'), icon: 'fa-list' },
      ]" />
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
        <li v-for="song in filteredSongs" :key="song.id" class="play-row"
          :class="{ 'is-current': song.id === currentId }">
          <button class="row-btn row-btn--play" type="button" @click="emit('play-now', song)"
            :title="$t('label.playNow')">
            <i class="fas" :class="song.id === currentId ? 'fa-volume-high' : 'fa-play'"></i>
          </button>
          <div class="play-row__main">
            <span class="play-row__name">{{ song.name }}</span>
            <div v-if="song.tags?.length" class="play-row__meta">
              <span v-for="tag in song.tags" :key="tag.id ?? tag.name" class="song-tag-pill"
                :style="{ '--tag-c': tag.color }">{{ tag.name }}</span>
            </div>
          </div>
          <!-- secondary actions take the facts' place on hover / keyboard focus (both shown on touch screens) -->
          <div class="play-row__end">
            <div class="play-row__facts">
              <span class="play-row__dur">{{ formatDuration(song.midiFile?.durationMs) }}</span>
              <span class="coil-dots">
                <span v-for="i in coilChips(song.coilCount)" :key="i" class="coil-dot"
                  :style="{ '--c': coilColor(i) }"></span>
                <span v-if="usesSpeaker(song)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i
                    class="fas fa-volume-high"></i></span>
              </span>
            </div>
            <div class="play-row__acts">
              <button class="row-btn" type="button" @click="emit('enqueue', song)" :title="$t('label.addToQueue')">
                <i class="fas fa-plus"></i>
              </button>
              <RouterLink class="row-btn" :to="{ name: 'edit', params: { id: String(song.id) } }"
                :title="$t('nav.edit')">
                <i class="fas fa-pen"></i>
              </RouterLink>
            </div>
          </div>
        </li>
        <li v-if="songs.length === 0" class="play-empty">
          <empty-state variant="stub" icon="fa-music">{{ $t('label.noSongsYet') }}</empty-state>
          <RouterLink class="btn btn--volt play-empty__cta" :to="{ name: 'edit' }">
            <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('label.newSong') }}
          </RouterLink>
        </li>
        <li v-else-if="filteredSongs.length === 0" class="play-empty">{{ $t('label.noResults') }}</li>
      </ul>
    </template>

    <!-- playlists: the list itself, then one playlist's songs -->
    <template v-else-if="!selectedPlaylist">
      <ul class="play-rows">
        <li v-for="pl in playlists" :key="pl.id" class="play-row">
          <button class="row-btn row-btn--play" type="button" :disabled="compatibleOf(pl).length === 0"
            @click="emit('play-playlist', compatibleOf(pl))" :title="$t('label.playAll')">
            <i class="fas fa-play"></i>
          </button>
          <button class="play-row__main play-row__open" type="button" @click="selectedPlaylistId = pl.id">
            <span class="play-row__name">{{ pl.name }}</span>
            <span class="play-row__meta">{{ $t('label.songsCount', pl.songIds.length) }}</span>
          </button>
          <div class="play-row__end">
            <div class="play-row__facts">
              <span class="play-row__dur">{{ formatDuration(playlistDurationMs(pl)) }}</span>
              <span class="coil-dots">
                <span v-for="i in coilChips(pl.coilCount)" :key="i" class="coil-dot"
                  :style="{ '--c': coilColor(i) }"></span>
              </span>
            </div>
            <div class="play-row__acts">
              <RouterLink class="row-btn" :to="{ name: 'playlists', params: { id: String(pl.id) } }"
                :title="$t('nav.edit')">
                <i class="fas fa-pen"></i>
              </RouterLink>
            </div>
          </div>
        </li>
        <li v-if="playlists.length === 0" class="play-empty">
          <empty-state variant="stub" icon="fa-list">{{ $t('label.noPlaylistsYet') }}</empty-state>
        </li>
      </ul>
      <RouterLink class="play-new" :to="{ name: 'playlists' }">
        <i class="fas fa-plus"></i>{{ $t('label.newPlaylist') }}
      </RouterLink>
    </template>

    <template v-else>
      <div class="playlist-bar">
        <button class="row-btn" type="button" :title="$t('label.allPlaylists')" :aria-label="$t('label.allPlaylists')"
          @click="selectedPlaylistId = null">
          <i class="fas fa-arrow-left"></i>
        </button>
        <span class="playlist-bar__name">{{ selectedPlaylist.name }}</span>
        <button class="btn btn--volt playlist-bar__play" type="button" :disabled="compatibleSongs.length === 0"
          @click="emit('play-playlist', compatibleSongs)">
          <span class="icon"><i class="fas fa-play"></i></span>{{ $t('label.playAll') }}
        </button>
      </div>
      <ul class="play-rows">
        <li v-for="entry in playlistEntries" :key="entry.song.id" class="play-row"
          :class="{ 'is-current': entry.song.id === currentId, 'is-incompatible': !entry.compatible }">
          <button class="row-btn row-btn--play" type="button" :disabled="!entry.compatible"
            @click="entry.compatible && emit('play-now', entry.song)" :title="$t('label.playNow')">
            <i class="fas" :class="entry.song.id === currentId ? 'fa-volume-high' : 'fa-play'"></i>
          </button>
          <div class="play-row__main">
            <span class="play-row__name">{{ entry.song.name }}</span>
            <div v-if="entry.song.tags?.length" class="play-row__meta">
              <span v-for="tag in entry.song.tags" :key="tag.id ?? tag.name" class="song-tag-pill"
                :style="{ '--tag-c': tag.color }">{{ tag.name }}</span>
            </div>
          </div>
          <div class="play-row__end">
            <div class="play-row__facts">
              <span class="play-row__dur">{{ formatDuration(entry.song.midiFile?.durationMs) }}</span>
              <span v-if="!entry.compatible" class="incompat-flag"
                :title="$t('label.incompatibleCoils', { n: entry.song.coilCount })">
                <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ entry.song.coilCount }}
              </span>
              <span v-else class="coil-dots">
                <span v-for="i in coilChips(entry.song.coilCount)" :key="i" class="coil-dot"
                  :style="{ '--c': coilColor(i) }"></span>
                <span v-if="usesSpeaker(entry.song)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i
                    class="fas fa-volume-high"></i></span>
              </span>
            </div>
            <div class="play-row__acts">
              <button class="row-btn" type="button" :disabled="!entry.compatible"
                @click="entry.compatible && emit('enqueue', entry.song)" :title="$t('label.addToQueue')">
                <i class="fas fa-plus"></i>
              </button>
              <RouterLink class="row-btn" :to="{ name: 'edit', params: { id: String(entry.song.id) } }"
                :title="$t('nav.edit')">
                <i class="fas fa-pen"></i>
              </RouterLink>
            </div>
          </div>
        </li>
        <li v-if="playlistEntries.length === 0" class="play-empty">
          <empty-state variant="stub" icon="fa-list">{{ $t('label.emptyPlaylist') }}</empty-state>
          <RouterLink class="btn btn--volt play-empty__cta"
            :to="{ name: 'playlists', params: { id: String(selectedPlaylist.id) } }">
            <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('label.addSongs') }}
          </RouterLink>
        </li>
        <li v-else-if="compatibleSongs.length === 0" class="play-empty">{{ $t('label.noCompatibleSongs') }}</li>
      </ul>
    </template>
  </article>
</template>

<style scoped>
/* panel shell + compact row buttons + coil dots (shared play primitives) */
.play-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.03),
    0 12px 30px -18px rgb(0 0 0 / 0.7);
}

.source-panel {
  flex: 1 1 50%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.play-panel__head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 0 0 auto;
  padding: 0.45rem 0.9rem 0;
}

.play-panel__head .segmented--tabs {
  display: flex;
  flex: 1;
}

.row-btn {
  position: relative;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: var(--panel-2);
  border: 1px solid var(--line-strong);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  transition: 0.13s;
  padding: 0;
}

.row-btn:hover {
  color: var(--volt);
  border-color: var(--volt);
}

.row-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.row-btn:disabled:hover {
  color: var(--text-dim);
  border-color: var(--line-strong);
}

.coil-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
}

.coil-dot {
  width: 4px;
  height: 11px;
  border-radius: 2px;
  background: var(--c);
}

/* speaker (2nd output) indicator — matches the plasma colour used for the speaker lane elsewhere */
.speaker-flag {
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
  color: var(--plasma);
  font-size: var(--fs-xs);
}

/* search row */
.play-pick {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1rem;
  flex: 0 0 auto;
}

.play-search {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.play-search .text-field {
  width: 100%;
  padding-left: 2.2rem;
}

.play-search__icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-mute);
  pointer-events: none;
  font-size: var(--fs-md);
}

.coil-select {
  flex: 0 0 auto;
  width: auto;
  height: 100%;
}

.coil-select select {
  padding: 0.5rem 1.9rem 0.5rem 0.7rem;
  height: 100%;
  font-size: var(--fs-md);
}

/* one playlist opened: back · name · play all */
.playlist-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1rem 0.6rem;
  flex: 0 0 auto;
}

.playlist-bar__name {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  font-size: var(--fs-lg);
  color: #eef3ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-bar__play {
  flex: 0 0 auto;
  padding: 0.45rem 0.9rem;
}

/* rows + empty */
.play-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.2rem 1rem;
  color: var(--text-mute);
  text-align: center;
  font-size: var(--fs-md);
}

.play-empty :deep(.empty-stub) {
  padding: 1rem 1rem 0.6rem;
}

.play-empty__cta {
  margin-top: 0.3rem;
}

.play-rows {
  list-style: none;
  margin: 0;
  padding: 0 0.4rem 0.4rem;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* title over tags on the left; duration over coils in a right-aligned column */
.play-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.6rem;
  min-width: 0;
  border-radius: 0 var(--radius) var(--radius) 0;
  transition: background 0.13s;
}

.play-row:hover {
  background: var(--line-005);
}

/* the song on air carries the micro-arc on its edge, like the active nav item */
.play-row.is-current {
  background: var(--volt-08);
}

.play-row.is-current::before {
  content: "";
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 7px;
  background: linear-gradient(180deg, var(--arc-core), var(--arc-mid) 45%, var(--arc-deep));
  -webkit-mask: var(--micro-arc-v) center / 100% 100% no-repeat;
  mask: var(--micro-arc-v) center / 100% 100% no-repeat;
}

.play-row.is-current .row-btn--play {
  color: var(--on-grad);
  background: var(--grad);
  border-color: transparent;
}

.play-row.is-incompatible {
  opacity: 0.5;
}

.play-row__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

/* a playlist row opens the playlist: the text block is the button */
.play-row__open {
  background: none;
  border: 0;
  padding: 0;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.play-row__name {
  min-width: 0;
  font-weight: 600;
  font-size: var(--fs-lg);
  color: #eef3ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-row__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--text-mute);
}

.play-row__dur {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.play-row__end {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.play-row__facts {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
  font-size: var(--fs-xs);
}

.play-row__acts {
  display: flex;
  gap: 0.35rem;
}

/* pointer devices: the actions swap in over the facts (same cell, so nothing shifts) */
@media (hover: hover) {
  .play-row__end {
    display: grid;
    justify-items: end;
  }

  .play-row__facts,
  .play-row__acts {
    grid-area: 1 / 1;
    transition: opacity 0.13s;
  }

  .play-row__acts {
    opacity: 0;
  }

  .play-row:hover .play-row__acts,
  .play-row:focus-within .play-row__acts {
    opacity: 1;
  }

  .play-row:hover .play-row__facts,
  .play-row:focus-within .play-row__facts {
    opacity: 0;
  }
}

.incompat-flag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
  color: var(--coil-1);
  font-size: var(--fs-xs);
}

.song-tag-pill {
  font-size: var(--fs-xs);
  font-weight: 500;
  padding: 0 0.45rem;
  border-radius: var(--radius-pill);
  color: var(--tag-c);
  background-color: color-mix(in srgb, var(--tag-c) 12%, transparent);
  white-space: nowrap;
}

.play-new {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0.9rem 0.9rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  border: 1px dashed var(--line-strong);
  color: var(--text-dim);
  font-weight: 500;
  text-decoration: none;
  flex: 0 0 auto;
}

.play-new:hover {
  color: var(--volt);
  border-color: var(--volt);
}

@media (max-width: 1000px) {
  .play-rows {
    max-height: 20rem;
    -ms-overflow-style: none !important;
    scrollbar-width: none !important;
  }

  .play-rows::-webkit-scrollbar {
    display: none !important;
  }

  /* touch targets */
  .play-row {
    min-height: 52px;
  }

  .row-btn {
    width: 2.4rem;
    height: 2.4rem;
  }
}
</style>
