<script setup lang="ts">
import MidiLibraryPanel from '@/components/editor/MidiLibraryPanel.vue';

/**
 * Standalone MIDI file management page (sidebar). Shows the same interface as the
 * editor's library modal — reusing {@link MidiLibraryPanel} so there's no
 * duplication. There's no song to select for here, so the panel's `select`
 * event is ignored.
 */
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('title.midiFileManager') }}</h1>
    </header>

    <div class="screen-body midi-files">
      <section class="midi-files__panel">
        <midi-library-panel />
      </section>
    </div>

  </div>
</template>

<style scoped>
/* Full-width table; the manager fills the page so a file can be dropped anywhere on it. */
.midi-files { display: flex; min-height: 0; height: 100%; }
.midi-files__panel {
  width: 100%; min-height: 0;
  display: flex; flex-direction: column;
}
.midi-files__panel :deep(.midi-lib) { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.midi-files__panel :deep(.midi-lib__list) { flex: 1 1 auto; min-height: 0; }
</style>
