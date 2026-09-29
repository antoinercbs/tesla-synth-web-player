<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { MAX_COILS, MIN_COILS } from '@/types/domain';
import type { AppTag, CoilConfig, CoilEvent, Song, SongStereo } from '@/types/domain';
import { analyzeMidi, type MidiAnalysis } from '@/midi/analyze';
import { notify } from '@/utils/toast';
import { useLeaveGuard } from '@/utils/leave-guard';
import { useDropdown } from '@/components/editor/dropdown';
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
  (e: 'dirty', dirty: boolean): void;
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

const {
  open: openMenu,
  toggle: toggleMenu,
  onKeydown: onMenuKey,
  onFocusIn: onMenuFocusIn,
  onFocusOut: onMenuFocusOut,
} = useDropdown();
const newTagName = ref('');
const creatingTag = ref(false);
// what the settings give a new tag (GeneralConfigModal); its colour is changed there
const NEW_TAG_COLOR = '#46e0ff';
function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}
function addExisting(tag: AppTag): void {
  if (!draft.tags.some((t) => t.id === tag.id)) addTag({ ...tag });
  newTagName.value = '';
}
async function createTag(): Promise<void> {
  const name = newTagName.value.trim();
  if (!name || creatingTag.value) return;
  const known = allTags.value.find((t) => sameName(t.name, name));
  if (known) { addExisting(known); return; }
  creatingTag.value = true;
  try {
    // the sync deletes whatever the list leaves out: start from the server's, not from a stale copy
    const { data: current } = await axios.get<AppTag[]>('/api/tags');
    const taken = current.find((t) => sameName(t.name, name));
    if (taken) {
      midiStore.setTagList(current);
      addExisting(taken);
      return;
    }
    const { data } = await axios.put<AppTag[]>('/api/tags/sync', [...current, { name, color: NEW_TAG_COLOR }]);
    midiStore.setTagList(data);
    const before = new Set(current.map((t) => t.id));
    const created = data.find((t) => !before.has(t.id));
    if (created) addExisting(created);
  } catch (err) {
    console.error('Tag creation failed', err);
    notify('label.saveFailed', 'error');
  } finally {
    creatingTag.value = false;
  }
}

watch(() => draft.coilCount, (n) => {
  if (draft.coils.length === n) return;
  const next: CoilConfig[] = [];
  for (let i = 0; i < n; i++) next.push(draft.coils[i] ?? defaultCoil(i));
  draft.coils = next;
});

// --- MIDI library / upload modal (extracted to editor/MidiLibraryModal.vue) ---
const showLibrary = ref(false);

// --- unsaved changes: the draft against what the server holds, as a save would send it ---
const baseline = ref('');
function snapshot(): string {
  const p = buildPayload();
  return JSON.stringify({ ...p, tagIds: [...p.tagIds].sort() });
}
function markSaved(): void {
  baseline.value = snapshot();
}

function load(song: Song | null | undefined): void {
  showLibrary.value = false; // its "used by" links open another song here
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
  markSaved();
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
  markSaved();
}

// Reload only when actually switching to a different song. This avoids the
// editor clobbering the user's draft when our own save() replaces the song in
// the store (same id) and the prop reference changes.
watch(() => props.song, (s) => {
  if (s && s.id === draft.id) return;
  load(s);
}, { immediate: true });

const dirty = computed(() => snapshot() !== baseline.value);
watch(dirty, (d) => emit('dirty', d), { immediate: true });
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => dirty.value);

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

const saving = ref(false);
async function save(): Promise<void> {
  if (saving.value || !dirty.value) return;
  const payload = buildPayload();
  const sent = snapshot();
  const isNew = !draft.id;
  saving.value = true;

  try {
    const { data } = isNew
      ? await axios.post<Song>('/api/songs', payload)
      : await axios.put<Song>(`/api/songs/${draft.id}`, payload);

    draft.id = data.id;
    // before 'saved': a new song's page then moves to its id, past the leave guard
    baseline.value = sent;

    if (isNew) midiStore.addMidiSongToList(data);
    else midiStore.updateMidiSong(data);

    emit('saved', data);
    notify('label.songSaved');
  } catch (err) {
    console.error('Save failed', err);
    notify('label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}

const confirmDeleteSong = ref(false);
function doDelete(): void {
  const id = draft.id;
  confirmDeleteSong.value = false;
  if (!id) return;
  axios.delete(`/api/songs/${id}`).then(() => {
    midiStore.deleteMidiSong(id);
    markSaved(); // nothing left to keep: the way back to the chooser must not ask
    emit('deleted', id);
  });
}

function onKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  if (!leavePending.value && !confirmDeleteSong.value) save();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

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
// what the phone layout hides but the song keeps (and saves as it is)
const largeScreenOnly = computed(() => {
  if (draft.stereo) return draft.events.length ? 'label.largeScreenBoth' : 'label.largeScreenStereo';
  return draft.events.length ? 'label.largeScreenDynamics' : null;
});

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
          <RouterLink v-if="selectedFile" class="field-btn midi-field__edit"
            :to="{ name: 'midi-edit', params: { id: selectedFile.id } }" :title="$t('midiEditor.open')"
            :aria-label="$t('midiEditor.open')">
            <i class="fas fa-pen-to-square"></i>
          </RouterLink>
          <button v-else class="field-btn midi-field__edit" type="button" disabled :title="$t('midiEditor.open')"
            :aria-label="$t('midiEditor.open')">
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

          <div class="midi-lib__dropdown" :class="{ 'is-open': openMenu === 'tags' }" @keydown="onMenuKey"
            @focusin="onMenuFocusIn('tags', $event)" @focusout="onMenuFocusOut">
            <button class="editor-tags__add" type="button" :title="$t('label.addTag')" :aria-label="$t('label.addTag')"
              aria-haspopup="true" :aria-expanded="openMenu === 'tags'" @click="toggleMenu('tags', $event)">
              <i class="fas fa-plus"></i>
            </button>
            <div class="midi-lib__dropdown-menu">
              <div class="midi-lib__dropdown-header">{{ $t('label.addTag') }}</div>
              <button v-for="t in availableTagsToAdd" :key="t.id" class="midi-lib__dropdown-item tag-dropdown-item"
                type="button" @click="addTag(t)">
                <span class="cfg-name-dot" :style="{ '--c': t.color }"></span>
                <span class="tag-dropdown-name">{{ t.name }}</span>
              </button>
              <div v-if="availableTagsToAdd.length" class="midi-lib__dropdown-divider"></div>
              <form class="tag-new" @submit.prevent="createTag">
                <input v-model="newTagName" class="text-field tag-new__input" type="text" maxlength="24"
                  :placeholder="$t('label.newTag')" :aria-label="$t('label.newTag')">
                <button class="tag-new__add" type="submit" :disabled="!newTagName.trim() || creatingTag"
                  :title="$t('label.createTag')" :aria-label="$t('label.createTag')">
                  <i class="fas" :class="creatingTag ? 'fa-spinner fa-spin' : 'fa-check'"></i>
                </button>
              </form>
            </div>
          </div>
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

    <p v-if="largeScreenOnly" class="editor-large-only">
      <i class="fas fa-display"></i>{{ $t(largeScreenOnly) }}
    </p>

    <div class="editor-footer">
      <button v-if="draft.id" class="btn btn--danger-ghost editor-footer__delete" type="button"
        @click="confirmDeleteSong = true">
        <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.deleteSong') }}
      </button>
      <span v-if="dirty" class="editor-dirty"><i class="fas fa-circle"></i>{{ $t('label.unsavedChanges') }}</span>
      <button class="btn btn--volt" type="button" :disabled="!dirty || saving" :title="$t('label.saveShortcut')"
        @click="save">
        <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span>
        {{ draft.id ? $t('label.update') : $t('label.save') }}
      </button>
    </div>

    <ConfirmModal :open="confirmDeleteSong" :title="$t('label.deleteSong')"
      :message="`${$t('label.deleteQuestion')} « ${draft.name || ('#' + draft.id)} » ?`"
      :confirm-label="$t('label.confirm')" :cancel-label="$t('label.cancel')" @confirm="doDelete"
      @close="confirmDeleteSong = false" />

    <MidiLibraryModal :open="showLibrary" :current-id="draft.midiFileId" @close="showLibrary = false"
      @select="draft.midiFileId = $event" />
    <!-- last: above the library, whose links can be what asks -->
    <ConfirmModal :open="leavePending" :title="$t('label.unsavedChanges')" :message="$t('label.discardSong')"
      :confirm-label="$t('label.discard')" :cancel-label="$t('label.cancel')" @confirm="answerLeave(true)"
      @close="answerLeave(false)" />
  </div>
</template>
