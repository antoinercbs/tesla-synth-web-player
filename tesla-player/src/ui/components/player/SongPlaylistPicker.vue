<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/app/stores/midi';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import EmptyState from '@/ui/components/ui/EmptyState.vue';
import SearchField from '@/ui/components/ui/SearchField.vue';
import AddToPlaylistModal from '@/ui/components/playlists/AddToPlaylistModal.vue';
import CoilDots from '@/ui/components/ui/CoilDots.vue';
import SongDetails from '@/ui/components/ui/SongDetails.vue';
import { PhyStage } from '@/model/coils/stage';
import { formatDuration } from '@/utils/format';
import { search as searchItems } from '@/utils/search';
import type { Song, Playlist } from '@/model/domain';
import { ICONS } from '@/ui/helpers/icons';
import { beginner } from '@/ui/helpers/ui-mode';

/**
 * The playback source picker: songs library (search) and playlists, and the
 * queue's tab when the parent gives one (`queue` slot). Both lists hold the
 * songs that play on the stage wired now (one of their variants fits it, twins
 * included: model/coils/scene.ts); "show all" brings back the others, marked with
 * what they lack. Without an inventory, the songs filter by coil count.
 * Presentational — it emits intent (play-now / enqueue / edit /
 * play-playlist); the queue lives in the parent. `currentId` drives the
 * now-playing highlight.
 */
const props = defineProps<{
  currentId: number | null;
  /** The queue tab's label (its length): the tab shows with the `queue` slot. */
  queueLabel?: string;
}>();
const slots = defineSlots<{ queue?: () => unknown }>();
const emit = defineEmits<{
  (e: 'play-now', song: Song): void;
  (e: 'enqueue', song: Song): void;
  (e: 'play-playlist', songs: Song[]): void;
}>();

const midiStore = useMidiStore();
const { t } = useI18n();

type Source = 'songs' | 'playlists' | 'queue';
const source = defineModel<Source>('source', { default: 'songs' });
const tabs = computed(() => [
  { value: 'songs' as const, label: t('label.sourceSongs'), icon: 'fa-music' },
  { value: 'playlists' as const, label: t('label.sourcePlaylists'), icon: 'fa-list' },
  ...(slots.queue ? [{ value: 'queue' as const, label: props.queueLabel ?? t('label.upNext'), icon: 'fa-list-ol' }] : []),
]);
const songs = computed<Song[]>(() => midiStore.midiSongList);

// the stage wired now: the songs that play on it, the others behind "show all"
const staged = computed(() => midiStore.coilList.length > 0);
const SHOW_ALL_KEY = 'playShowAll';
const showAllSet = ref(localStorage.getItem(SHOW_ALL_KEY) === '1');
watch(showAllSet, (v) => {
  try { localStorage.setItem(SHOW_ALL_KEY, v ? '1' : '0'); } catch { /* for the visit */ }
});
// a beginner sees only the songs that play here (ui/helpers/ui-mode.ts)
const showAll = computed({ get: () => showAllSet.value && !beginner.value, set: (v: boolean) => { showAllSet.value = v; } });
const fits = (s: Song): boolean => new PhyStage(midiStore.coilList).playsHere(s, midiStore.outputOf);
const misfitTitle = (s: Song): string => t('stage.missing', { names: new PhyStage(midiStore.coilList).missingHere(s, midiStore.outputOf).join(', ') });
const hiddenSongs = computed(() => (staged.value ? songs.value.filter((s) => !fits(s)).length : 0));
// a dot per coil of the song's way that plays here, their names on hover
function dotsOf(s: Song): { count: number; title: string } {
  const way = new PhyStage(midiStore.coilList).chooseWay(s, midiStore.outputOf).song;
  const coils = way.coils.slice(0, way.coilCount);
  const names = staged.value ? ` · ${new PhyStage(midiStore.coilList).wayName(coils, undefined)}` : '';
  return { count: coils.length, title: `${t('label.coilsCount', coils.length)}${names}` };
}

// songs library: text search, and without an inventory a coil-count filter
const search = ref('');
const coilFilter = ref<number | null>(null); // null = all counts
const availableCoilCounts = computed(() =>
  [...new Set(songs.value.map((s) => s.coilCount))].sort((a, b) => a - b),
);
// found by its name, its tags' or its file's (utils/search.ts)
const filteredSongs = computed<Song[]>(() =>
  searchItems(
    songs.value.filter((s) => (staged.value
      ? showAll.value || fits(s)
      : coilFilter.value == null || s.coilCount === coilFilter.value)),
    search.value,
    (s) => [s.name, s.midiFile?.name, ...(s.tags ?? []).map((t) => t.name)],
  ),
);

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
    .map((s) => ({ song: s, compatible: staged.value ? fits(s) : s.coilCount === pl.coilCount }));
});
const shownEntries = computed(() => playlistEntries.value.filter((e) => e.compatible || showAll.value || !staged.value));
const hiddenEntries = computed(() => playlistEntries.value.length - shownEntries.value.length);
const compatibleSongs = computed<Song[]>(() =>
  playlistEntries.value.filter((e) => e.compatible).map((e) => e.song),
);
/** Songs of a playlist that play on the stage (what "play all" plays). */
function compatibleOf(pl: Playlist): Song[] {
  return pl.songIds
    .map((id) => songById(id))
    .filter((s): s is Song => !!s && (staged.value ? fits(s) : s.coilCount === pl.coilCount));
}
// what "play all" will last: the songs that don't play on the stage are skipped
function playlistDurationMs(pl: Playlist): number {
  return compatibleOf(pl).reduce((sum, s) => sum + (s.midiFile?.durationMs ?? 0), 0);
}
// its songs, or how many of them play on the stage when some don't
function playlistSongs(pl: Playlist): string {
  const total = pl.songIds.length;
  const plays = compatibleOf(pl).length;
  return staged.value && plays < total
    ? t('stage.playsOf', { n: plays, total }, plays)
    : t('label.songsCount', total);
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

const addingToPlaylist = ref<Song[]>([]);

// a song unfolded by the chevron at the end of its row: its variants, coils, playlists
const unfolded = ref(new Set<number>());
function toggleOpen(id: number): void {
  const next = new Set(unfolded.value);
  if (!next.delete(id)) next.add(id);
  unfolded.value = next;
}
const playlistNames = (s: Song): string[] => playlists.value.filter((p) => p.songIds.includes(s.id)).map((p) => p.name);

/** Does the song mirror any channel to the 2nd (speaker) output? */
function usesSpeaker(song: Song): boolean { return (song.output2Mask ?? 0) !== 0; }
</script>

<template>
  <article class="play-panel source-panel">
    <header class="play-panel__head">
      <segmented-control v-model="source" tabs :options="tabs" />
    </header>

    <!-- the queue, when the parent gives it -->
    <slot v-if="source === 'queue'" name="queue" />

    <!-- songs library -->
    <template v-if="source === 'songs'">
      <div class="play-pick play-pick--row">
        <search-field v-model="search" :placeholder="$t('label.search')" />
        <button v-if="staged && (hiddenSongs || showAll) && !beginner" class="coil-filter-toggle" type="button" :class="{ 'is-active': showAll }"
          :aria-pressed="showAll" :title="$t(showAll ? 'stage.hideOthers' : 'stage.showAll')" @click="showAll = !showAll">
          <span class="icon"><i class="fas" :class="showAll ? 'fa-eye' : 'fa-eye-slash'"></i></span>{{ hiddenSongs }}
        </button>
        <div v-if="!staged && availableCoilCounts.length > 1" class="select-field coil-select">
          <select v-model="coilFilter">
            <option :value="null">⚡ {{ $t('label.allCoils') }}</option>
            <option v-for="c in availableCoilCounts" :key="c" :value="c">⚡ {{ c }}</option>
          </select>
        </div>
      </div>
      <ul class="play-rows">
        <template v-for="song in filteredSongs" :key="song.id">
        <li class="play-row"
          :class="{ 'is-current': song.id === currentId, 'is-incompatible': staged && !fits(song), 'is-open': unfolded.has(song.id) }">
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
              <span v-if="staged && !fits(song)" class="incompat-flag" :title="misfitTitle(song)"><span class="icon"><i
                    class="fas fa-plug-circle-exclamation"></i></span></span>
              <coil-dots v-bind="dotsOf(song)">
                <span v-if="usesSpeaker(song)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i
                    class="fas" :class="ICONS.speakers"></i></span>
              </coil-dots>
            </div>
            <div class="play-row__acts">
              <button class="row-btn" type="button" @click="emit('enqueue', song)" :title="$t('label.addToQueue')">
                <i class="fas fa-plus"></i>
              </button>
              <button class="row-btn" type="button" @click="addingToPlaylist = [song]" :title="$t('playlistAdd.action')"
                :aria-label="$t('playlistAdd.action')">
                <i class="fas fa-list-ul"></i>
              </button>
              <RouterLink class="row-btn" :to="{ name: 'edit', params: { id: String(song.id) } }"
                :title="$t('nav.edit')">
                <i class="fas fa-pen"></i>
              </RouterLink>
            </div>
          </div>
          <button v-if="!beginner" class="row-fold" type="button" :class="{ 'is-open': unfolded.has(song.id) }" :aria-expanded="unfolded.has(song.id)"
            :title="$t(unfolded.has(song.id) ? 'table.foldDetails' : 'table.unfoldDetails')" @click="toggleOpen(song.id)">
            <i class="fas fa-chevron-down"></i>
          </button>
        </li>
        <li v-if="unfolded.has(song.id)" class="play-row__details"><song-details :song="song" :playlists="playlistNames(song)" /></li>
        </template>
        <li v-if="songs.length === 0" class="play-empty">
          <empty-state variant="stub" icon="fa-music">{{ $t('label.noSongsYet') }}</empty-state>
          <RouterLink class="btn btn--volt play-empty__cta" :to="{ name: 'edit' }">
            <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('label.newSong') }}
          </RouterLink>
        </li>
        <li v-else-if="filteredSongs.length === 0" class="play-empty">{{ hiddenSongs && !showAll && !search ? $t('stage.noneHere') : $t('label.noSongFound') }}</li>
      </ul>
    </template>

    <!-- playlists: the list itself, then one playlist's songs -->
    <template v-else-if="source === 'playlists' && !selectedPlaylist">
      <ul class="play-rows">
        <li v-for="pl in playlists" :key="pl.id" class="play-row">
          <button class="row-btn row-btn--play" type="button" :disabled="compatibleOf(pl).length === 0"
            @click="emit('play-playlist', compatibleOf(pl))" :title="$t('label.playAll')">
            <i class="fas fa-play"></i>
          </button>
          <button class="play-row__main play-row__open" type="button" @click="selectedPlaylistId = pl.id">
            <span class="play-row__name">{{ pl.name }}</span>
            <span class="play-row__meta">{{ playlistSongs(pl) }}</span>
          </button>
          <div class="play-row__end">
            <div class="play-row__facts">
              <span class="play-row__dur">{{ formatDuration(playlistDurationMs(pl)) }}</span>
              <coil-dots v-if="!staged" :count="pl.coilCount" />
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

    <template v-else-if="source === 'playlists' && selectedPlaylist">
      <div class="playlist-bar">
        <button class="row-btn" type="button" :title="$t('label.allPlaylists')" :aria-label="$t('label.allPlaylists')"
          @click="selectedPlaylistId = null">
          <i class="fas fa-arrow-left"></i>
        </button>
        <span class="playlist-bar__name">{{ selectedPlaylist.name }}</span>
        <button v-if="staged && (hiddenEntries || showAll) && !beginner" class="coil-filter-toggle" type="button" :class="{ 'is-active': showAll }"
          :aria-pressed="showAll" :title="$t(showAll ? 'stage.hideOthers' : 'stage.showAll')" @click="showAll = !showAll">
          <span class="icon"><i class="fas" :class="showAll ? 'fa-eye' : 'fa-eye-slash'"></i></span>{{ hiddenEntries }}
        </button>
        <button class="btn btn--volt playlist-bar__play" type="button" :disabled="compatibleSongs.length === 0"
          @click="emit('play-playlist', compatibleSongs)">
          <span class="icon"><i class="fas fa-play"></i></span>{{ $t('label.playAll') }}
        </button>
      </div>
      <ul class="play-rows">
        <template v-for="entry in shownEntries" :key="entry.song.id">
        <li class="play-row"
          :class="{ 'is-current': entry.song.id === currentId, 'is-incompatible': !entry.compatible, 'is-open': unfolded.has(entry.song.id) }">
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
                :title="staged ? misfitTitle(entry.song) : $t('label.incompatibleCoils', { n: entry.song.coilCount })">
                <span class="icon"><i class="fas" :class="staged ? 'fa-plug-circle-exclamation' : 'fa-triangle-exclamation'"></i></span><template
                  v-if="!staged">{{ entry.song.coilCount }}</template>
              </span>
              <coil-dots v-else v-bind="dotsOf(entry.song)">
                <span v-if="usesSpeaker(entry.song)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i
                    class="fas" :class="ICONS.speakers"></i></span>
              </coil-dots>
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
          <button v-if="!beginner" class="row-fold" type="button" :class="{ 'is-open': unfolded.has(entry.song.id) }" :aria-expanded="unfolded.has(entry.song.id)"
            :title="$t(unfolded.has(entry.song.id) ? 'table.foldDetails' : 'table.unfoldDetails')" @click="toggleOpen(entry.song.id)">
            <i class="fas fa-chevron-down"></i>
          </button>
        </li>
        <li v-if="unfolded.has(entry.song.id)" class="play-row__details">
          <song-details :song="entry.song" :playlists="playlistNames(entry.song)" />
        </li>
        </template>
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
    <add-to-playlist-modal :open="addingToPlaylist.length > 0" :songs="addingToPlaylist" @close="addingToPlaylist = []"
      @added="loadPlaylists" />
  </article>
</template>
