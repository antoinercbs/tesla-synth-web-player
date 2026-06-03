<script setup lang="ts">
import { ref } from 'vue';
import type { MidiFile } from '@/types/domain';
import MidiLibraryPanel from '@/components/editor/MidiLibraryPanel.vue';
import MidiInstrumentsModal from '@/components/settings/MidiInstrumentsModal.vue';

/**
 * Standalone MIDI file management page (sidebar). Shows the same interface as the
 * editor's library modal — reusing {@link MidiLibraryPanel} so there's no
 * duplication — plus the channel-instruments editor. There's no song to select
 * for here, so the panel's `select` event is ignored.
 */
const instrumentsFile = ref<MidiFile | null>(null);
const showInstruments = ref(false);
function openInstruments(file: MidiFile): void {
  instrumentsFile.value = file;
  showInstruments.value = true;
}
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('title.midiFileManager') }}</h1>
    </header>

    <div class="screen-body midi-files">
      <section class="midi-files__panel">
        <midi-library-panel @edit-instruments="openInstruments" />
      </section>
    </div>

    <midi-instruments-modal :open="showInstruments" :file="instrumentsFile" @close="showInstruments = false" />
  </div>
</template>

<style scoped>
/* Centre the manager in a comfortable column rather than stretching it full-width. */
.midi-files { display: flex; justify-content: center; min-height: 0; }
.midi-files__panel {
  width: 100%; max-width: 720px; min-height: 0;
  display: flex; flex-direction: column;
}
.midi-files__panel :deep(.midi-lib) { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.midi-files__panel :deep(.midi-lib__list) { flex: 1 1 auto; min-height: 0; }
</style>
