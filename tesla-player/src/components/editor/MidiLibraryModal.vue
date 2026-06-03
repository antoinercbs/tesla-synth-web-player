<script setup lang="ts">
import type { MidiFile } from '@/types/domain';
import BaseModal from '@/components/ui/BaseModal.vue';
import MidiLibraryPanel from '@/components/editor/MidiLibraryPanel.vue';

/**
 * The MIDI file manager as a modal (used by the song editor to pick a file).
 * The interface itself lives in {@link MidiLibraryPanel} so it can be shared with
 * the standalone MIDI files page without duplication. BaseModal renders the panel
 * with `v-if`, so its transient state resets each time the modal reopens.
 */
defineProps<{ open: boolean; currentId: number | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select', id: number | null): void;
  (e: 'edit-instruments', file: MidiFile): void;
}>();
</script>

<template>
  <BaseModal :open="open" :title="$t('title.midiFileManager')" icon="fa-folder-open"
    :close-label="$t('label.closeEditor')" @close="emit('close')">
    <midi-library-panel :current-id="currentId"
      @select="emit('select', $event)" @edit-instruments="emit('edit-instruments', $event)" />
  </BaseModal>
</template>
