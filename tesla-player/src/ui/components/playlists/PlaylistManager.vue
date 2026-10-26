<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/app/stores/midi';
import { useLeaveGuard } from '@/ui/helpers/leave-guard';
import { useScrolled } from '@/ui/helpers/use-scrolled';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import SearchField from '@/ui/components/ui/SearchField.vue';
import PageTourButton from '@/ui/components/tour/PageTourButton.vue';
import { PhyStage } from '@/model/coils/stage';
import { formatDuration, totalDurationMs, hasUnknownDuration } from '@/utils/format';
import { notify } from '@/ui/helpers/toast';
import { search } from '@/utils/search';
import { MAX_COILS, MIN_COILS } from '@/model/domain';
import type { Playlist, Song } from '@/model/domain';

const props = defineProps<{ playlists: Playlist[]; playlistId: string | null }>();
const emit = defineEmits<{
  (e: 'saved', p: Playlist): void;
  (e: 'deleted', id: number): void;
}>();

const midiStore = useMidiStore();
const { t } = useI18n();
const headScrolled = useScrolled();
const coilRange = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => MIN_COILS + i);

// with the inventory, a song plays when one of its variants fits the coils wired now
// (model/coils/scene.ts); without it, by the playlist's coil count, as before
const staged = computed(() => midiStore.coilList.length > 0);
function blankDraft(): Playlist {
  return { id: 0, name: '', coilCount: midiStore.appConfig.defaultCoilCount || 3, songIds: [] };
}
const draft = ref<Playlist>(blankDraft());
// what the server holds (the blank one for a new playlist): an edit undone is no longer a change
const snapshot = (): string =>
  JSON.stringify({ name: draft.value.name, coilCount: draft.value.coilCount, songIds: draft.value.songIds });
const baseline = ref(snapshot());

/* ------------------------------------------------- the name, in the head */
const renaming = ref(false);
const nameField = ref<HTMLInputElement | null>(null);
let nameBefore = '';
function rename(): void {
  nameBefore = draft.value.name;
  renaming.value = true;
  nextTick(() => nameField.value?.select());
}
// a saved playlist is never left without a name: an empty one gives the old one back
function endRename(keep: boolean): void {
  if (!renaming.value) return;
  if (!keep || !draft.value.name.trim()) draft.value.name = nameBefore;
  renaming.value = false;
}

function show(p: Playlist): void {
  draft.value = p;
  baseline.value = snapshot();
  renaming.value = false;
}

const confirmDelete = ref(false);
const librarySearch = ref('');
const onlyCompatible = ref(false);

// load the playlist named by the route; don't clobber in-progress edits of the
// same playlist when the parent list refreshes (mirrors the song editor).
function loadDraft(): void {
  const pid = props.playlistId;
  if (pid == null || pid === 'new') { if (draft.value.id !== 0) show(blankDraft()); return; }
  const id = Number(pid);
  if (draft.value.id === id) return;
  const p = props.playlists.find((x) => x.id === id);
  show(p ? { ...p, songIds: [...p.songIds] } : blankDraft());
}
watch([() => props.playlistId, () => props.playlists], loadDraft, { immediate: true });
// a new playlist opens on its name
watch(() => props.playlistId, (pid) => { if (pid === 'new') rename(); }, { immediate: true });

const dirty = computed(() => snapshot() !== baseline.value);
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => dirty.value);

const songs = computed<Song[]>(() => midiStore.midiSongList);
function songById(id: number): Song | undefined {
  return songs.value.find((s) => s.id === id);
}
function isCompatible(song: Song | undefined): boolean {
  if (!song) return false;
  return staged.value ? new PhyStage(midiStore.coilList).playsHere(song, midiStore.outputOf) : song.coilCount === draft.value.coilCount;
}
// total play length of what will play ("~" if any track's length is unknown): the
// player skips a song that doesn't fit the stage (SongPlaylistPicker)
const playlistSongs = computed<Song[]>(
  () => draft.value.songIds.map(songById).filter((s): s is Song => s != null && isCompatible(s)),
);
const playlistTotalLabel = computed(() => {
  const label = formatDuration(totalDurationMs(playlistSongs.value));
  return hasUnknownDuration(playlistSongs.value) ? `~${label}` : label;
});
const misfit = (s: Song): string => (staged.value
  ? t('stage.missing', { names: new PhyStage(midiStore.coilList).missingHere(s, midiStore.outputOf).join(', ') })
  : t('label.incompatibleCoils', { n: s.coilCount }));

// LEFT pane: the whole library, filtered by search and (optionally) coil count
const filteredLibrary = computed(() => {
  let list = [...songs.value].sort((a, b) => a.name.localeCompare(b.name));
  if (onlyCompatible.value) list = list.filter((s) => isCompatible(s));
  return search(list, librarySearch.value, (s) => [s.name, s.midiFile?.name, ...(s.tags ?? []).map((t) => t.name)]);
});

/* ----------------------------- mutate the draft --------------------------- */
function addSong(songId: number, at?: number): void {
  if (draft.value.songIds.includes(songId)) return;
  if (at == null || at >= draft.value.songIds.length) draft.value.songIds.push(songId);
  else draft.value.songIds.splice(Math.max(0, at), 0, songId);
}
function removeSong(idx: number): void { draft.value.songIds.splice(idx, 1); }
function moveSong(from: number, to: number): void {
  const ids = draft.value.songIds;
  if (from === to) return;
  const [m] = ids.splice(from, 1);
  ids.splice(from < to ? to - 1 : to, 0, m);
}
function moveUp(idx: number): void { if (idx > 0) moveSong(idx, idx - 1); }
function moveDown(idx: number): void { if (idx < draft.value.songIds.length - 1) moveSong(idx, idx + 2); }

/* ------------------------------- drag & drop ------------------------------ */
type DragSrc = { kind: 'lib'; songId: number } | { kind: 'pl'; index: number };
const dragSource = ref<DragSrc | null>(null);
const dragOverIdx = ref<number | null>(null);
const draggingLib = computed(() => dragSource.value?.kind === 'lib');
function onLibDragStart(songId: number): void { dragSource.value = { kind: 'lib', songId }; }
function onPlDragStart(index: number): void { dragSource.value = { kind: 'pl', index }; }
function onDragEnd(): void { dragSource.value = null; dragOverIdx.value = null; }
function onDropOnItem(targetIdx: number): void {
  const d = dragSource.value; onDragEnd();
  if (!d) return;
  if (d.kind === 'lib') addSong(d.songId, targetIdx);
  else moveSong(d.index, targetIdx);
}
function onDropOnList(): void {
  const d = dragSource.value; onDragEnd();
  if (!d) return;
  if (d.kind === 'lib') addSong(d.songId);
  else moveSong(d.index, draft.value.songIds.length);
}

/* ------------------------------- persistence ------------------------------ */
const saving = ref(false);
async function savePlaylist(): Promise<void> {
  if (saving.value || !dirty.value) return;
  if (!draft.value.name.trim()) {
    notify('label.playlistNameRequired', 'error');
    rename();
    return;
  }
  saving.value = true;
  const body = { name: draft.value.name, coilCount: draft.value.coilCount, songIds: draft.value.songIds };
  try {
    const { data } = draft.value.id
      ? await axios.put<Playlist>(`/api/playlists/${draft.value.id}`, body)
      : await axios.post<Playlist>('/api/playlists', body);
    // before 'saved': a new playlist's page then moves to its id, past the leave guard
    show({ ...data, songIds: [...(data.songIds ?? [])] });
    emit('saved', data);
    notify('label.playlistSaved');
  } catch (err) {
    console.error('Playlist save failed', err);
    notify('label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}
function doDelete(): void {
  const id = draft.value.id;
  confirmDelete.value = false;
  if (!id) return;
  axios.delete(`/api/playlists/${id}`).then(() => {
    baseline.value = snapshot(); // nothing left to keep: the way back to the list must not ask
    emit('deleted', id);
  });
}

function onKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  if (!leavePending.value && !confirmDelete.value) savePlaylist();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <header class="screen-head" :class="{ 'is-scrolled': headScrolled }">
    <!-- the name: a click on it renames the playlist, like its pencil -->
    <div class="pl-name">
      <input v-if="renaming" ref="nameField" v-model="draft.name" class="text-field pl-name__field" type="text"
        maxlength="80" :placeholder="$t('label.playlistName')" :aria-label="$t('label.playlistName')"
        @keydown.enter.prevent="endRename(true)" @keydown.esc.prevent="endRename(false)" @blur="endRename(true)">
      <template v-else>
        <h1 class="view-head__title pl-name__title" :class="{ 'is-empty': !draft.name }" :title="draft.name"
          @click="rename">{{ draft.name || $t('label.newPlaylist') }}</h1>
        <button class="icon-btn icon-btn--sm pl-name__edit" type="button" :title="$t('label.renamePlaylist')"
          :aria-label="$t('label.renamePlaylist')" @click="rename"><i class="fas fa-pen"></i></button>
      </template>
      <page-tour-button v-if="!dirty" id="playlists" />
    </div>
    <router-link class="icon-btn" :to="{ name: 'playlists', params: {} }" :title="$t('label.closeEditor')"
      :aria-label="$t('label.closeEditor')">
      <i class="fas fa-xmark"></i>
    </router-link>
  </header>

  <div class="screen-body screen-body--fill">
    <article class="pl-editor">
      <!-- a server that predates the coil inventory: the songs are checked against the playlist's coil count -->
      <div v-if="!staged" class="pl-meta">
        <span class="field-label">{{ $t('label.coilCount') }}</span>
        <div class="segmented" role="group" :aria-label="$t('label.coilCount')">
          <button v-for="n in coilRange" :key="n" type="button" :aria-pressed="draft.coilCount === n"
            :class="{ 'is-active': draft.coilCount === n }" @click="draft.coilCount = n">{{ n }}</button>
        </div>
      </div>

      <!-- two panes: library (left) and the playlist (right) -->
      <div class="pl-panes">
        <!-- LIBRARY -->
        <section class="pl-pane">
          <header class="pl-pane__head">{{ $t('label.songLibrary') }}</header>
          <div class="pl-search">
            <search-field v-model="librarySearch" :placeholder="$t('label.search')" />
            <button class="coil-filter-toggle" type="button" :class="{ 'is-active': onlyCompatible }"
              :aria-pressed="onlyCompatible" :title="staged ? $t('stage.onlyFitting') : $t('label.onlyMatchingCoils')"
              @click="onlyCompatible = !onlyCompatible">{{ $t('stage.playHere') }}</button>
          </div>
          <ul class="pl-list">
            <li v-for="s in filteredLibrary" :key="s.id" class="pl-row"
              :class="{ 'is-added': draft.songIds.includes(s.id), 'is-incompatible': !isCompatible(s) }"
              draggable="true" @dragstart="onLibDragStart(s.id)" @dragend="onDragEnd">
              <span class="pl-row__grip"><i class="fas fa-grip-vertical"></i></span>
              <span class="pl-row__name">{{ s.name }}</span>
              <span class="pl-row__dur">{{ formatDuration(s.midiFile?.durationMs) }}</span>
              <span v-if="!isCompatible(s)" class="pl-incompat-flag" :title="misfit(s)">
                <i class="fas fa-triangle-exclamation"></i>
              </span>
              <button class="icon-btn pl-icon-btn" type="button" :disabled="draft.songIds.includes(s.id)"
                :title="$t('label.addToPlaylist')" :aria-label="$t('label.addToPlaylist')" @click="addSong(s.id)">
                <span class="icon"><i class="fas"
                    :class="draft.songIds.includes(s.id) ? 'fa-check' : 'fa-plus'"></i></span>
              </button>
            </li>
            <li v-if="filteredLibrary.length === 0" class="pl-empty">{{ $t('label.noSongFound') }}</li>
          </ul>
        </section>

        <!-- THE PLAYLIST (drop target) -->
        <section class="pl-pane">
          <header class="pl-pane__head">
            {{ $t('label.currentPlaylist') }}
            <span class="pl-pane__total" v-if="playlistSongs.length">{{ playlistTotalLabel }}</span>
          </header>
          <ul class="pl-list pl-list--drop" :class="{ 'is-drop': draggingLib }" @dragover.prevent
            @drop.prevent="onDropOnList">
            <li v-for="(songId, idx) in draft.songIds" :key="`${songId}-${idx}`" class="pl-row pl-row--queue"
              :class="{ 'is-incompatible': !isCompatible(songById(songId)), 'is-dragover': dragOverIdx === idx }"
              draggable="true" @dragstart="onPlDragStart(idx)" @dragend="onDragEnd" @dragover.prevent="dragOverIdx = idx"
              @drop.prevent.stop="onDropOnItem(idx)">
              <span class="pl-row__grip"><i class="fas fa-grip-vertical"></i></span>
              <span class="pl-row__idx">{{ idx + 1 }}</span>
              <span class="pl-row__name" v-if="songById(songId)">{{ songById(songId)!.name }}</span>
              <span class="pl-row__name pl-row__name--unknown" v-else>{{ $t('label.unknownSong') }}</span>
              <span class="pl-row__dur" v-if="songById(songId)">{{ formatDuration(songById(songId)!.midiFile?.durationMs)
              }}</span>
              <span v-if="songById(songId) && !isCompatible(songById(songId))" class="pl-incompat-flag"
                :title="misfit(songById(songId)!)">
                <i class="fas fa-triangle-exclamation"></i>
              </span>
              <div class="pl-row__actions">
                <button class="icon-btn pl-icon-btn" type="button" :disabled="idx === 0" :title="$t('label.moveUp')"
                  :aria-label="$t('label.moveUp')" @click="moveUp(idx)">
                  <span class="icon"><i class="fas fa-angle-up"></i></span>
                </button>
                <button class="icon-btn pl-icon-btn" type="button" :disabled="idx === draft.songIds.length - 1"
                  :title="$t('label.moveDown')" :aria-label="$t('label.moveDown')" @click="moveDown(idx)">
                  <span class="icon"><i class="fas fa-angle-down"></i></span>
                </button>
                <button class="icon-btn pl-icon-btn pl-icon-btn--danger" type="button" :title="$t('label.removeFromPlaylist')"
                  :aria-label="$t('label.removeFromPlaylist')" @click="removeSong(idx)">
                  <span class="icon"><i class="fas fa-minus"></i></span>
                </button>
              </div>
            </li>
            <li v-if="draft.songIds.length === 0" class="pl-empty pl-empty--drop">
              <span class="icon"><i class="fas fa-arrow-down-long"></i></span>{{ $t('label.dragToAdd') }}
            </li>
          </ul>
        </section>
      </div>

      <!-- sticky footer: delete (left) + save (right) -->
      <div class="pl-footer">
        <button v-if="draft.id" class="btn btn--danger-ghost" type="button" @click="confirmDelete = true">
          <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.delete') }}
        </button>
        <span v-if="dirty" class="pl-dirty"><i class="fas fa-circle"></i>{{ $t('label.unsavedChanges') }}</span>
        <button class="btn btn--volt pl-footer__save" type="button" :disabled="!dirty || saving"
          :title="$t('label.saveShortcut')" @click="savePlaylist">
          <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i></span>{{ $t('label.save') }}
        </button>
      </div>

      <confirm-modal :open="confirmDelete" :title="$t('label.delete')" warn
        :message="`${$t('label.deleteQuestion')} « ${draft.name} » ?`" :confirm-label="$t('label.confirm')"
        :cancel-label="$t('label.cancel')" @confirm="doDelete" @close="confirmDelete = false" />
      <confirm-modal :open="leavePending" :title="$t('label.unsavedChanges')" :message="$t('label.discardPlaylist')"
        :confirm-label="$t('label.discard')" :cancel-label="$t('label.cancel')" @confirm="answerLeave(true)"
        @close="answerLeave(false)" />
    </article>
  </div>
</template>
