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
  { type: 'envelope', key: 'envelopes' },
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
        <span class="icon"><i class="fas fa-check"></i></span>{{ $t('desktop.done') }}.
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
    <p v-else-if="error" class="sync-modal__error" role="alert">{{ $t('desktop.failed') }}: {{ error }}</p>

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
              <span v-if="it.duplicate" class="sync-row__badge is-duplicate" :title="$t('desktop.duplicateHint')">{{
                $t('desktop.duplicate') }}</span>
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
