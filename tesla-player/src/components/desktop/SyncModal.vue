<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type {
  TeslaApplyOutcome,
  TeslaEntityType,
  TeslaSyncChoice,
  TeslaSyncDiff,
  TeslaSyncDiffItem,
  TeslaSyncProgress,
  TeslaSyncSelection,
} from '@/types/electron';
import BaseModal from '@/components/ui/BaseModal.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'applied'): void }>();

const loading = ref(false);
const applying = ref(false);
const progress = ref<TeslaSyncProgress | null>(null);
const error = ref('');
const diff = ref<TeslaSyncDiff | null>(null);
const result = ref<TeslaApplyOutcome | null>(null);
const choices = ref<Record<string, TeslaSyncChoice>>({});

let unsubscribe: (() => void) | null = null;

// Type -> i18n key, in the order rows are shown (deps first).
const GROUPS: { type: TeslaEntityType; key: string }[] = [
  { type: 'midiFile', key: 'midiFiles' },
  { type: 'song', key: 'songs' },
  { type: 'playlist', key: 'playlists' },
];

const groups = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    items: (diff.value?.items ?? []).filter((i) => i.type === g.type),
  })).filter((g) => g.items.length > 0),
);

const hasChanges = computed(() => (diff.value?.items.length ?? 0) > 0);

function humanize(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /no server/i.test(msg) ? '' : msg; // empty => show the noServer hint
}

async function preview(): Promise<void> {
  loading.value = true;
  error.value = '';
  result.value = null;
  progress.value = null;
  try {
    const d = await window.teslaElectron!.previewSync();
    diff.value = d;
    const next: Record<string, TeslaSyncChoice> = {};
    for (const it of d.items) next[it.uuid] = it.defaultChoice;
    choices.value = next;
  } catch (e) {
    diff.value = null;
    error.value = humanize(e);
    if (!error.value) noServer.value = true;
  } finally {
    loading.value = false;
  }
}

const noServer = ref(false);

async function apply(): Promise<void> {
  if (!diff.value) return;
  applying.value = true;
  error.value = '';
  progress.value = null;
  try {
    const selections: TeslaSyncSelection[] = diff.value.items.map((i) => ({
      type: i.type,
      uuid: i.uuid,
      choice: choices.value[i.uuid] ?? 'skip',
    }));
    result.value = await window.teslaElectron!.applySync(selections);
    emit('applied');
  } catch (e) {
    error.value = humanize(e) || 'sync error';
  } finally {
    applying.value = false;
  }
}

function choicesFor(status: TeslaSyncDiffItem['status']): TeslaSyncChoice[] {
  if (status === 'only-local') return ['local', 'skip'];
  if (status === 'only-remote') return ['remote', 'skip'];
  return ['local', 'remote', 'skip'];
}

function choiceLabel(c: TeslaSyncChoice): string {
  return c === 'local'
    ? 'desktop.keepLocal'
    : c === 'remote'
      ? 'desktop.keepRemote'
      : 'desktop.skip';
}

function statusKey(status: TeslaSyncDiffItem['status']): string {
  return status === 'only-local'
    ? 'desktop.onlyLocal'
    : status === 'only-remote'
      ? 'desktop.onlyRemote'
      : 'desktop.conflict';
}

function fmt(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—';
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      noServer.value = false;
      void preview();
    }
  },
);

onMounted(() => {
  unsubscribe =
    window.teslaElectron?.onSyncProgress((p) => {
      progress.value = p;
    }) ?? null;
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
});
</script>

<template>
  <BaseModal :open="open" :title="$t('desktop.syncTitle')" icon="fa-rotate" card-class="sync-modal"
    :close-label="$t('label.cancel')" @close="emit('close')">
    <!-- What sync does -->
        <div v-if="!result" class="sync-callout">
          <div class="sync-callout__title">
            <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('desktop.syncIntroTitle') }}
          </div>
          <ul class="sync-callout__list">
            <li>{{ $t('desktop.syncBullet1') }}</li>
            <li>{{ $t('desktop.syncBullet2') }}</li>
            <li>{{ $t('desktop.syncBullet3') }}</li>
            <li>{{ $t('desktop.syncBullet4') }}</li>
          </ul>
        </div>

        <!-- No server configured -->
        <p v-if="noServer" class="sync-modal__note">{{ $t('desktop.noServer') }}</p>

        <!-- Loading the diff -->
        <p v-else-if="loading" class="sync-modal__note">
          <span class="icon"><i class="fas fa-circle-notch fa-spin"></i></span>{{ $t('desktop.comparing') }}
        </p>

        <!-- Result summary -->
        <div v-else-if="result" class="sync-modal__result">
          <p class="sync-modal__done">
            <span class="icon"><i class="fas fa-check"></i></span>{{ $t('desktop.done') }} —
            {{ result.pulled }} {{ $t('desktop.pulled') }}, {{ result.pushed }} {{ $t('desktop.pushed') }}
          </p>
          <div v-if="result.warnings.length" class="sync-modal__warnings">
            <div class="field-label">{{ $t('desktop.warnings') }}</div>
            <ul>
              <li v-for="(w, i) in result.warnings" :key="i">{{ w }}</li>
            </ul>
          </div>
          <div class="sync-modal__actions">
            <button class="btn btn--volt" type="button" @click="emit('close')">{{ $t('label.confirm') }}</button>
          </div>
        </div>

        <!-- Error -->
        <p v-else-if="error" class="sync-modal__error" role="alert">{{ $t('desktop.failed') }} — {{ error }}</p>

        <!-- Nothing to do -->
        <p v-else-if="!hasChanges" class="sync-modal__note">
          <span class="icon"><i class="fas fa-check"></i></span>{{ $t('desktop.inSync') }}
        </p>

        <!-- Diff -->
        <template v-else>
          <div class="sync-modal__body">
            <section v-for="g in groups" :key="g.type" class="sync-group">
              <div class="sync-group__title">{{ $t('desktop.' + g.key) }}</div>
              <div v-for="it in g.items" :key="it.uuid" class="sync-row">
                <div class="sync-row__info">
                  <span class="sync-row__name">{{ it.name || it.uuid }}</span>
                  <span class="sync-row__badge" :class="'is-' + it.status">{{ $t(statusKey(it.status)) }}</span>
                  <span v-if="it.duplicate" class="sync-row__badge is-duplicate"
                    :title="$t('desktop.duplicateHint')">{{ $t('desktop.duplicate') }}</span>
                  <span v-if="it.status === 'conflict'" class="sync-row__times">
                    {{ $t('desktop.thisComputer') }}: {{ fmt(it.localUpdatedAt) }} ·
                    {{ $t('desktop.server') }}: {{ fmt(it.remoteUpdatedAt) }}
                  </span>
                </div>
                <segmented-control v-model="choices[it.uuid]" class="sync-row__choice"
                  :options="choicesFor(it.status).map((c) => ({ value: c, label: $t(choiceLabel(c)) }))" />
              </div>
            </section>
          </div>

          <p v-if="progress" class="sync-modal__progress">
            {{ $t('desktop.prog.' + progress.key, progress.params || {}) }}
          </p>

          <div class="sync-modal__actions">
            <button class="btn btn--ghost" type="button" :disabled="applying" @click="emit('close')">
              {{ $t('label.cancel') }}
            </button>
            <button class="btn btn--volt" type="button" :disabled="applying" @click="apply">
              <span v-if="applying" class="icon"><i class="fas fa-circle-notch fa-spin"></i></span>
              {{ $t('desktop.apply') }}
            </button>
          </div>
        </template>
  </BaseModal>
</template>

<style scoped>
.sync-callout {
  background: rgba(255, 209, 77, 0.08);
  border: 1px solid rgba(255, 209, 77, 0.3);
  border-left: 3px solid #ffd24d;
  border-radius: 8px; padding: 0.7rem 0.9rem 0.75rem; margin: 0 0 1.2rem;
}
.sync-callout__title {
  display: flex; align-items: center; gap: 0.45rem;
  font-weight: 600; font-size: 0.85rem; color: #ffd966; margin-bottom: 0.45rem;
}
.sync-callout__title .icon { color: #ffd24d; }
.sync-callout__list { margin: 0; padding-left: 1.15rem; color: var(--text-mute); font-size: 0.8rem; line-height: 1.5; }
.sync-callout__list li { margin: 0.12rem 0; }
.sync-modal__note { color: var(--text-mute); display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0; }
.sync-modal__error { color: var(--danger, #ff6b6b); padding: 0.6rem 0; }
.sync-modal__body { display: flex; flex-direction: column; gap: 1.1rem; max-height: 52vh; overflow-y: auto; margin-bottom: 1rem; }
.sync-group__title {
  font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--text-mute); margin-bottom: 0.4rem;
}
.sync-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; padding: 0.4rem 0; }
.sync-row__info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.sync-row__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sync-row__badge {
  font-family: var(--font-mono); font-size: 0.66rem; text-transform: uppercase;
  letter-spacing: 0.05em; align-self: flex-start; padding: 0.05rem 0.4rem; border-radius: 4px;
  background: rgba(255, 255, 255, 0.06); color: var(--text-mute);
}
.sync-row__badge.is-conflict { color: #ffb454; }
.sync-row__badge.is-duplicate { color: #ff8c69; background: rgba(255, 140, 105, 0.12); }
.sync-row__times { font-size: 0.68rem; color: var(--text-mute); }
.sync-row__choice { flex: 0 0 auto; }
.sync-modal__progress { font-size: 0.78rem; color: var(--text-mute); margin: 0 0 0.6rem; }
.sync-modal__actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
.sync-modal__done { display: flex; align-items: center; gap: 0.5rem; margin: 0.4rem 0 1rem; }
.sync-modal__warnings { font-size: 0.8rem; color: var(--text-mute); margin-bottom: 1rem; }
.sync-modal__warnings ul { margin: 0.3rem 0 0; padding-left: 1.1rem; }
.field-label {
  font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--text-mute);
}
</style>
