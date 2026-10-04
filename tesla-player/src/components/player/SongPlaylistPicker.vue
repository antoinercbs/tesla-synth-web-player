<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { coilColor } from '@/ui/coil-colors';
import { formatDuration } from '@/utils/format';
import type { Song, Playlist } from '@/types/domain';
import { ICONS } from '@/ui/icons';

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
// what "play all" will last: the songs of another coil count are skipped
function playlistDurationMs(pl: Playlist): number {
  return compatibleOf(pl).reduce((sum, s) => sum + (s.midiFile?.durationMs ?? 0), 0);
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
            <i class="fas" :class="song.id === currentId ? ICONS.nowPlaying : 'fa-play'"></i>
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
                    class="fas" :class="ICONS.speakers"></i></span>
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
            <i class="fas" :class="entry.song.id === currentId ? ICONS.nowPlaying : 'fa-play'"></i>
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
                    class="fas" :class="ICONS.speakers"></i></span>
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
