<script setup lang="ts">
import { ref, watch } from 'vue';
import axios from 'axios';
import BaseModal from '@/components/ui/BaseModal.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

type Os = 'linux' | 'windows';
interface DownloadTarget {
  available: boolean;
  file?: string;
  size?: number;
}
type Manifest = Partial<Record<Os, DownloadTarget>>;
interface Target {
  os: Os;
  file?: string;
  size?: number;
}

const loading = ref(false);
const targets = ref<Target[]>([]);
const failed = ref(false);
const busy = ref<Os | null>(null);
const downloadFailed = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    loading.value = true;
    failed.value = false;
    downloadFailed.value = false;
    targets.value = [];
    axios
      .get('/api/downloads/manifest')
      .then((r) => {
        const m = r.data as Manifest;
        targets.value = (['linux', 'windows'] as Os[])
          .filter((os) => m[os]?.available)
          .map((os) => ({ os, file: m[os]?.file, size: m[os]?.size }));
      })
      .catch(() => {
        failed.value = true;
      })
      .finally(() => {
        loading.value = false;
      });
  },
);

/**
 * Fetch the binary VIA AXIOS (so the auth interceptor attaches the Bearer token —
 * a plain <a download> navigation can't, and would 401 to a "linux.json") then
 * save it client-side from the blob.
 */
async function download(t: Target): Promise<void> {
  if (busy.value) return;
  busy.value = t.os;
  downloadFailed.value = false;
  try {
    const res = await axios.get<Blob>(`/api/downloads/${t.os}`, {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = t.file || `tesla-player-${t.os}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    emit('close');
  } catch {
    downloadFailed.value = true;
  } finally {
    busy.value = null;
  }
}

function osIcon(os: Os): string {
  return os === 'windows' ? 'fab fa-windows' : 'fab fa-linux';
}

function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
</script>

<template>
  <BaseModal :open="open" :title="$t('desktop.downloadApp')" icon="fa-download" card-class="dl-modal"
    :close-label="$t('label.cancel')" @close="emit('close')">
    <p class="dl-modal__hint">{{ $t('desktop.downloadHint') }}</p>

    <p v-if="loading" class="dl-modal__note">
      <span class="icon"><i class="fas fa-circle-notch fa-spin"></i></span>{{ $t('label.loading') }}
    </p>
    <p v-else-if="failed || !targets.length" class="dl-modal__note">{{ $t('desktop.noBuild') }}</p>

    <div v-else class="dl-modal__options">
      <button v-for="t in targets" :key="t.os" type="button" class="dl-option"
        :disabled="busy !== null" @click="download(t)">
        <span class="dl-option__icon"><i :class="osIcon(t.os)"></i></span>
        <span class="dl-option__label">{{ $t('desktop.' + t.os) }}</span>
        <span class="dl-option__size">{{ fmtSize(t.size) }}</span>
        <span class="dl-option__go">
          <i class="fas" :class="busy === t.os ? 'fa-circle-notch fa-spin' : 'fa-download'"></i>
        </span>
      </button>
    </div>
    <p v-if="downloadFailed" class="dl-modal__note dl-modal__note--err">{{ $t('desktop.downloadFailed') }}</p>

    <template #actions>
      <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.dl-modal__hint { color: var(--text-mute); font-size: 0.85rem; margin: 0 0 1.1rem; }
.dl-modal__note { color: var(--text-mute); display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0 1rem; }
.dl-modal__note--err { color: var(--danger, #ff6b6b); }
.dl-modal__options { display: flex; flex-direction: column; gap: 0.55rem; margin-bottom: 1.2rem; }
.dl-option {
  display: flex; align-items: center; gap: 0.7rem; width: 100%;
  padding: 0.7rem 0.9rem; border-radius: 8px; text-decoration: none;
  font: inherit; text-align: left; cursor: pointer;
  background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); color: var(--text);
}
.dl-option:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); border-color: var(--volt); }
.dl-option:disabled { opacity: 0.6; cursor: default; }
.dl-option__icon { font-size: 1.25rem; width: 1.6rem; text-align: center; }
.dl-option__label { flex: 1 1 auto; }
.dl-option__size { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-mute); }
.dl-option__go { color: var(--text-mute); }
</style>
