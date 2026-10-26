<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import BaseModal from '@/ui/components/ui/BaseModal.vue';
import { serverMessage } from '@/api/http';

/**
 * The whole library in one file (nest-backend/src/backup): download it, or
 * restore one. A restore brings each item of the file back to its saved
 * version and keeps what was added since; it asks first.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'restored'): void }>();
const { t } = useI18n();

interface RestoreResult {
  midiFiles: number;
  songs: { created: number; updated: number };
  playlists: { created: number; updated: number };
  envelopes: { created: number; updated: number };
  /** Absent from servers that predate the coil inventory. */
  coils?: { created: number; updated: number };
  /** Absent from servers that predate the scenes. */
  scenes?: { created: number; updated: number };
  tags: number;
  tunings: { created: number; updated: number };
  settings: boolean;
  warnings: string[];
}

const exporting = ref(false);
const exportError = ref('');
const picked = ref<File | null>(null);
const restoring = ref(false);
const restoreError = ref('');
const result = ref<RestoreResult | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// opened again: a fresh start
watch(() => props.open, (open) => {
  if (!open) return;
  exportError.value = '';
  picked.value = null;
  restoreError.value = '';
  result.value = null;
});

async function download(): Promise<void> {
  exporting.value = true;
  exportError.value = '';
  try {
    const { data, headers } = await axios.get<Blob>('/api/backup', { responseType: 'blob' });
    const disposition = String(headers['content-disposition'] ?? '');
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `tesla-player-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    exportError.value = serverMessage(err) ?? t('backup.exportFailed');
  } finally {
    exporting.value = false;
  }
}

function onPicked(e: Event): void {
  const input = e.target as HTMLInputElement;
  picked.value = input.files?.[0] ?? null;
  restoreError.value = '';
  result.value = null;
  input.value = '';
}

async function restore(): Promise<void> {
  const file = picked.value;
  if (!file) return;
  restoring.value = true;
  restoreError.value = '';
  try {
    const form = new FormData();
    form.append('file', file);
    const { data } = await axios.post<RestoreResult>('/api/backup', form);
    result.value = data;
    picked.value = null;
    emit('restored');
  } catch (err) {
    restoreError.value = serverMessage(err) ?? t('backup.restoreFailed');
  } finally {
    restoring.value = false;
  }
}

// what came back, a line per kind that had anything
const summary = computed(() => {
  const r = result.value;
  if (!r) return [];
  const both = (c: { created: number; updated: number }, key: string): string[] =>
    c.created + c.updated ? [t(`backup.result.${key}`, { created: c.created, updated: c.updated })] : [];
  return [
    ...(r.midiFiles ? [t('backup.result.midiFiles', r.midiFiles)] : []),
    ...both(r.songs, 'songs'),
    ...both(r.playlists, 'playlists'),
    ...both(r.envelopes, 'envelopes'),
    ...(r.coils ? both(r.coils, 'coils') : []),
    ...(r.scenes ? both(r.scenes, 'scenes') : []),
    ...(r.tags ? [t('backup.result.tags', r.tags)] : []),
    ...both(r.tunings, 'tunings'),
    ...(r.settings ? [t('backup.result.settings')] : []),
  ];
});

function close(): void {
  if (restoring.value) return;
  emit('close');
}
</script>

<template>
  <base-modal :open="open" :title="$t('backup.title')" card-class="backup-modal"
    :close-label="$t('label.close')" @close="close">
    <section class="backup">
      <p class="backup__text">{{ $t('backup.exportText') }}</p>
      <button class="btn btn--volt" type="button" :disabled="exporting" @click="download">
        <span class="icon"><i class="fas" :class="exporting ? 'fa-spinner fa-spin' : 'fa-download'"></i></span>{{ $t('backup.download') }}
      </button>
      <p v-if="exportError" class="field-error" role="alert">{{ exportError }}</p>
    </section>

    <section class="backup">
      <p class="backup__text">{{ $t('backup.restoreText') }}</p>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onPicked" />

      <div v-if="picked" class="lib__msg is-confirm backup__confirm" role="alert">
        <span class="lib__confirm-text"><i class="fas fa-triangle-exclamation"></i>{{ $t('backup.confirm', { name: picked.name }) }}</span>
        <span class="lib__confirm-actions">
          <button class="btn btn--danger" type="button" :disabled="restoring" @click="restore">
            <span class="icon"><i class="fas" :class="restoring ? 'fa-spinner fa-spin' : 'fa-rotate-left'"></i></span>{{ $t('backup.restore') }}
          </button>
          <button class="btn btn--ghost" type="button" :disabled="restoring" @click="picked = null">{{ $t('label.cancel') }}</button>
        </span>
      </div>
      <button v-else class="btn" type="button" @click="fileInput?.click()">
        <span class="icon"><i class="fas fa-file-import"></i></span>{{ $t('backup.pick') }}
      </button>
      <p v-if="restoreError" class="field-error" role="alert">{{ restoreError }}</p>

      <div v-if="result" class="backup__result" role="status">
        <p class="backup__done"><i class="fas fa-circle-check"></i>{{ $t('backup.done') }}</p>
        <ul v-if="summary.length" class="backup__list">
          <li v-for="line in summary" :key="line">{{ line }}</li>
        </ul>
        <details v-if="result.warnings.length" class="backup__warnings">
          <summary>{{ $t('backup.warnings', result.warnings.length) }}</summary>
          <ul><li v-for="w in result.warnings" :key="w">{{ w }}</li></ul>
        </details>
      </div>
    </section>
  </base-modal>
</template>
