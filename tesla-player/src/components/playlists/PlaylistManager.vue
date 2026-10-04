<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { useLeaveGuard } from '@/utils/leave-guard';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import { coilColor } from '@/ui/coil-colors';
import { formatDuration, totalDurationMs, hasUnknownDuration } from '@/utils/format';
import { notify } from '@/utils/toast';
import { MAX_COILS, MIN_COILS } from '@/types/domain';
import type { Playlist, Song } from '@/types/domain';
import { ICONS } from '@/ui/icons';

const props = defineProps<{ playlists: Playlist[]; playlistId: string | null }>();
const emit = defineEmits<{
  (e: 'saved', p: Playlist): void;
  (e: 'deleted', id: number): void;
  (e: 'dirty', dirty: boolean): void;
}>();

const midiStore = useMidiStore();
const coilRange = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => MIN_COILS + i);

function blankDraft(): Playlist {
  return { id: 0, name: 'Untitled playlist', coilCount: midiStore.appConfig.defaultCoilCount || 3, songIds: [] };
}
const draft = ref<Playlist>(blankDraft());
// what the server holds (the blank one for a new playlist): an edit undone is no longer a change
const snapshot = (): string =>
  JSON.stringify({ name: draft.value.name, coilCount: draft.value.coilCount, songIds: draft.value.songIds });
const baseline = ref(snapshot());
function show(p: Playlist): void {
  draft.value = p;
  baseline.value = snapshot();
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

const dirty = computed(() => snapshot() !== baseline.value);
watch(dirty, (d) => emit('dirty', d), { immediate: true });
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => dirty.value);

const songs = computed<Song[]>(() => midiStore.midiSongList);
function songById(id: number): Song | undefined {
  return songs.value.find((s) => s.id === id);
}
function isCompatible(coilCount: number | undefined): boolean {
  return coilCount === draft.value.coilCount;
}
// total play length of what will play ("~" if any track's length is unknown): the
// player skips a song made for another coil count (SongPlaylistPicker)
const playlistSongs = computed<Song[]>(
  () => draft.value.songIds.map(songById).filter((s): s is Song => s != null && isCompatible(s.coilCount)),
);
const playlistTotalLabel = computed(() => {
  const label = formatDuration(totalDurationMs(playlistSongs.value));
  return hasUnknownDuration(playlistSongs.value) ? `~${label}` : label;
});
function coilChips(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }

// LEFT pane: the whole library, filtered by search and (optionally) coil count
const filteredLibrary = computed(() => {
  const q = librarySearch.value.trim().toLowerCase();
  let list = [...songs.value].sort((a, b) => a.name.localeCompare(b.name));
  if (onlyCompatible.value) list = list.filter((s) => s.coilCount === draft.value.coilCount);
  if (q) list = list.filter((s) => s.name.toLowerCase().includes(q));
  return list;
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
    baseline.value = snapshot(); // nothing left to keep: the way back to the chooser must not ask
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
  <article class="pl-editor">
    <!-- meta: name + Tesla-coil count -->
    <div class="pl-meta">
      <div class="pl-meta__field pl-meta__field--name">
        <span class="field-label">{{ $t('label.playlistName') }}</span>
        <input class="text-field" type="text" :placeholder="$t('label.playlistName')" v-model="draft.name">
      </div>
      <div class="pl-meta__field">
        <span class="field-label">{{ $t('label.coilCount') }}</span>
        <div class="segmented" role="group" :aria-label="$t('label.coilCount')">
          <button v-for="n in coilRange" :key="n" type="button" :aria-pressed="draft.coilCount === n"
            :class="{ 'is-active': draft.coilCount === n }" @click="draft.coilCount = n">{{ n }}</button>
        </div>
      </div>
    </div>

    <!-- two panes: library (left) and current playlist (right) -->
    <div class="pl-panes">
      <!-- LIBRARY -->
      <section class="pl-pane">
        <header class="pl-pane__head">
          <span class="icon"><i class="fas fa-list-ul"></i></span>{{ $t('label.songLibrary') }}
        </header>
        <div class="pl-search">
          <div class="pl-search__box">
            <span class="pl-search__icon"><i class="fas fa-search"></i></span>
            <input class="text-field" type="text" :placeholder="$t('label.search')" v-model="librarySearch">
          </div>
          <button class="coil-filter-toggle" type="button" :class="{ 'is-active': onlyCompatible }"
            :title="$t('label.onlyMatchingCoils')" @click="onlyCompatible = !onlyCompatible">
            <span class="icon"><i class="fas" :class="ICONS.coil"></i></span>{{ draft.coilCount }}
          </button>
        </div>
        <ul class="pl-list">
          <li v-for="s in filteredLibrary" :key="s.id" class="pl-row"
            :class="{ 'is-added': draft.songIds.includes(s.id), 'is-incompatible': !isCompatible(s.coilCount) }"
            draggable="true" @dragstart="onLibDragStart(s.id)" @dragend="onDragEnd">
            <span class="pl-row__grip"><i class="fas fa-grip-vertical"></i></span>
            <span class="pl-row__name">{{ s.name }}</span>
            <span class="pl-row__dur">{{ formatDuration(s.midiFile?.durationMs) }}</span>
            <span v-if="!isCompatible(s.coilCount)" class="pl-incompat-flag"
              :title="$t('label.incompatibleCoils', { n: s.coilCount })">
              <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ s.coilCount }}
            </span>
            <span v-else class="pl-coil-dots">
              <span v-for="i in coilChips(s.coilCount)" :key="i" class="pl-coil-dot"
                :style="{ '--c': coilColor(i) }"></span>
            </span>
            <button class="icon-btn pl-icon-btn" type="button" :disabled="draft.songIds.includes(s.id)"
              :title="$t('label.addToQueue')" @click="addSong(s.id)">
              <span class="icon"><i class="fas"
                  :class="draft.songIds.includes(s.id) ? 'fa-check' : 'fa-plus'"></i></span>
            </button>
          </li>
          <li v-if="filteredLibrary.length === 0" class="pl-empty">{{ $t('label.noResults') }}</li>
        </ul>
      </section>

      <!-- CURRENT PLAYLIST (drop target) -->
      <section class="pl-pane">
        <header class="pl-pane__head">
          <span class="icon"><i class="fas fa-list"></i></span>{{ $t('label.currentPlaylist') }}
          <span class="pl-pane__count">{{ draft.songIds.length }}</span>
          <span class="pl-pane__total" v-if="playlistSongs.length">{{ playlistTotalLabel }}</span>
        </header>
        <ul class="pl-list pl-list--drop" :class="{ 'is-drop': draggingLib }" @dragover.prevent
          @drop.prevent="onDropOnList">
          <li v-for="(songId, idx) in draft.songIds" :key="`${songId}-${idx}`" class="pl-row pl-row--queue"
            :class="{ 'is-incompatible': !isCompatible(songById(songId)?.coilCount), 'is-dragover': dragOverIdx === idx }"
            draggable="true" @dragstart="onPlDragStart(idx)" @dragend="onDragEnd" @dragover.prevent="dragOverIdx = idx"
            @drop.prevent.stop="onDropOnItem(idx)">
            <span class="pl-row__grip"><i class="fas fa-grip-vertical"></i></span>
            <span class="pl-row__idx">{{ idx + 1 }}</span>
            <span class="pl-row__name" v-if="songById(songId)">{{ songById(songId)!.name }}</span>
            <span class="pl-row__name pl-row__name--unknown" v-else>{{ $t('label.unknownSong') }}</span>
            <span class="pl-row__dur" v-if="songById(songId)">{{ formatDuration(songById(songId)!.midiFile?.durationMs)
            }}</span>
            <span v-if="songById(songId) && !isCompatible(songById(songId)!.coilCount)" class="pl-incompat-flag"
              :title="$t('label.incompatibleCoils', { n: songById(songId)!.coilCount })">
              <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ songById(songId)!.coilCount }}
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
        <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i></span>{{ draft.id
          ? $t('label.update') : $t('label.save') }}
      </button>
    </div>

    <confirm-modal :open="confirmDelete" :title="$t('label.delete')"
      :message="`${$t('label.deleteQuestion')} « ${draft.name} » ?`" :confirm-label="$t('label.confirm')"
      :cancel-label="$t('label.cancel')" @confirm="doDelete" @close="confirmDelete = false" />
    <confirm-modal :open="leavePending" :title="$t('label.unsavedChanges')" :message="$t('label.discardPlaylist')"
      :confirm-label="$t('label.discard')" :cancel-label="$t('label.cancel')" @confirm="answerLeave(true)"
      @close="answerLeave(false)" />
  </article>
</template>
