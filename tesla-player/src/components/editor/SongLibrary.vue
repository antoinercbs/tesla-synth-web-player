<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { formatDuration } from '@/utils/format';
import { search as searchItems } from '@/utils/search';
import { coilColor } from '@/ui/coil-colors';
import { mobileLayout } from '@/ui/viewport';
import { ICONS } from '@/ui/icons';
import type { Playlist, Song } from '@/types/domain';
import EmptyState from '@/components/ui/EmptyState.vue';
import SearchField from '@/components/ui/SearchField.vue';
import DataTable from '@/components/ui/DataTable.vue';
import DropMenu from '@/components/ui/DropMenu.vue';
import UsageMenu from '@/components/ui/UsageMenu.vue';
import LibraryConfirm from '@/components/ui/LibraryConfirm.vue';
import type { DataColumn, Usage } from '@/components/ui/data-table';

/**
 * The songs, as the MIDI files are listed (MidiLibraryPanel): search, a new
 * song, the table. A row opens the song in the editor; its menu deletes it.
 */
const { t } = useI18n();
const midiStore = useMidiStore();

const search = ref('');
const pendingDelete = ref<Song | null>(null);

// found by its name, its file's, its tags' or its playlists'
const filtered = computed<Song[]>(() =>
  searchItems(midiStore.midiSongList, search.value, (s) => [
    s.name,
    s.midiFile?.name,
    ...(s.tags ?? []).map((tag) => tag.name),
    ...playlistsOf(s).map((p) => p.label),
  ]),
);

// the playlists holding each song, before anyone deletes it
const playlists = ref<Playlist[]>([]);
function loadPlaylists(): void {
  axios.get<Playlist[]>('/api/playlists').then((r) => { playlists.value = r.data; }).catch(() => {});
}
loadPlaylists();
watch(() => midiStore.dataRevision, loadPlaylists);
function playlistsOf(s: Song): Usage[] {
  return playlists.value
    .filter((p) => p.songIds.includes(s.id))
    .map((p) => ({ key: p.id, label: p.name, to: { name: 'playlists', params: { id: String(p.id) } }, coils: p.coilCount }));
}

const NONE = '__none';
// the values to filter on, from the songs themselves
const tagOptions = computed(() => {
  const tags = new Map<string, string>();
  for (const s of midiStore.midiSongList) for (const tag of s.tags ?? []) tags.set(tag.name, tag.color);
  return [
    ...[...tags].sort(([a], [b]) => a.localeCompare(b)).map(([name, color]) => ({ value: name, label: name, color })),
    { value: NONE, label: t('label.noTag') },
  ];
});
const coilOptions = computed(() =>
  [...new Set(midiStore.midiSongList.map((s) => s.coilCount))]
    .sort((a, b) => a - b)
    .map((n) => ({ value: n, label: t('label.coilsCount', n) })),
);
const playlistOptions = computed(() => [
  ...[...playlists.value].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name })),
  { value: NONE, label: t('label.noPlaylist') },
]);

const columns = computed<DataColumn<Song>[]>(() => [
  { key: 'name', label: t('label.name'), width: 'minmax(0, 1fr)', sort: (s) => s.name },
  {
    key: 'tags', label: t('label.tags'), width: 'minmax(0, 11rem)', hide: 'narrow',
    filter: { options: tagOptions.value, values: (s) => (s.tags?.length ? s.tags.map((tag) => tag.name) : NONE) },
  },
  { key: 'file', label: t('label.midiFile'), width: 'minmax(0, 11rem)', hide: 'narrow', sort: (s) => s.midiFile?.name },
  { key: 'duration', label: t('label.duration'), width: '5rem', narrowWidth: '4.2rem', num: true, sort: (s) => s.midiFile?.durationMs },
  {
    key: 'coils', label: t('label.coilsShort'), width: '6rem', sort: (s) => s.coilCount,
    filter: { options: coilOptions.value, values: (s) => s.coilCount },
  },
  {
    key: 'playlists', label: t('label.inPlaylists'), width: '8rem', narrowWidth: '6.8rem', sort: (s) => playlistsOf(s).length,
    filter: { options: playlistOptions.value, values: (s) => (playlistsOf(s).length ? playlistsOf(s).map((p) => p.key) : NONE) },
  },
]);

function coilChips(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
function usesSpeaker(s: Song): boolean { return (s.output2Mask ?? 0) !== 0; }
const editRoute = (s: Song) => ({ name: 'edit', params: { id: String(s.id) } });

async function confirmDelete(): Promise<void> {
  const s = pendingDelete.value;
  pendingDelete.value = null;
  if (!s) return;
  try {
    await axios.delete(`/api/songs/${s.id}`);
    midiStore.deleteMidiSong(s.id);
  } catch (err) {
    console.error('Song delete failed', err);
  }
}
</script>

<template>
  <div class="lib">
    <div class="lib__bar">
      <search-field v-model="search" :placeholder="$t('label.searchSong')" />
      <router-link class="btn btn--volt" :to="{ name: 'edit', params: { id: 'new' } }">
        <span class="icon"><i class="fas fa-file-circle-plus"></i></span>
        <span>{{ $t('label.newSong') }}</span>
      </router-link>
    </div>

    <library-confirm v-if="pendingDelete" :name="pendingDelete.name || `#${pendingDelete.id}`" @confirm="confirmDelete"
      @cancel="pendingDelete = null" />

    <data-table :columns="columns" :rows="filtered" :row-key="(s) => s.id" :row-to="editRoute" actions-width="2rem"
      :default-sort="{ key: 'name', dir: 'asc' }" storage-key="songs">
      <template #cell-name="{ row: s }">
        <router-link class="data-table__name" :to="editRoute(s)">{{ s.name || `#${s.id}` }}</router-link>
      </template>
      <template #cell-tags="{ row: s }">
        <span class="data-table__chips">
          <span v-for="tag in s.tags ?? []" :key="tag.id ?? tag.name" class="song-tag-pill" :style="{ '--tag-c': tag.color }">{{ tag.name }}</span>
        </span>
      </template>
      <template #cell-file="{ row: s }">
        <span class="data-table__text" :title="s.midiFile?.name">{{ s.midiFile?.name ?? '—' }}</span>
      </template>
      <template #cell-duration="{ row: s }">{{ formatDuration(s.midiFile?.durationMs) }}</template>
      <template #cell-coils="{ row: s }">
        <span class="coil-dots" :title="$t('label.coilsCount', s.coilCount)">
          <span v-for="i in coilChips(s.coilCount)" :key="i" class="coil-dot" :style="{ '--c': coilColor(i) }"></span>
          <span v-if="usesSpeaker(s)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i class="fas" :class="ICONS.speakers"></i></span>
        </span>
      </template>
      <template #cell-playlists="{ row: s }">
        <usage-menu :items="playlistsOf(s)" :count="$t('label.playlistsCount', playlistsOf(s).length)" :header="$t('label.inPlaylistsHeader')" />
      </template>
      <template #actions="{ row: s }">
        <drop-menu>
          <router-link v-if="s.midiFile && !mobileLayout" class="dropdown__item" :to="{ name: 'midi-edit', params: { id: s.midiFile.id } }">
            <i class="fas fa-pen-to-square"></i>
            <span>{{ $t('midiEditor.open') }}</span>
          </router-link>
          <div v-if="s.midiFile && !mobileLayout" class="dropdown__divider"></div>
          <button class="dropdown__item is-danger" type="button" @click="pendingDelete = s">
            <i class="fas fa-trash"></i>
            <span>{{ $t('label.delete') }}</span>
          </button>
        </drop-menu>
      </template>
      <template #empty>
        <template v-if="midiStore.midiSongList.length === 0">
          <empty-state variant="stub" icon="fa-music">{{ $t('label.noSongsYet') }}</empty-state>
          <router-link class="btn btn--volt" :to="{ name: 'edit', params: { id: 'new' } }">
            <span class="icon"><i class="fas fa-file-circle-plus"></i></span>
            <span>{{ $t('label.newSong') }}</span>
          </router-link>
        </template>
        <template v-else>{{ $t('label.noSongFound') }}</template>
      </template>
    </data-table>
  </div>
</template>
