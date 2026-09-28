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
      <span class="arc-loader" aria-hidden="true"></span>{{ $t('label.loading') }}
    </p>
    <p v-else-if="failed || !targets.length" class="dl-modal__note">{{ $t('desktop.noBuild') }}</p>

    <div v-else class="dl-modal__options">
      <button v-for="t in targets" :key="t.os" type="button" class="dl-option" :disabled="busy !== null"
        @click="download(t)">
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
