<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { MAX_COILS, MIN_COILS } from '@/types/domain';
import type { CoilConfig, MidiFile, Song } from '@/types/domain';
import { analyzeMidi, type MidiAnalysis } from '@/midi/analyze';
import { formatDuration } from '@/utils/format';
import CoilConfigCard from './CoilConfigCard.vue';
import ChannelMaskSelector from './ChannelMaskSelector.vue';
import SearchableSelect from './SearchableSelect.vue';
import ConfirmModal from './ConfirmModal.vue';
import MidiPreview from './play/MidiPreview.vue';
import SmfParser from '@/smfplayer/js/smfParser.js';

const props = defineProps<{ song?: Song | null; locked?: boolean }>();
const emit = defineEmits<{
  (e: 'saved', song: Song): void;
  (e: 'change', song: Song): void;
  (e: 'deleted', id: number): void;
}>();

const midiStore = useMidiStore();
const coilRange = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => MIN_COILS + i);

// A song is always driven in the firmware's MIDI mode (the "fixed" / Simple mode
// is a separate live feature, not a stored song).
const SONG_MODE = 'midi' as const;

function defaultCoil(index: number): CoilConfig {
  return { coilIndex: index, channelMask: 0, ontimeUs: 40, duty: 0.05 };
}

const draft = reactive({
  id: null as number | null,
  name: '',
  midiFileId: null as number | null,
  coilCount: 3,
  output2Mask: 0,
  coils: [defaultCoil(0), defaultCoil(1), defaultCoil(2)] as CoilConfig[],
});

const midiFileItems = computed(() =>
  midiStore.midiFileList.map((f) => ({ id: f.id, label: f.name })),
);

watch(() => draft.coilCount, (n) => {
  if (draft.coils.length === n) return;
  const next: CoilConfig[] = [];
  for (let i = 0; i < n; i++) next.push(draft.coils[i] ?? defaultCoil(i));
  draft.coils = next;
});

function load(song: Song | null | undefined): void {
  if (!song) { resetNew(); return; }
  draft.id = song.id;
  draft.name = song.name ?? '';
  draft.midiFileId = song.midiFile ? song.midiFile.id : null;
  draft.output2Mask = song.output2Mask ?? 0;
  draft.coils = (song.coils ?? []).map((c) => ({ ...c }));
  draft.coilCount = song.coilCount ?? (draft.coils.length || 1);
  while (draft.coils.length < draft.coilCount) draft.coils.push(defaultCoil(draft.coils.length));
  if (draft.coils.length > draft.coilCount) draft.coils.length = draft.coilCount;
}

function resetNew(): void {
  draft.id = null;
  draft.name = '';
  draft.midiFileId = null;
  draft.output2Mask = 0;
  const count = midiStore.appConfig.defaultCoilCount || 3;
  draft.coilCount = count;
  draft.coils = Array.from({ length: count }, (_, i) => defaultCoil(i));
}

// Reload only when actually switching to a different song. This avoids the
// editor clobbering the user's draft when our own save() replaces the song in
// the store (same id) and the prop reference changes.
watch(() => props.song, (s) => {
  if (s && s.id === draft.id) return;
  load(s);
}, { immediate: true });

function coilsPayload() {
  return draft.coils.slice(0, draft.coilCount).map((c, i) => ({
    coilIndex: i,
    channelMask: c.channelMask,
    ontimeUs: c.ontimeUs,
    duty: c.duty,
  }));
}

function buildPayload() {
  return {
    name: draft.name,
    midiFileId: draft.midiFileId,
    coilCount: draft.coilCount,
    mode: SONG_MODE,
    output2Mask: draft.output2Mask,
    coils: coilsPayload(),
  };
}

async function save(): Promise<void> {
  const payload = buildPayload();
  const { data } = draft.id
    ? await axios.put<Song>(`/api/songs/${draft.id}`, payload)
    : await axios.post<Song>('/api/songs', payload);
  if (draft.id) midiStore.updateMidiSong(data);
  else midiStore.addMidiSongToList(data);
  draft.id = data.id;
  emit('saved', data);
}

const confirmDeleteSong = ref(false);
function doDelete(): void {
  const id = draft.id;
  confirmDeleteSong.value = false;
  if (!id) return;
  axios.delete(`/api/songs/${id}`).then(() => {
    midiStore.deleteMidiSong(id);
    emit('deleted', id);
  });
}

// --- MIDI preview: analyse the selected file, recolour live -------------------
const previewView = ref<'roll' | 'lanes'>('roll');
const analysis = ref<MidiAnalysis | null>(null);
// channels actually present in the selected MIDI (null = no file → allow all)
const availableChannels = computed(() => (analysis.value ? analysis.value.channels : null));

function bufferToString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(binary)); } catch { return binary; }
}
async function refreshPreview(): Promise<void> {
  const file = midiStore.midiFileList.find((f) => f.id === draft.midiFileId);
  if (!file) { analysis.value = null; return; }
  try {
    const { data } = await axios.get(file.path.replace(/^\./, ''), { responseType: 'arraybuffer' });
    const parser = new SmfParser();
    analysis.value = analyzeMidi(parser.parse(bufferToString(data as ArrayBuffer)));
  } catch {
    analysis.value = null;
  }
}
watch(() => draft.midiFileId, refreshPreview, { immediate: true });

// Reflect every edit into the embedded debug player (no manual "load" step).
function emitChange(): void {
  const midiFile = midiStore.midiFileList.find((f) => f.id === draft.midiFileId) ?? null;
  const song: Song = {
    id: draft.id ?? 0,
    name: draft.name,
    midiFile,
    coilCount: draft.coilCount,
    mode: SONG_MODE,
    output2Mask: draft.output2Mask,
    coils: coilsPayload(),
  };
  emit('change', song);
}
watch(draft, () => emitChange(), { deep: true });

// --- MIDI library / upload modal (drag-and-drop + searchable list) ---------
const showLibrary = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const dragActive = ref(false);
const librarySearch = ref('');
const pendingDelete = ref<{ id: number; name: string } | null>(null);
const uploadMsg = ref<{ type: 'success' | 'error'; name?: string } | null>(null);

const filteredLibrary = computed(() => {
  const q = librarySearch.value.trim().toLowerCase();
  // Newest first, so a freshly-uploaded file appears at the top of the list.
  const list = [...midiStore.midiFileList].sort((a, b) => b.id - a.id);
  return q ? list.filter((f) => f.name.toLowerCase().includes(q)) : list;
});

function pickFile(): void {
  fileInput.value?.click();
}
function onFileChosen(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) uploadOne(f);
}
function onDrop(e: DragEvent): void {
  dragActive.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) uploadOne(f);
}
async function uploadOne(file: File): Promise<void> {
  uploading.value = true;
  uploadMsg.value = null;
  try {
    const form = new FormData();
    form.append('file', file);
    // No manual Content-Type: the browser sets multipart/form-data + boundary.
    const { data } = await axios.post<MidiFile>('/api/midi', form);
    midiStore.addMidiFileToList(data);
    draft.midiFileId = data.id; // auto-select the freshly uploaded file
    uploadMsg.value = { type: 'success', name: data.name };
  } catch (err) {
    console.error('MIDI upload failed', err);
    uploadMsg.value = { type: 'error', name: file.name };
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
async function downloadFile(f: MidiFile): Promise<void> {
  // Fetch as a blob so the saved file uses the given MIDI name (the `download`
  // attribute is ignored on cross-origin <a> links, which would otherwise keep
  // the raw prefixed filename from the URL).
  try {
    const { data } = await axios.get(f.path.replace(/^\./, ''), { responseType: 'blob' });
    const url = URL.createObjectURL(data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('MIDI download failed', err);
  }
}
function requestDelete(f: MidiFile): void {
  pendingDelete.value = { id: f.id, name: f.name };
}
function cancelDelete(): void {
  pendingDelete.value = null;
}
async function confirmDelete(): Promise<void> {
  const target = pendingDelete.value;
  if (!target) return;
  pendingDelete.value = null;
  try {
    await axios.delete(`/api/midi/${target.id}`);
    midiStore.deleteMidiFile(target.id);
    if (draft.midiFileId === target.id) draft.midiFileId = null;
  } catch (err) {
    console.error('MIDI delete failed', err);
  }
}
function closeLibrary(): void {
  showLibrary.value = false;
  librarySearch.value = '';
  dragActive.value = false;
  pendingDelete.value = null;
  uploadMsg.value = null;
}
</script>

<template>
  <div class="editor" :class="{ 'is-locked': locked }">
    <div v-if="locked" class="editor-lock">
      <span class="editor-lock__msg">
        <span class="icon"><i class="fas fa-lock"></i></span>{{ $t('label.stopToEdit') }}
      </span>
    </div>

    <div class="editor-meta">
      <div class="field-block field-block--wide">
        <label class="field-label" for="song-name">{{ $t('label.songName') }}</label>
        <input id="song-name" class="text-field" v-model="draft.name" :placeholder="$t('label.songName')">
      </div>

      <div class="field-block">
        <span class="field-label">{{ $t('label.midiFile') }}</span>
        <div class="midi-field">
          <SearchableSelect
            v-model="draft.midiFileId"
            :items="midiFileItems"
            :label="$t('label.midiFile')"
            :placeholder="$t('label.chooseAMidiFile')"
            :clear-label="$t('label.noAssociatedMidiFile')"
            clearable
          />
          <button class="field-btn" type="button" :title="$t('title.midiFileManager')" @click="showLibrary = true">
            <i class="fas fa-folder-open"></i>
          </button>
        </div>
      </div>

      <div class="field-block">
        <span class="field-label" id="coilcount-label">{{ $t('label.coilCount') }}</span>
        <div class="segmented segmented--fill" role="group" aria-labelledby="coilcount-label">
          <button
            v-for="n in coilRange"
            :key="n"
            type="button"
            :aria-pressed="draft.coilCount === n"
            :class="{ 'is-active': draft.coilCount === n }"
            @click="draft.coilCount = n"
          >{{ n }}</button>
        </div>
      </div>
    </div>

    <div class="coils-grid">
      <CoilConfigCard
        v-for="i in draft.coilCount"
        :key="i - 1"
        v-model="draft.coils[i - 1]"
        :index="i - 1"
        :available-channels="availableChannels"
      />
    </div>

    <section class="editor-section">
      <h2 class="editor-section__title">
        <span class="icon"><i class="fas fa-volume-high"></i></span>
        {{ $t('label.secondOutputChannels') }}
      </h2>
      <ChannelMaskSelector v-model="draft.output2Mask" color="var(--plasma)" :available-channels="availableChannels"
        :label="$t('label.secondOutputChannels')" />
    </section>

    <!-- MIDI preview, coloured live by the current channel→coil mapping -->
    <section class="editor-section">
      <h2 class="editor-section__title">
        <span class="icon"><i class="fas fa-chart-simple"></i></span>{{ $t('label.preview') }}
        <div class="segmented editor-preview__views">
          <button type="button" :class="{ 'is-active': previewView === 'roll' }" @click="previewView = 'roll'">
            <span class="icon"><i class="fas fa-music"></i></span>{{ $t('label.viewScore') }}
          </button>
          <button type="button" :class="{ 'is-active': previewView === 'lanes' }" @click="previewView = 'lanes'">
            <span class="icon"><i class="fas fa-bolt"></i></span>{{ $t('label.viewCoils') }}
          </button>
        </div>
      </h2>
      <div class="editor-preview">
        <MidiPreview :analysis="analysis" :coils="draft.coils" :coil-count="draft.coilCount"
          :output2-mask="draft.output2Mask" :view="previewView" />
      </div>
    </section>

    <div class="editor-footer">
      <button v-if="draft.id" class="btn btn--danger editor-footer__delete" type="button" @click="confirmDeleteSong = true">
        <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.deleteSong') }}
      </button>
      <button class="btn btn--volt" type="button" @click="save">
        <span class="icon"><i class="fas fa-floppy-disk"></i></span>
        {{ draft.id ? $t('label.update') : $t('label.save') }}
      </button>
    </div>

    <ConfirmModal :open="confirmDeleteSong" :title="$t('label.deleteSong')"
      :message="`${$t('label.deleteQuestion')} « ${draft.name || ('#' + draft.id)} » ?`"
      :confirm-label="$t('label.confirm')" :cancel-label="$t('label.cancel')"
      @confirm="doDelete" @cancel="confirmDeleteSong = false" />

    <!-- MIDI library / upload modal (teleported so it never affects the editor flex layout) -->
    <Teleport to="body">
      <div v-if="showLibrary" class="modal-overlay" @click.self="closeLibrary">
        <div class="modal-card">
          <div class="modal-card__head">
            <span class="modal-card__title">
              <span class="icon"><i class="fas fa-folder-open"></i></span>{{ $t('title.midiFileManager') }}
            </span>
            <button class="icon-btn" type="button" :aria-label="$t('label.closeEditor')" @click="closeLibrary">
              <i class="fas fa-xmark"></i>
            </button>
          </div>

          <input ref="fileInput" type="file" accept=".mid,.midi" style="display: none" @change="onFileChosen">
          <div
            class="dropzone"
            :class="{ 'is-drag': dragActive }"
            @click="pickFile"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="onDrop"
          >
            <span class="dropzone__icon"><i class="fas fa-cloud-arrow-up"></i></span>
            <span class="dropzone__hint">{{ uploading ? $t('label.upload') + '…' : $t('label.dropMidiHint') }}</span>
          </div>

          <div v-if="uploadMsg && !pendingDelete" class="midi-lib__msg" :class="uploadMsg.type">
            <i class="fas" :class="uploadMsg.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'"></i>
            <span v-if="uploadMsg.type === 'success'">{{ uploadMsg.name }} · {{ $t('label.uploaded') }}</span>
            <span v-else>{{ $t('label.uploadFailed') }}</span>
          </div>

          <div v-if="pendingDelete" class="midi-lib__msg confirm">
            <span class="midi-lib__confirm-text">
              <i class="fas fa-triangle-exclamation"></i>
              {{ $t('label.deleteQuestion') }} « {{ pendingDelete.name }} » ?
            </span>
            <span class="midi-lib__confirm-actions">
              <button class="btn btn--danger" type="button" @click="confirmDelete">{{ $t('label.confirm') }}</button>
              <button class="btn btn--ghost" type="button" @click="cancelDelete">{{ $t('label.cancel') }}</button>
            </span>
          </div>

          <div class="midi-lib__search">
            <input class="text-field" type="text" v-model="librarySearch" :placeholder="$t('label.search')">
          </div>

          <div class="midi-lib__list">
            <div v-if="filteredLibrary.length === 0" class="midi-lib__empty">{{ $t('label.noResults') }}</div>
            <div
              v-for="f in filteredLibrary"
              :key="f.id"
              class="midi-lib__item"
              :class="{ 'is-current': f.id === draft.midiFileId }"
            >
              <span class="midi-lib__item-name">{{ f.name }}</span>
              <span class="midi-lib__item-dur">{{ formatDuration(f.durationMs) }}</span>
              <button class="midi-lib__dl" type="button" :title="$t('label.download')" @click="downloadFile(f)">
                <i class="fas fa-download"></i>
              </button>
              <button class="midi-lib__del" type="button" :title="$t('label.delete')" @click="requestDelete(f)">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
