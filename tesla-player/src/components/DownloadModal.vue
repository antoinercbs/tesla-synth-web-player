<script setup lang="ts">
import { ref, watch } from 'vue';
import axios from 'axios';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

type Os = 'linux' | 'windows';
interface DownloadTarget {
  available: boolean;
  size?: number;
}
type Manifest = Partial<Record<Os, DownloadTarget>>;

const loading = ref(false);
const targets = ref<{ os: Os; size?: number }[]>([]);
const failed = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    loading.value = true;
    failed.value = false;
    targets.value = [];
    axios
      .get('/api/downloads/manifest')
      .then((r) => {
        const m = r.data as Manifest;
        targets.value = (['linux', 'windows'] as Os[])
          .filter((os) => m[os]?.available)
          .map((os) => ({ os, size: m[os]?.size }));
      })
      .catch(() => {
        failed.value = true;
      })
      .finally(() => {
        loading.value = false;
      });
  },
);

function hrefFor(os: Os): string {
  const base = import.meta.env.VITE_BASE_URL || '';
  return `${base}/api/downloads/${os}`;
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
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-card dl-modal">
        <div class="modal-card__head">
          <span class="modal-card__title">
            <span class="icon"><i class="fas fa-download"></i></span>{{ $t('desktop.downloadApp') }}
          </span>
          <button class="icon-btn" type="button" :aria-label="$t('label.cancel')" @click="emit('close')">
            <i class="fas fa-xmark"></i>
          </button>
        </div>

        <p class="dl-modal__hint">{{ $t('desktop.downloadHint') }}</p>

        <p v-if="loading" class="dl-modal__note">
          <span class="icon"><i class="fas fa-circle-notch fa-spin"></i></span>{{ $t('label.loading') }}
        </p>
        <p v-else-if="failed || !targets.length" class="dl-modal__note">{{ $t('desktop.noBuild') }}</p>

        <div v-else class="dl-modal__options">
          <a v-for="t in targets" :key="t.os" class="dl-option" :href="hrefFor(t.os)" :download="''"
            @click="emit('close')">
            <span class="dl-option__icon"><i :class="osIcon(t.os)"></i></span>
            <span class="dl-option__label">{{ $t('desktop.' + t.os) }}</span>
            <span class="dl-option__size">{{ fmtSize(t.size) }}</span>
            <span class="dl-option__go"><i class="fas fa-download"></i></span>
          </a>
        </div>

        <div class="dl-modal__actions">
          <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dl-modal { max-width: 440px; width: 100%; }
.dl-modal__hint { color: var(--text-mute); font-size: 0.85rem; margin: 0 0 1.1rem; }
.dl-modal__note { color: var(--text-mute); display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0 1rem; }
.dl-modal__options { display: flex; flex-direction: column; gap: 0.55rem; margin-bottom: 1.2rem; }
.dl-option {
  display: flex; align-items: center; gap: 0.7rem;
  padding: 0.7rem 0.9rem; border-radius: 8px; text-decoration: none;
  background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); color: var(--text);
}
.dl-option:hover { background: rgba(255, 255, 255, 0.08); border-color: var(--volt); }
.dl-option__icon { font-size: 1.25rem; width: 1.6rem; text-align: center; }
.dl-option__label { flex: 1 1 auto; }
.dl-option__size { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-mute); }
.dl-option__go { color: var(--text-mute); }
.dl-modal__actions { display: flex; justify-content: flex-end; }
</style>
