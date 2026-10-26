<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/app/stores/midi';
import { formatDuration, hasUnknownDuration, totalDurationMs } from '@/utils/format';
import { search as searchItems } from '@/utils/search';
import CoilDots from '@/ui/components/ui/CoilDots.vue';
import { PhyStage } from '@/model/coils/stage';
import type { Playlist, Song } from '@/model/domain';
import EmptyState from '@/ui/components/ui/EmptyState.vue';
import SearchField from '@/ui/components/ui/SearchField.vue';
import DataTable from '@/ui/components/ui/DataTable.vue';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import LibraryConfirm from '@/ui/components/ui/LibraryConfirm.vue';
import SelectionBar from '@/ui/components/ui/SelectionBar.vue';
import type { DataColumn } from '@/ui/components/ui/data-table';

/**
 * The playlists, as the MIDI files are listed (MidiLibraryPanel): search, a new
 * playlist, the table. A row opens the playlist in its editor; its menu, or the
 * selection bar for the ticked ones, deletes it. The list is the page's
 * (PlaylistsView), told of a delete by `deleted`.
 */
const props = defineProps<{ playlists: Playlist[]; loading: boolean }>();
const emit = defineEmits<{ (e: 'deleted', id: number): void }>();

const { t } = useI18n();
const midiStore = useMidiStore();

const search = ref('');
// one playlist (its menu) or the ticked ones
const pendingDelete = ref<Playlist[]>([]);
const selectedIds = ref<(number | string)[]>([]);
const selectedPlaylists = computed(() => props.playlists.filter((p) => selectedIds.value.includes(p.id)));
const deleteMessage = computed(() =>
  pendingDelete.value.length > 1 ? t('label.deletePlaylists', { n: pendingDelete.value.length }) : undefined,
);

const songsById = computed(() => new Map(midiStore.midiSongList.map((s) => [s.id, s])));
// found by its name or a song's it holds
const filtered = computed<Playlist[]>(() =>
  searchItems(props.playlists, search.value, (p) => [p.name, ...p.songIds.map((id) => songsById.value.get(id)?.name)]),
);
// what "play all" plays, and so lasts: the songs with a variant that fits the stage wired now
// (without an inventory, those made for the playlist's coil count)
function playedSongs(p: Playlist): Song[] {
  const fits = (s: Song) => (midiStore.coilList.length ? new PhyStage(midiStore.coilList).playsHere(s, midiStore.outputOf) : s.coilCount === p.coilCount);
  return p.songIds.map((id) => songsById.value.get(id)).filter((s): s is Song => !!s && fits(s));
}
function durationLabel(p: Playlist): string {
  const songs = playedSongs(p);
  const label = formatDuration(totalDurationMs(songs));
  return hasUnknownDuration(songs) ? `~${label}` : label;
}

const coilOptions = computed(() =>
  [...new Set(props.playlists.map((p) => p.coilCount))]
    .sort((a, b) => a - b)
    .map((n) => ({ value: n, label: t('label.coilsCount', n) })),
);

// with the inventory, the songs are checked against the coils wired, not a count of the playlist's
const columns = computed<DataColumn<Playlist>[]>(() => [
  { key: 'name', label: t('label.name'), width: 'minmax(0, 1fr)', sort: (p) => p.name },
  { key: 'songs', label: t('label.sourceSongs'), width: '6.4rem', narrowWidth: '5.6rem', num: true, sort: (p) => p.songIds.length },
  { key: 'duration', label: t('label.duration'), width: '5rem', narrowWidth: '4.4rem', num: true, sort: (p) => totalDurationMs(playedSongs(p)) },
  ...(midiStore.coilList.length ? [] : [{
    key: 'coils', label: t('label.coilsShort'), width: '6rem', sort: (p: Playlist) => p.coilCount,
    filter: { options: coilOptions.value, values: (p: Playlist) => p.coilCount },
  }]),
]);
const editRoute = (p: Playlist) => ({ name: 'playlists', params: { id: String(p.id) } });

async function confirmDelete(): Promise<void> {
  const targets = pendingDelete.value;
  pendingDelete.value = [];
  for (const p of targets) {
    try {
      await axios.delete(`/api/playlists/${p.id}`);
      emit('deleted', p.id);
    } catch (err) {
      console.error('Playlist delete failed', err);
      break;
    }
  }
  selectedIds.value = [];
}
</script>

<template>
  <div class="lib">
    <div class="lib__bar">
      <search-field v-model="search" :placeholder="$t('label.searchPlaylist')" />
      <router-link class="btn btn--volt" :to="{ name: 'playlists', params: { id: 'new' } }">
        <span class="icon"><i class="fas fa-plus"></i></span>
        <span>{{ $t('label.newPlaylist') }}</span>
      </router-link>
    </div>

    <library-confirm v-if="pendingDelete.length" :name="pendingDelete[0].name" :message="deleteMessage"
      @confirm="confirmDelete" @cancel="pendingDelete = []" />

    <data-table v-model:selected="selectedIds" :columns="columns" :rows="filtered" :row-key="(p) => p.id"
      actions-width="2rem" :default-sort="{ key: 'name', dir: 'asc' }" storage-key="playlists" selectable>
      <template #cell-name="{ row: p }">
        <router-link class="data-table__name" :to="editRoute(p)">{{ p.name }}</router-link>
      </template>
      <!-- the ones that will be skipped show as what plays out of all -->
      <template #cell-songs="{ row: p }">
        <span v-if="playedSongs(p).length < p.songIds.length" class="pl-skips" :title="$t('stage.playableHint')">{{
          playedSongs(p).length }} / {{ p.songIds.length }}</span>
        <template v-else>{{ p.songIds.length }}</template>
      </template>
      <template #cell-duration="{ row: p }">{{ durationLabel(p) }}</template>
      <template #cell-coils="{ row: p }"><coil-dots :count="p.coilCount" /></template>
      <template #actions="{ row: p }">
        <drop-menu>
          <button class="dropdown__item is-danger" type="button" @click="pendingDelete = [p]">
            <i class="fas fa-trash"></i>
            <span>{{ $t('label.delete') }}</span>
          </button>
        </drop-menu>
      </template>
      <template #empty>
        <span v-if="loading" class="arc-loader" role="status" :aria-label="$t('label.loading')"></span>
        <template v-else-if="playlists.length === 0">
          <empty-state variant="stub" icon="fa-list">{{ $t('label.noPlaylistsYet') }}</empty-state>
          <router-link class="btn btn--volt" :to="{ name: 'playlists', params: { id: 'new' } }">
            <span class="icon"><i class="fas fa-plus"></i></span>
            <span>{{ $t('label.newPlaylist') }}</span>
          </router-link>
        </template>
        <template v-else>{{ $t('label.noPlaylistFound') }}</template>
      </template>
    </data-table>

    <selection-bar v-if="selectedPlaylists.length" :count="selectedPlaylists.length"
      :label="$t('label.selectedPlaylists', selectedPlaylists.length)" @clear="selectedIds = []">
      <button class="btn btn--danger-ghost" type="button" @click="pendingDelete = selectedPlaylists">
        <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.delete') }}
      </button>
    </selection-bar>
  </div>
</template>
