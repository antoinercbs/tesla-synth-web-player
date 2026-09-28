<script setup lang="ts">
import MidiLibraryPanel from '@/components/editor/MidiLibraryPanel.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';

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
      <h1 class="view-head__title">{{ $t('title.midiFileManager') }}<page-tour-button id="midi" /></h1>
    </header>

    <div class="screen-body midi-files">
      <section class="midi-files__panel">
        <midi-library-panel />
      </section>
    </div>

  </div>
</template>
