<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/stores/midi';
import type { Song } from '@/types/domain';
import BaseModal from '@/components/ui/BaseModal.vue';
import SearchableSelect from '@/components/ui/SearchableSelect.vue';
import { createSongFromSong, createSongsFromFiles } from '@/midi/song-file';
import { useFileDrop } from '@/utils/file-drop';
import { notify } from '@/utils/toast';
import { serverMessage } from '@/utils/http';

/**
 * A new song. A song is its MIDI file: it starts from one, dropped or picked
 * here (several files, several songs), or from a copy of another song's notes.
 * Emits what it made; the library opens the first.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'created', songs: Song[]): void }>();

const { t } = useI18n();
const midiStore = useMidiStore();
const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const sourceId = ref<number | null>(null);
watch(() => props.open, (open) => { if (open) sourceId.value = null; });

const sources = computed(() =>
  midiStore.midiSongList
    .filter((s) => s.midiFile)
    .map((s) => ({ id: s.id, label: s.name || `#${s.id}` }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

async function make(run: () => Promise<Song[]>, failure: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const made = await run();
    if (made.length) emit('created', made);
    else notify('label.notAMidiFile', 'error');
  } catch (err) {
    console.error('Song creation failed', err);
    const why = serverMessage(err);
    notify(why ? `${t(failure)} : ${why}` : failure, 'error');
  } finally {
    busy.value = false;
  }
}

function fromFiles(files: FileList): void {
  make(() => createSongsFromFiles([...files]), 'label.uploadFailed');
}
function onPicked(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) fromFiles(input.files);
  input.value = '';
}
function fromSong(): void {
  const from = midiStore.midiSongList.find((s) => s.id === sourceId.value);
  if (from) make(async () => [await createSongFromSong(from)], 'label.saveFailed');
}

const { active: dragActive, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop(fromFiles);
</script>

<template>
  <BaseModal :open="open" :title="$t('newSong.title')" icon="fa-file-circle-plus" card-class="new-song-modal"
    :close-label="$t('label.close')" @close="emit('close')">
    <div class="new-song__drop" :class="{ 'is-active': dragActive }" @dragenter="onDragEnter" @dragover="onDragOver"
      @dragleave="onDragLeave" @drop="onDrop">
      <span class="new-song__drop-icon"><i class="fas" :class="busy ? 'fa-spinner fa-spin' : 'fa-file-audio'"></i></span>
      <p class="new-song__lead">{{ $t('newSong.drop') }}</p>
      <button class="btn btn--volt" type="button" :disabled="busy" data-autofocus @click="fileInput?.click()">
        <span class="icon"><i class="fas fa-folder-open"></i></span>{{ $t('newSong.chooseFile') }}
      </button>
      <input ref="fileInput" type="file" accept=".mid,.midi,audio/midi" multiple hidden @change="onPicked">
    </div>

    <form v-if="sources.length" class="new-song__from" @submit.prevent="fromSong">
      <span class="new-song__or">{{ $t('newSong.or') }}</span>
      <span class="field-label">{{ $t('newSong.fromSong') }}</span>
      <div class="new-song__from-row">
        <SearchableSelect v-model="sourceId" :items="sources" :label="$t('newSong.fromSong')"
          :placeholder="$t('newSong.pickSong')" />
        <button class="btn" type="submit" :disabled="sourceId == null || busy">
          <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('newSong.create') }}
        </button>
      </div>
      <p class="new-song__hint">{{ $t('newSong.fromSongHint') }}</p>
    </form>
  </BaseModal>
</template>
