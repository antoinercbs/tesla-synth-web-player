<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/app/stores/midi';
import { MAX_COILS, MIN_COILS, type Song } from '@/model/domain';
import BaseModal from '@/ui/components/ui/BaseModal.vue';
import SearchableSelect from '@/ui/components/ui/SearchableSelect.vue';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import { baseName, createSongFromFile, createSongFromSong, MIDI_FILE_NAME } from '@/app/song-file';
import { useFileDrop } from '@/ui/helpers/file-drop';
import { notify } from '@/ui/helpers/toast';
import { serverMessage } from '@/api/http';

/**
 * A new song: its name, its MIDI file (dropped or picked here, several for as
 * many songs, or a copy of another song's notes) and how many coils it starts
 * with. `dropped` on the library, the files are already chosen. Emits what it
 * made; the library opens the first.
 */
const props = defineProps<{ open: boolean; dropped?: File[] }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'created', songs: Song[]): void }>();

const { t } = useI18n();
const midiStore = useMidiStore();
const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const files = ref<File[]>([]);
const sourceId = ref<number | null>(null);
const name = ref('');

// the coils it starts with: as many as the last song made on this device, within the inventory
const COUNT_KEY = 'newSongCoils';
const most = computed(() => Math.max(MIN_COILS, Math.min(MAX_COILS, midiStore.coilList.length || MAX_COILS)));
const countOptions = computed(() => Array.from({ length: most.value - MIN_COILS + 1 }, (_, i) => ({ value: MIN_COILS + i, label: String(MIN_COILS + i) })));
function lastCount(): number {
  let n = midiStore.appConfig.defaultCoilCount || 3;
  try { n = Number(localStorage.getItem(COUNT_KEY)) || n; } catch { /* the club's default */ }
  return Math.max(MIN_COILS, Math.min(most.value, n));
}
const count = ref(3);

watch(() => props.open, (open) => {
  if (!open) return;
  files.value = (props.dropped ?? []).filter((f) => MIDI_FILE_NAME.test(f.name));
  sourceId.value = null;
  name.value = files.value.length === 1 ? baseName(files.value[0].name) : '';
  count.value = lastCount();
}, { immediate: true });

const sources = computed(() =>
  midiStore.midiSongList
    .filter((s) => s.midiFile)
    .map((s) => ({ id: s.id, label: s.name || `#${s.id}` }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);
const source = computed(() => midiStore.midiSongList.find((s) => s.id === sourceId.value) ?? null);

function choose(list: File[]): void {
  const midi = list.filter((f) => MIDI_FILE_NAME.test(f.name));
  if (!midi.length) {
    notify('label.notAMidiFile', 'error');
    return;
  }
  files.value = midi;
  sourceId.value = null;
  // its name from the file, unless one was typed
  if (midi.length === 1 && !name.value.trim()) name.value = baseName(midi[0].name);
}
function onPicked(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) choose([...input.files]);
  input.value = '';
}
watch(sourceId, (id) => {
  if (id == null) return;
  files.value = [];
  if (!name.value.trim()) name.value = baseName(source.value?.midiFile?.name ?? source.value?.name ?? '');
});
const { active: dragActive, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop((list) => choose([...list]));

// one name for one song; several files are named after themselves
const named = computed(() => files.value.length <= 1);
const ready = computed(() => !busy.value && (files.value.length > 0 || source.value != null) && (!named.value || name.value.trim().length > 0));

async function create(): Promise<void> {
  if (!ready.value) return;
  busy.value = true;
  try {
    try { localStorage.setItem(COUNT_KEY, String(count.value)); } catch { /* for the visit */ }
    const made: Song[] = [];
    if (source.value) made.push(await createSongFromSong(source.value, { name: name.value.trim(), coilCount: count.value }));
    else {
      for (const f of files.value) {
        made.push(await createSongFromFile(f, { name: named.value ? name.value.trim() : baseName(f.name), coilCount: count.value }));
      }
    }
    emit('created', made);
  } catch (err) {
    console.error('Song creation failed', err);
    const why = serverMessage(err);
    const failure = source.value ? 'label.saveFailed' : 'label.uploadFailed';
    notify(why ? `${t(failure)} : ${why}` : failure, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseModal :open="open" :title="$t('newSong.title')" card-class="new-song-modal"
    :close-label="$t('label.close')" @close="emit('close')">
    <form class="new-song" @submit.prevent="create">
      <!-- its notes: a file, or a copy of another song's -->
      <div class="new-song__drop" :class="{ 'is-active': dragActive, 'is-set': files.length }" @dragenter="onDragEnter"
        @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
        <span class="new-song__drop-icon"><i class="fas" :class="files.length ? 'fa-file-circle-check' : 'fa-file-audio'"></i></span>
        <p v-if="files.length" class="new-song__files">{{ files.map((f) => f.name).join(', ') }}</p>
        <p v-else class="new-song__lead">{{ $t('newSong.drop') }}</p>
        <button class="btn" :class="{ 'btn--volt': !files.length && sourceId == null }" type="button" :disabled="busy"
          :data-autofocus="files.length ? undefined : ''" @click="fileInput?.click()">
          <span class="icon"><i class="fas fa-folder-open"></i></span>{{ $t(files.length ? 'newSong.otherFile' : 'newSong.chooseFile') }}
        </button>
        <input ref="fileInput" type="file" accept=".mid,.midi,audio/midi" multiple hidden @change="onPicked">
      </div>

      <div v-if="sources.length && !files.length" class="new-song__from">
        <span class="new-song__or">{{ $t('newSong.or') }}</span>
        <span class="field-label">{{ $t('newSong.fromSong') }}</span>
        <SearchableSelect v-model="sourceId" :items="sources" :label="$t('newSong.fromSong')" :placeholder="$t('newSong.pickSong')" />
      </div>

      <!-- its name, and the coils it starts with -->
      <label v-if="named" class="new-song__field">
        <span class="field-label">{{ $t('label.songName') }}</span>
        <input v-model="name" class="text-field" type="text" maxlength="120" :placeholder="$t('newSong.namePlaceholder')"
          :data-autofocus="files.length ? '' : undefined">
      </label>
      <p v-else class="new-song__hint">{{ $t('newSong.namedAfterFiles', files.length) }}</p>
      <div class="new-song__field">
        <span class="field-label" :title="$t('newSong.coilsHint')">{{ $t('newSong.coils') }}</span>
        <segmented-control v-model="count" :options="countOptions" :aria-label="$t('newSong.coils')" />
      </div>
    </form>
    <template #actions>
      <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
      <button class="btn btn--volt" type="button" :disabled="!ready" @click="create">
        <span class="icon"><i class="fas" :class="busy ? 'fa-spinner fa-spin' : 'fa-plus'"></i></span>{{
          files.length > 1 ? $t('newSong.createMany', files.length) : $t('newSong.create') }}
      </button>
    </template>
  </BaseModal>
</template>
