<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { MAX_COILS, MIN_COILS } from '@/types/domain';
import type { CoilConfig, CoilEvent, CoilParam, MidiFile, Song } from '@/types/domain';
import { analyzeMidi, type MidiAnalysis } from '@/midi/analyze';
import { notify } from '@/utils/toast';
import CoilConfigCard from '@/components/editor/CoilConfigCard.vue';
import ChannelMaskSelector from '@/components/editor/ChannelMaskSelector.vue';
import SearchableSelect from '@/components/ui/SearchableSelect.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import MidiInstrumentsModal from '@/components/settings/MidiInstrumentsModal.vue';
import MidiPreview from '@/components/player/MidiPreview.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import MidiLibraryModal from '@/components/editor/MidiLibraryModal.vue';
import SmfParser from '@/smfplayer/js/smfParser.js';

const props = defineProps<{ song?: Song | null; locked?: boolean }>();
const emit = defineEmits<{
  (e: 'saved', song: Song): void;
  (e: 'change', song: Song): void;
  (e: 'deleted', id: number): void;
  (e: 'instruments-saved', file: MidiFile): void;
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
  events: [] as CoilEvent[],
});
// which automation parameter the timeline edits (coils view)
const editParam = ref<CoilParam>('ontime');

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
  draft.events = (song.events ?? []).map((e) => ({ ...e }));
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
  draft.events = [];
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
    events: draft.events
      .filter((e) => e.coilIndex < draft.coilCount)
      .map((e) => ({ coilIndex: e.coilIndex, atMs: Math.round(e.atMs), param: e.param, value: e.value })),
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
  notify('label.songSaved');
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

// --- MIDI timeline: analyse the selected file, recolour live -------------------
const analysis = ref<MidiAnalysis | null>(null);
// channels actually present in the selected MIDI (null = no file → allow all)
const availableChannels = computed(() => (analysis.value ? analysis.value.channels : null));

// Number of channels mirrored to the 2nd output (popcount of the mask).
const output2Count = computed(() => {
  let m = draft.output2Mask >>> 0;
  let n = 0;
  while (m) {
    n += m & 1;
    m >>>= 1;
  }
  return n;
});

function bufferToString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(binary)); } catch { return binary; }
}
async function refreshPreview(bust = false): Promise<void> {
  const file = midiStore.midiFileList.find((f) => f.id === draft.midiFileId);
  if (!file) { analysis.value = null; return; }
  try {
    // `bust` forces a fresh fetch after the file was rewritten (instrument edit)
    const url = file.path.replace(/^\./, '') + (bust ? `?t=${Date.now()}` : '');
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    const parser = new SmfParser();
    analysis.value = analyzeMidi(parser.parse(bufferToString(data as ArrayBuffer)));
  } catch {
    analysis.value = null;
  }
}
watch(() => draft.midiFileId, () => refreshPreview(), { immediate: true });

// --- per-channel instrument editor (edits the MIDI FILE, affects all songs) ----
const instrumentsFile = ref<MidiFile | null>(null);
const showInstruments = ref(false);
const selectedFile = computed(() => midiStore.midiFileList.find((f) => f.id === draft.midiFileId) ?? null);
function openInstruments(file: MidiFile): void {
  instrumentsFile.value = file;
  showInstruments.value = true;
}
function onInstrumentsSaved(file: MidiFile): void {
  // the file on disk changed → re-read the preview if it's the one in the editor,
  // and tell the embedded player to re-fetch so playback isn't stale.
  if (file.id === draft.midiFileId) {
    refreshPreview(true);
    emit('instruments-saved', file);
  }
}

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
    events: draft.events.filter((e) => e.coilIndex < draft.coilCount),
  };
  emit('change', song);
}
watch(draft, () => emitChange(), { deep: true });

// --- MIDI library / upload modal (extracted to editor/MidiLibraryModal.vue) ---
const showLibrary = ref(false);
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
          <button class="field-btn" type="button" :disabled="!selectedFile"
            :title="$t('label.editInstruments')" @click="selectedFile && openInstruments(selectedFile)">
            <i class="fas fa-guitar"></i>
          </button>
          <button class="field-btn" type="button" :title="$t('title.midiFileManager')" @click="showLibrary = true">
            <i class="fas fa-folder-open"></i>
          </button>
        </div>
      </div>

      <div class="field-block">
        <span class="field-label" id="coilcount-label">{{ $t('label.coilCount') }}</span>
        <segmented-control v-model="draft.coilCount" fill pressed aria-labelledby="coilcount-label"
          :options="coilRange.map((n) => ({ value: n, label: String(n) }))" />
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

    <article class="coil-card output2-card" :style="{ '--coil': 'var(--plasma)' }">
      <header class="coil-card__head">
        <span class="coil-card__badge"><i class="fas fa-volume-high"></i></span>
        <h3 class="coil-card__title">{{ $t('label.secondOutputChannels') }}</h3>
        <span class="coil-card__count">{{ output2Count }} ch</span>
      </header>
      <ChannelMaskSelector v-model="draft.output2Mask" color="var(--plasma)" :available-channels="availableChannels"
        :label="$t('label.secondOutputChannels')" />
    </article>

    <!-- Timeline: notes coloured live by the channel→coil mapping + editable coil automation -->
    <section class="editor-section">
      <h2 class="editor-section__title">
        <span class="icon"><i class="fas fa-chart-simple"></i></span>{{ $t('label.timeline') }}
      </h2>
      <div class="editor-preview">
        <MidiPreview :analysis="analysis" :coils="draft.coils" :coil-count="draft.coilCount"
          :output2-mask="draft.output2Mask" view="combined"
          :events="draft.events" editable v-model:edit-param="editParam"
          @update:events="draft.events = $event" />
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
      @confirm="doDelete" @close="confirmDeleteSong = false" />

    <MidiLibraryModal :open="showLibrary" :current-id="draft.midiFileId"
      @close="showLibrary = false" @select="draft.midiFileId = $event" @edit-instruments="openInstruments" />

    <MidiInstrumentsModal :open="showInstruments" :file="instrumentsFile"
      @close="showInstruments = false" @saved="onInstrumentsSaved" />
  </div>
</template>
