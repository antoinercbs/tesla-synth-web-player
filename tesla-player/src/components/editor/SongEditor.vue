<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { MAX_COILS, MIN_COILS } from '@/types/domain';
import type { AppTag, CoilConfig, CoilEvent, Song, SongStereo } from '@/types/domain';
import { analyzeMidi, type MidiAnalysis } from '@/midi/analyze';
import { notify } from '@/utils/toast';
import CoilConfigCard from '@/components/editor/CoilConfigCard.vue';
import ChannelMaskSelector from '@/components/editor/ChannelMaskSelector.vue';
import SearchableSelect from '@/components/ui/SearchableSelect.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import MidiLibraryModal from '@/components/editor/MidiLibraryModal.vue';
import StereoSection from '@/components/editor/StereoSection.vue';
import DynamicsSection from '@/components/editor/DynamicsSection.vue';
import SmfParser from '@/smfplayer/js/smfParser.js';

const props = defineProps<{
  song?: Song | null;
  locked?: boolean;
  /** Where the embedded player is (ms): the automation adds points there. */
  playerPosition?: number;
}>();
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
  events: [] as CoilEvent[],
  tags: [] as AppTag[],
  stereo: null as SongStereo | null,
});

const midiFileItems = computed(() =>
  midiStore.midiFileList.map((f) => ({ id: f.id, label: f.name })),
);
const allTags = computed<AppTag[]>(() => midiStore.tagList || []);
const availableTagsToAdd = computed(() => {
  const currentIds = draft.tags.map(t => t.id);
  return allTags.value.filter(t => !currentIds.includes(t.id));
});

function addTag(tag: AppTag) {
  draft.tags.push(tag);
}

function removeTag(tagId: number | undefined) {
  if (tagId !== undefined) {
    draft.tags = draft.tags.filter(t => t.id !== tagId);
  }
}

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
  draft.tags = (song.tags ?? []).map(t => ({ ...t }));
  draft.stereo = song.stereo ? JSON.parse(JSON.stringify(song.stereo)) : null;
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
  draft.tags = [];
  draft.stereo = null;
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
      .map((e) => ({ coilIndex: e.coilIndex, atMs: Math.round(e.atMs), param: e.param, value: e.value, ...(e.ramp ? { ramp: true } : {}) })),
    tagIds: draft.tags.filter((t) => t.id != null).map((t) => t.id),
    stereo: draft.stereo,
  };
}

async function save(): Promise<void> {
  const payload = buildPayload();
  const isNew = !draft.id;

  try {
    const { data } = isNew
      ? await axios.post<Song>('/api/songs', payload)
      : await axios.put<Song>(`/api/songs/${draft.id}`, payload);

    draft.id = data.id;

    if (isNew) midiStore.addMidiSongToList(data);
    else midiStore.updateMidiSong(data);

    emit('saved', data);
    notify('label.songSaved');
  } catch (err) {
    console.error('Save failed', err);
    notify('label.saveFailed', 'error');
  }
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
watch(() => draft.midiFileId, () => refreshPreview(), { immediate: true });

const selectedFile = computed(() => midiStore.midiFileList.find((f) => f.id === draft.midiFileId) ?? null);

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
    tags: draft.tags.map(t => ({ ...t })),
    stereo: draft.stereo,
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
        <span v-if="song && song.editorName" class="editor-meta__editor">
          <i class="fas fa-user-pen"></i>{{ $t('auth.lastEditedBy', { name: song.editorName }) }}
        </span>
      </div>

      <div class="field-block field-block--wide">
        <span class="field-label">{{ $t('label.midiFile') }}</span>
        <div class="midi-field">
          <SearchableSelect v-model="draft.midiFileId" :items="midiFileItems" :label="$t('label.midiFile')"
            :placeholder="$t('label.chooseAMidiFile')" :clear-label="$t('label.noAssociatedMidiFile')" clearable />
          <!-- leaves the song, as the sidebar does: what isn't saved here is not kept -->
          <RouterLink v-if="selectedFile" class="field-btn" :to="{ name: 'midi-edit', params: { id: selectedFile.id } }"
            :title="$t('midiEditor.open')" :aria-label="$t('midiEditor.open')">
            <i class="fas fa-pen-to-square"></i>
          </RouterLink>
          <button v-else class="field-btn" type="button" disabled :title="$t('midiEditor.open')" :aria-label="$t('midiEditor.open')">
            <i class="fas fa-pen-to-square"></i>
          </button>
          <button class="field-btn" type="button" :title="$t('title.midiFileManager')" @click="showLibrary = true">
            <i class="fas fa-folder-open"></i>
          </button>
        </div>
      </div>

      <div class="field-block">
        <span class="field-label">{{ $t('label.tags') }}</span>
        <div class="editor-tags">
          <div class="editor-tags__list" v-if="draft.tags.length > 0">
            <span v-for="tag in draft.tags" :key="tag.id ?? tag.name" class="editor-tag-pill"
              :style="{ '--tag-c': tag.color }">
              {{ tag.name }}
              <button class="tag-rm" type="button" :title="$t('label.removeTag')" @click="removeTag(tag.id)">
                <i class="fas fa-xmark"></i>
              </button>
            </span>
          </div>

          <div class="midi-lib__dropdown" v-if="availableTagsToAdd.length > 0">
            <button class="editor-tags__add" type="button" :title="$t('label.addTag')">
              <i class="fas fa-plus"></i>
            </button>
            <div class="midi-lib__dropdown-menu">
              <div class="midi-lib__dropdown-header">{{ $t('label.addTag') }}</div>
              <button v-for="t in availableTagsToAdd" :key="t.id" class="midi-lib__dropdown-item tag-dropdown-item"
                type="button" @click="addTag(t)">
                <span class="cfg-name-dot" :style="{ '--c': t.color }"></span>
                <span class="tag-dropdown-name">{{ t.name }}</span>
              </button>
            </div>
          </div>

          <span v-else-if="draft.tags.length === 0 && allTags.length === 0" class="editor-tags__empty">
            {{ $t('label.noTagAvailable') }}
          </span>
        </div>
      </div>

      <div class="field-block">
        <span class="field-label" id="coilcount-label">{{ $t('label.coilCount') }}</span>
        <segmented-control v-model="draft.coilCount" fill pressed aria-labelledby="coilcount-label"
          :options="coilRange.map((n) => ({ value: n, label: String(n) }))" />
      </div>
    </div>

    <div class="coils-grid">
      <CoilConfigCard v-for="i in draft.coilCount" :key="i - 1" v-model="draft.coils[i - 1]" :index="i - 1"
        :available-channels="availableChannels" />
    </div>

    <article class="coil-card output2-card" :style="{ '--coil': 'var(--plasma)' }">
      <header class="coil-card__head">
        <span class="coil-card__icon"><i class="fas fa-volume-high"></i></span>
        <h3 class="coil-card__title">{{ $t('label.secondOutputChannels') }}</h3>
        <span class="coil-card__count">{{ output2Count }} ch</span>
      </header>
      <ChannelMaskSelector v-model="draft.output2Mask" color="var(--plasma)" :available-channels="availableChannels"
        :label="$t('label.secondOutputChannels')" />
    </article>

    <StereoSection v-model="draft.stereo" :coil-count="draft.coilCount" :coils="draft.coils" :analysis="analysis" />

    <DynamicsSection v-model="draft.events" :coil-count="draft.coilCount" :analysis="analysis"
      :player-position="playerPosition ?? 0" :song-key="song?.id ?? null" />

    <div class="editor-footer">
      <button v-if="draft.id" class="btn btn--danger-ghost editor-footer__delete" type="button"
        @click="confirmDeleteSong = true">
        <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.deleteSong') }}
      </button>
      <button class="btn btn--volt" type="button" @click="save">
        <span class="icon"><i class="fas fa-floppy-disk"></i></span>
        {{ draft.id ? $t('label.update') : $t('label.save') }}
      </button>
    </div>

    <ConfirmModal :open="confirmDeleteSong" :title="$t('label.deleteSong')"
      :message="`${$t('label.deleteQuestion')} « ${draft.name || ('#' + draft.id)} » ?`"
      :confirm-label="$t('label.confirm')" :cancel-label="$t('label.cancel')" @confirm="doDelete"
      @close="confirmDeleteSong = false" />

    <MidiLibraryModal :open="showLibrary" :current-id="draft.midiFileId" @close="showLibrary = false"
      @select="draft.midiFileId = $event" />

  </div>
</template>
