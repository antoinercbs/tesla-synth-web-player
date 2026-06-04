<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import SearchableSelect from '@/components/ui/SearchableSelect.vue';
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
  (e: 'edit', song: Song): void;
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
  playlists.value.map((p) => ({ id: p.id, label: `${p.name} · ${p.coilCount} ⚡` })),
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

function coilChips(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
/** Does the song mirror any channel to the 2nd (speaker) output? */
function usesSpeaker(song: Song): boolean { return (song.output2Mask ?? 0) !== 0; }
</script>

<template>
  <article class="play-panel source-panel">
    <header class="play-panel__head">
      <segmented-control v-model="source" fill :options="[
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
        <li v-for="song in filteredSongs" :key="song.id" class="play-row" :class="{ 'is-current': song.id === currentId }">
          <button class="row-btn row-btn--play" type="button" @click="emit('play-now', song)" :title="$t('label.playNow')">
            <i class="fas" :class="song.id === currentId ? 'fa-volume-high' : 'fa-play'"></i>
          </button>
          <button class="row-btn" type="button" @click="emit('enqueue', song)" :title="$t('label.addToQueue')">
            <i class="fas fa-plus"></i>
          </button>
          <span class="play-row__name">{{ song.name }}</span>
          <span class="play-row__dur">{{ formatDuration(song.midiFile?.durationMs) }}</span>
          <span class="coil-dots">
            <span v-for="i in coilChips(song.coilCount)" :key="i" class="coil-dot" :style="{ '--c': coilColor(i) }"></span>
            <span v-if="usesSpeaker(song)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i class="fas fa-volume-high"></i></span>
          </span>
          <button class="row-btn" type="button" @click="emit('edit', song)" :title="$t('nav.edit')">
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
            <button class="row-btn" type="button" :disabled="!entry.compatible"
              @click="entry.compatible && emit('enqueue', entry.song)" :title="$t('label.addToQueue')">
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
              <span v-if="usesSpeaker(entry.song)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i class="fas fa-volume-high"></i></span>
            </span>
            <button class="row-btn" type="button" @click="emit('edit', entry.song)" :title="$t('nav.edit')">
              <i class="fas fa-pen"></i>
            </button>
          </li>
          <li v-if="playlistEntries.length === 0" class="play-empty">{{ $t('label.emptyPlaylist') }}</li>
          <li v-else-if="compatibleSongs.length === 0" class="play-empty">{{ $t('label.noCompatibleSongs') }}</li>
        </ul>
      </template>
      <empty-state v-else variant="stub" icon="fa-list">{{ $t('label.pickPlaylist') }}</empty-state>
    </template>
  </article>
</template>

<style scoped>
/* panel shell + compact row buttons + coil dots (shared play primitives) */
.play-panel {
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
}
.source-panel { flex: 1 1 50%; min-height: 0; display: flex; flex-direction: column; }
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
.row-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.row-btn:disabled:hover { color: var(--text-dim); border-color: var(--line-strong); }
.row-btn--play:hover { color: var(--plasma); border-color: var(--plasma); }
.coil-dots { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.coil-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px -1px var(--c); }
/* speaker (2nd output) indicator — matches the plasma colour used for the speaker lane elsewhere */
.speaker-flag { display: inline-flex; align-items: center; margin-left: 2px; color: var(--plasma); font-size: 0.7rem; }

/* search row */
.play-pick { display: flex; align-items: center; gap: 0.6rem; padding: 0.8rem 1rem; flex: 0 0 auto; }
.play-pick--combo { display: block; }
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
  background: var(--volt-10); border: 1px solid var(--line-strong);
  color: var(--volt); font-family: var(--font-mono); font-weight: 600; font-size: 0.85rem;
}
.playlist-bar__play { flex: 1 1 auto; justify-content: center; padding: 0.45rem 0.9rem; }

/* rows + empty */
.play-empty { padding: 1.2rem 1rem; color: var(--text-mute); text-align: center; font-family: var(--font-mono); font-size: 0.85rem; }
.play-rows { list-style: none; margin: 0; padding: 0; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.play-row {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.5rem 1rem; min-width: 0;
  border-top: 1px solid var(--line); transition: background 0.13s;
}
.play-row:hover { background: var(--line-005); }
.play-row.is-current { background: var(--volt-08); }
.play-row.is-incompatible { opacity: 0.5; }
.play-row__name {
  flex: 1 1 auto; min-width: 0; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.play-row.is-current .play-row__name { color: var(--volt); }
.play-row__dur { flex: 0 0 auto; color: var(--text-mute); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.incompat-flag {
  display: inline-flex; align-items: center; gap: 0.25rem; flex: 0 0 auto;
  color: var(--coil-1); font-family: var(--font-mono); font-size: 0.78rem;
}
</style>
