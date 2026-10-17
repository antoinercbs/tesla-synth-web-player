<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { formatDuration, formatEditDate } from '@/utils/format';
import { search as searchItems } from '@/utils/search';
import { coilColor } from '@/ui/coil-colors';
import { mobileLayout } from '@/ui/viewport';
import { ICONS } from '@/ui/icons';
import type { AppTag, Playlist, Song } from '@/types/domain';
import EmptyState from '@/components/ui/EmptyState.vue';
import SearchField from '@/components/ui/SearchField.vue';
import DataTable from '@/components/ui/DataTable.vue';
import DropMenu from '@/components/ui/DropMenu.vue';
import UsageMenu from '@/components/ui/UsageMenu.vue';
import LibraryConfirm from '@/components/ui/LibraryConfirm.vue';
import SelectionBar from '@/components/ui/SelectionBar.vue';
import AddToPlaylistModal from '@/components/playlists/AddToPlaylistModal.vue';
import NewSongModal from '@/components/editor/NewSongModal.vue';
import { songPayload } from '@/midi/song-payload';
import { createSongsFromFiles, duplicateSong } from '@/midi/song-file';
import { useFileDrop } from '@/utils/file-drop';
import { notify } from '@/utils/toast';
import { serverMessage } from '@/utils/http';
import type { DataColumn, Usage } from '@/components/ui/data-table';

/**
 * The songs: search, a new song, the table. A row opens the song in the
 * editor; its menu adds it to a playlist, copies or deletes it; ticked rows get
 * the same, and tags, from the selection bar. A song is its MIDI file: one
 * dropped on the list becomes a new song.
 */
const { t, locale } = useI18n();
const router = useRouter();
const midiStore = useMidiStore();

const search = ref('');
// one song (its menu) or the ticked ones
const pendingDelete = ref<Song[]>([]);
const selectedIds = ref<(number | string)[]>([]);
const selectedSongs = computed(() => midiStore.midiSongList.filter((s) => selectedIds.value.includes(s.id)));
const addingToPlaylist = ref<Song[]>([]);

// found by its name, its file's, its tags', its playlists' or its last editor's
const filtered = computed<Song[]>(() =>
  searchItems(midiStore.midiSongList, search.value, (s) => [
    s.name,
    s.midiFile?.name,
    s.editorName,
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
const editorOptions = computed(() => [
  ...[...new Set(midiStore.midiSongList.map((s) => s.editorName).filter((n): n is string => !!n))]
    .sort((a, b) => a.localeCompare(b))
    .map((n) => ({ value: n, label: n })),
  { value: NONE, label: t('label.noEditor') },
]);
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
  { key: 'duration', label: t('label.duration'), width: '5rem', narrowWidth: '4.2rem', num: true, sort: (s) => s.midiFile?.durationMs },
  {
    key: 'coils', label: t('label.coilsShort'), width: '6rem', sort: (s) => s.coilCount,
    filter: { options: coilOptions.value, values: (s) => s.coilCount },
  },
  {
    key: 'playlists', label: t('label.inPlaylists'), width: '8rem', narrowWidth: '6.8rem', sort: (s) => playlistsOf(s).length,
    filter: { options: playlistOptions.value, values: (s) => (playlistsOf(s).length ? playlistsOf(s).map((p) => p.key) : NONE) },
  },
  {
    key: 'edited', label: t('label.lastEdit'), width: 'minmax(0, 13rem)', hide: 'narrow', sort: (s) => s.updatedAt,
    filter: { options: editorOptions.value, values: (s) => s.editorName || NONE },
  },
]);
function editedTitle(s: Song): string | undefined {
  const name = s.editorName;
  if (!s.updatedAt) return name ? t('auth.lastEditedBy', { name }) : undefined;
  const date = new Date(s.updatedAt).toLocaleString(locale.value, { dateStyle: 'long', timeStyle: 'short' });
  return name ? t('label.editedOnBy', { date, name }) : t('label.editedOn', { date });
}

function coilChips(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
function usesSpeaker(s: Song): boolean { return (s.output2Mask ?? 0) !== 0; }
const editRoute = (s: Song) => ({ name: 'edit', params: { id: String(s.id) } });

const deleteMessage = computed(() =>
  pendingDelete.value.length > 1 ? t('label.deleteSongs', { n: pendingDelete.value.length }) : undefined,
);
async function confirmDelete(): Promise<void> {
  const songs = pendingDelete.value;
  pendingDelete.value = [];
  for (const s of songs) {
    try {
      await axios.delete(`/api/songs/${s.id}`);
      midiStore.deleteMidiSong(s.id);
    } catch (err) {
      console.error('Song delete failed', err);
      notify('label.deleteFailed', 'error');
      break;
    }
  }
  selectedIds.value = [];
}

/* ------------------------------------------------- tags, on the selection */
const allTags = computed<AppTag[]>(() => midiStore.tagList ?? []);
function tagState(tag: AppTag): 'all' | 'some' | 'none' {
  const n = selectedSongs.value.filter((s) => (s.tags ?? []).some((x) => x.id === tag.id)).length;
  return n === 0 ? 'none' : n === selectedSongs.value.length ? 'all' : 'some';
}
// on all of them, or off all of them when they all have it
async function toggleTag(tag: AppTag): Promise<void> {
  if (tag.id == null) return;
  const off = tagState(tag) === 'all';
  for (const s of selectedSongs.value) {
    const ids = (s.tags ?? []).map((x) => x.id).filter((id): id is number => id != null);
    const has = ids.includes(tag.id);
    if (off === !has) continue;
    try {
      const { data } = await axios.put<Song>(`/api/songs/${s.id}`, songPayload(s, off ? ids.filter((id) => id !== tag.id) : [...ids, tag.id]));
      midiStore.updateMidiSong(data);
    } catch (err) {
      const why = serverMessage(err);
      notify(why ? `${t('label.saveFailed')} : ${why}` : 'label.saveFailed', 'error');
      return;
    }
  }
}
const tagIcon = { all: 'fa-square-check', some: 'fa-square-minus', none: 'fa-square' } as const;

/* ------------------------------------------ a new song: from its MIDI file */
const creating = ref(false);
function openCreated(songs: Song[]): void {
  creating.value = false;
  if (songs.length > 1) notify(t('label.songsCreated', songs.length), 'info');
  router.push({ name: 'edit', params: { id: String(songs[0].id) } });
}
const importing = ref(false);
async function onFilesDropped(files: FileList): Promise<void> {
  if (importing.value) return;
  importing.value = true;
  try {
    const made = await createSongsFromFiles([...files]);
    if (made.length) openCreated(made);
    else notify('label.notAMidiFile', 'error');
  } catch (err) {
    console.error('MIDI upload failed', err);
    const why = serverMessage(err);
    notify(why ? `${t('label.uploadFailed')} : ${why}` : 'label.uploadFailed', 'error');
  } finally {
    importing.value = false;
  }
}
async function duplicate(s: Song): Promise<void> {
  try {
    const copy = await duplicateSong(s, t('label.copyOf', { name: s.name || `#${s.id}` }));
    router.push({ name: 'edit', params: { id: String(copy.id) } });
  } catch (err) {
    console.error('Duplicate failed', err);
    const why = serverMessage(err);
    notify(why ? `${t('label.saveFailed')} : ${why}` : 'label.saveFailed', 'error');
  }
}
const { active: dragActive, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop(onFilesDropped);
</script>

<template>
  <div class="lib" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <div class="lib__bar">
      <search-field v-model="search" :placeholder="$t('label.searchSong')" />
      <button class="btn btn--volt" type="button" @click="creating = true">
        <span class="icon"><i class="fas fa-file-circle-plus"></i></span>
        <span>{{ $t('label.newSong') }}</span>
      </button>
    </div>
    <p class="lib__hint">{{ $t('label.dropMidiForSong') }}</p>

    <library-confirm v-if="pendingDelete.length" :name="pendingDelete[0].name || `#${pendingDelete[0].id}`"
      :message="deleteMessage" @confirm="confirmDelete" @cancel="pendingDelete = []" />

    <data-table v-model:selected="selectedIds" :columns="columns" :rows="filtered" :row-key="(s) => s.id"
      actions-width="2rem" :default-sort="{ key: 'name', dir: 'asc' }" storage-key="songs" selectable>
      <template #cell-name="{ row: s }">
        <router-link class="data-table__name" :to="editRoute(s)">{{ s.name || `#${s.id}` }}</router-link>
      </template>
      <template #cell-tags="{ row: s }">
        <span class="data-table__chips">
          <span v-for="tag in s.tags ?? []" :key="tag.id ?? tag.name" class="song-tag-pill" :style="{ '--tag-c': tag.color }">{{ tag.name }}</span>
        </span>
      </template>
      <template #cell-duration="{ row: s }">{{ formatDuration(s.midiFile?.durationMs) }}</template>
      <template #cell-coils="{ row: s }">
        <span class="coil-dots" :title="$t('label.coilsCount', s.coilCount)">
          <span v-for="i in coilChips(s.coilCount)" :key="i" class="coil-dot" :style="{ '--c': coilColor(i) }"></span>
          <span v-if="usesSpeaker(s)" class="speaker-flag" :title="$t('label.usesSpeaker')"><i class="fas" :class="ICONS.speakers"></i></span>
        </span>
      </template>
      <template #cell-edited="{ row: s }">
        <span class="data-table__text" :title="editedTitle(s)">
          {{ formatEditDate(s.updatedAt, locale) }}<template v-if="s.editorName"> · <span class="lib__editor">{{ s.editorName }}</span></template>
        </span>
      </template>
      <template #cell-playlists="{ row: s }">
        <usage-menu :items="playlistsOf(s)" :count="$t('label.playlistsCount', playlistsOf(s).length)" :header="$t('label.inPlaylistsHeader')" />
      </template>
      <template #actions="{ row: s }">
        <drop-menu>
          <button class="dropdown__item" type="button" @click="addingToPlaylist = [s]">
            <i class="fas fa-list-ul"></i>
            <span>{{ $t('playlistAdd.action') }}</span>
          </button>
          <button class="dropdown__item" type="button" @click="duplicate(s)">
            <i class="fas fa-clone"></i>
            <span>{{ $t('label.duplicate') }}</span>
          </button>
          <router-link v-if="s.midiFile && !mobileLayout" class="dropdown__item" :to="{ name: 'midi-edit', params: { id: String(s.id) } }">
            <i class="fas fa-pen-to-square"></i>
            <span>{{ $t('midiEditor.open') }}</span>
          </router-link>
          <div class="dropdown__divider"></div>
          <button class="dropdown__item is-danger" type="button" @click="pendingDelete = [s]">
            <i class="fas fa-trash"></i>
            <span>{{ $t('label.delete') }}</span>
          </button>
        </drop-menu>
      </template>
      <template #empty>
        <template v-if="midiStore.midiSongList.length === 0">
          <empty-state variant="stub" icon="fa-music">{{ $t('label.noSongsYet') }}</empty-state>
          <button class="btn btn--volt" type="button" @click="creating = true">
            <span class="icon"><i class="fas fa-file-circle-plus"></i></span>
            <span>{{ $t('label.newSong') }}</span>
          </button>
        </template>
        <template v-else>{{ $t('label.noSongFound') }}</template>
      </template>
    </data-table>

    <selection-bar v-if="selectedSongs.length" :count="selectedSongs.length" :label="$t('label.selectedSongs', selectedSongs.length)"
      @clear="selectedIds = []">
      <button class="btn" type="button" @click="addingToPlaylist = selectedSongs">
        <span class="icon"><i class="fas fa-list-ul"></i></span>{{ $t('playlistAdd.action') }}
      </button>
      <drop-menu v-if="allTags.length" trigger-class="btn" :label="$t('label.tags')">
        <template #trigger><span class="icon"><i class="fas fa-tags"></i></span>{{ $t('label.tags') }}</template>
        <button v-for="tag in allTags" :key="tag.id" class="dropdown__item" type="button" @click="toggleTag(tag)">
          <i class="far" :class="tagIcon[tagState(tag)]"></i>
          <span class="song-tag-pill" :style="{ '--tag-c': tag.color }">{{ tag.name }}</span>
        </button>
      </drop-menu>
      <button class="btn btn--danger-ghost" type="button" @click="pendingDelete = selectedSongs">
        <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.delete') }}
      </button>
    </selection-bar>

    <div v-if="dragActive || importing" class="lib__drop">
      <span class="lib__drop-icon"><i class="fas" :class="importing ? 'fa-spinner fa-spin' : 'fa-file-circle-plus'"></i></span>
      <span>{{ $t('label.dropToCreateSong') }}</span>
    </div>

    <add-to-playlist-modal :open="addingToPlaylist.length > 0" :songs="addingToPlaylist" @close="addingToPlaylist = []"
      @added="loadPlaylists" />
    <new-song-modal :open="creating" @close="creating = false" @created="openCreated" />
  </div>
</template>
