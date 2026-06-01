<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import ConfirmModal from '@/components/ConfirmModal.vue';
import { coilColor } from '@/ui/coil-colors';
import { formatDuration, totalDurationMs, hasUnknownDuration } from '@/utils/format';
import { notify } from '@/utils/toast';
import { MAX_COILS, MIN_COILS } from '@/types/domain';
import type { Playlist, Song } from '@/types/domain';

const props = defineProps<{ playlists: Playlist[]; playlistId: string | null }>();
const emit = defineEmits<{ (e: 'saved', p: Playlist): void; (e: 'deleted', id: number): void }>();

const midiStore = useMidiStore();
const coilRange = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => MIN_COILS + i);

function blankDraft(): Playlist {
  return { id: 0, name: 'Untitled playlist', coilCount: midiStore.appConfig.defaultCoilCount || 3, songIds: [] };
}
const draft = ref<Playlist>(blankDraft());
const confirmDelete = ref(false);
const librarySearch = ref('');
const onlyCompatible = ref(false);

// load the playlist named by the route; don't clobber in-progress edits of the
// same playlist when the parent list refreshes (mirrors the song editor).
function loadDraft(): void {
  const pid = props.playlistId;
  if (pid == null || pid === 'new') { if (draft.value.id !== 0) draft.value = blankDraft(); return; }
  const id = Number(pid);
  if (draft.value.id === id) return;
  const p = props.playlists.find((x) => x.id === id);
  draft.value = p ? { ...p, songIds: [...p.songIds] } : blankDraft();
}
watch([() => props.playlistId, () => props.playlists], loadDraft, { immediate: true });

const songs = computed<Song[]>(() => midiStore.midiSongList);
function songById(id: number): Song | undefined {
  return songs.value.find((s) => s.id === id);
}
function isCompatible(coilCount: number | undefined): boolean {
  return coilCount === draft.value.coilCount;
}
// total play length of the draft playlist ("~" if any track's length is unknown)
const playlistSongs = computed<Song[]>(
  () => draft.value.songIds.map(songById).filter((s): s is Song => s != null),
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
async function savePlaylist(): Promise<void> {
  const body = { name: draft.value.name, coilCount: draft.value.coilCount, songIds: draft.value.songIds };
  const { data } = draft.value.id
    ? await axios.put<Playlist>(`/api/playlists/${draft.value.id}`, body)
    : await axios.post<Playlist>('/api/playlists', body);
  draft.value = { ...data, songIds: [...(data.songIds ?? [])] };
  emit('saved', data);
  notify('label.playlistSaved');
}
function doDelete(): void {
  const id = draft.value.id;
  confirmDelete.value = false;
  if (!id) return;
  axios.delete(`/api/playlists/${id}`).then(() => emit('deleted', id));
}
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
            <span class="icon"><i class="fas fa-bolt"></i></span>{{ draft.coilCount }}
          </button>
        </div>
        <ul class="pl-list">
          <li v-for="s in filteredLibrary" :key="s.id" class="pl-row"
            :class="{ 'is-added': draft.songIds.includes(s.id), 'is-incompatible': !isCompatible(s.coilCount) }"
            draggable="true" @dragstart="onLibDragStart(s.id)" @dragend="onDragEnd">
            <span class="pl-row__grip"><i class="fas fa-grip-vertical"></i></span>
            <span class="pl-row__name">{{ s.name }}</span>
            <span class="pl-row__dur">{{ formatDuration(s.midiFile?.durationMs) }}</span>
            <span v-if="!isCompatible(s.coilCount)" class="incompat-flag"
              :title="$t('label.incompatibleCoils', { n: s.coilCount })">
              <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ s.coilCount }}
            </span>
            <span v-else class="coil-dots">
              <span v-for="i in coilChips(s.coilCount)" :key="i" class="coil-dot" :style="{ '--c': coilColor(i) }"></span>
            </span>
            <button class="icon-btn" type="button" :disabled="draft.songIds.includes(s.id)"
              :title="$t('label.addToQueue')" @click="addSong(s.id)">
              <span class="icon"><i class="fas" :class="draft.songIds.includes(s.id) ? 'fa-check' : 'fa-plus'"></i></span>
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
          <span class="pl-pane__total" v-if="draft.songIds.length">{{ playlistTotalLabel }}</span>
        </header>
        <ul class="pl-list pl-list--drop" :class="{ 'is-drop': draggingLib }" @dragover.prevent @drop.prevent="onDropOnList">
          <li v-for="(songId, idx) in draft.songIds" :key="`${songId}-${idx}`" class="pl-row pl-row--queue"
            :class="{ 'is-incompatible': !isCompatible(songById(songId)?.coilCount), 'is-dragover': dragOverIdx === idx }"
            draggable="true" @dragstart="onPlDragStart(idx)" @dragend="onDragEnd"
            @dragover.prevent="dragOverIdx = idx" @drop.prevent.stop="onDropOnItem(idx)">
            <span class="pl-row__grip"><i class="fas fa-grip-vertical"></i></span>
            <span class="pl-row__idx">{{ idx + 1 }}</span>
            <span class="pl-row__name" v-if="songById(songId)">{{ songById(songId)!.name }}</span>
            <span class="pl-row__name pl-row__name--unknown" v-else>{{ $t('label.unknownSong') }}</span>
            <span class="pl-row__dur" v-if="songById(songId)">{{ formatDuration(songById(songId)!.midiFile?.durationMs) }}</span>
            <span v-if="songById(songId) && !isCompatible(songById(songId)!.coilCount)" class="incompat-flag"
              :title="$t('label.incompatibleCoils', { n: songById(songId)!.coilCount })">
              <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>{{ songById(songId)!.coilCount }}
            </span>
            <div class="pl-row__actions">
              <button class="icon-btn" type="button" :disabled="idx === 0" @click="moveUp(idx)">
                <span class="icon"><i class="fas fa-angle-up"></i></span>
              </button>
              <button class="icon-btn" type="button" :disabled="idx === draft.songIds.length - 1" @click="moveDown(idx)">
                <span class="icon"><i class="fas fa-angle-down"></i></span>
              </button>
              <button class="icon-btn icon-btn--danger" type="button" @click="removeSong(idx)">
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
      <button v-if="draft.id" class="btn btn--danger" type="button" @click="confirmDelete = true">
        <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.delete') }}
      </button>
      <button class="btn btn--volt pl-footer__save" type="button" @click="savePlaylist">
        <span class="icon"><i class="fas fa-save"></i></span>{{ draft.id ? $t('label.update') : $t('label.save') }}
      </button>
    </div>

    <confirm-modal :open="confirmDelete" :title="$t('label.delete')"
      :message="`${$t('label.deleteQuestion')} « ${draft.name} » ?`"
      :confirm-label="$t('label.confirm')" :cancel-label="$t('label.cancel')"
      @confirm="doDelete" @cancel="confirmDelete = false" />
  </article>
</template>

<style scoped lang="scss">
.pl-editor { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 1rem; }

/* meta row */
.pl-meta {
  display: flex; gap: 1.2rem; flex-wrap: wrap; align-items: flex-end;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius); padding: 0.9rem 1rem;
}
.pl-meta__field { display: flex; flex-direction: column; gap: 0.35rem; }
.pl-meta__field--name { flex: 1 1 16rem; min-width: 0; }
.pl-meta__field--name .text-field { width: 100%; }
.field-label {
  font-family: var(--font-display); text-transform: uppercase;
  letter-spacing: 0.08em; font-size: 0.68rem; color: var(--text-dim);
}

/* two panes */
.pl-panes { flex: 1 1 auto; min-height: 0; display: flex; gap: 1rem; }
.pl-pane {
  flex: 1 1 50%; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
}
.pl-pane__head {
  display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto;
  padding: 0.7rem 1rem; background: rgba(70, 224, 255, 0.06); border-bottom: 1px solid var(--line);
  font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.07em; font-size: 0.8rem;
}
.pl-pane__head .icon { color: var(--volt); }
.pl-pane__count {
  margin-left: auto; font-family: var(--font-mono); font-size: 0.78rem;
  color: var(--text-dim); background: var(--bg-2); border: 1px solid var(--line-strong);
  border-radius: 999px; padding: 0.05rem 0.55rem;
}
.pl-pane__total {
  font-family: var(--font-mono); font-size: 0.78rem; text-transform: none;
  letter-spacing: 0; color: var(--text-mute); font-variant-numeric: tabular-nums;
}

/* search + coil filter toggle */
.pl-search { display: flex; gap: 0.5rem; padding: 0.7rem 1rem; flex: 0 0 auto; }
.pl-search__box { position: relative; flex: 1 1 auto; min-width: 0; }
.pl-search__box .text-field { width: 100%; padding-left: 2.2rem; }
.pl-search__icon {
  position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%);
  color: var(--text-mute); pointer-events: none; font-size: 0.85rem;
}
.coil-filter-toggle {
  display: inline-flex; align-items: center; gap: 0.3rem; flex: 0 0 auto; cursor: pointer;
  padding: 0 0.7rem; border-radius: 9px;
  background: var(--bg-2); border: 1px solid var(--line-strong); color: var(--text-dim);
  font-family: var(--font-mono); font-size: 0.85rem; transition: 0.13s;
}
.coil-filter-toggle .icon { font-size: 0.7rem; }
.coil-filter-toggle:hover { color: var(--text); border-color: var(--volt); }
.coil-filter-toggle.is-active { color: #06090f; background: var(--volt); border-color: var(--volt); font-weight: 600; }

/* lists */
.pl-list { list-style: none; margin: 0; padding: 0; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.pl-list--drop.is-drop { outline: 2px dashed var(--volt); outline-offset: -4px; }
.pl-row {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.5rem 0.8rem; min-width: 0;
  border-top: 1px solid var(--line); transition: background 0.12s; cursor: grab;
}
.pl-row:first-child { border-top: 0; }
.pl-row:hover { background: rgba(120, 160, 205, 0.05); }
.pl-row.is-added { opacity: 0.55; }
.pl-row.is-incompatible { opacity: 0.55; }
.pl-row.is-dragover { box-shadow: inset 0 2px 0 var(--volt); }
.pl-row__grip { flex: 0 0 auto; color: var(--text-mute); font-size: 0.8rem; }
.pl-row__idx { flex: 0 0 auto; width: 1.4rem; text-align: right; color: var(--text-mute); font-family: var(--font-mono); font-size: 0.8rem; }
.pl-row__name { flex: 1 1 auto; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-row__name--unknown { color: var(--text-mute); font-style: italic; }
.pl-row__dur { flex: 0 0 auto; color: var(--text-mute); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.pl-row__actions { flex: 0 0 auto; display: flex; gap: 0.3rem; }

.coil-dots { display: inline-flex; gap: 3px; flex: 0 0 auto; }
.coil-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px -1px var(--c); }
.incompat-flag {
  display: inline-flex; align-items: center; gap: 0.25rem; flex: 0 0 auto;
  color: var(--coil-1); font-family: var(--font-mono); font-size: 0.78rem;
}

.pl-empty { padding: 1.3rem 1rem; color: var(--text-mute); text-align: center; font-family: var(--font-mono); font-size: 0.85rem; }
.pl-empty--drop { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 2.2rem 1rem; }
.pl-empty--drop .icon { font-size: 1.3rem; color: var(--volt); opacity: 0.6; }

/* compact action buttons */
.icon-btn {
  width: 2rem; height: 2rem; border-radius: 7px; flex: 0 0 auto;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(255, 255, 255, 0.03); border: 1px solid var(--line-strong); color: var(--text-dim);
  transition: 0.15s;
}
.icon-btn .icon { width: auto; height: auto; }
.icon-btn:hover { color: var(--volt); border-color: var(--volt); box-shadow: 0 0 14px -6px var(--volt); }
.icon-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
.icon-btn:disabled:hover { color: var(--text-dim); border-color: var(--line-strong); }
.icon-btn--danger:hover { color: var(--danger); border-color: var(--danger); box-shadow: 0 0 14px -6px var(--danger); }

/* sticky footer */
.pl-footer {
  display: flex; align-items: center; gap: 0.7rem; flex: 0 0 auto;
  padding: 0.9rem 0 0.2rem;
}
.pl-footer__save { margin-left: auto; }
</style>
