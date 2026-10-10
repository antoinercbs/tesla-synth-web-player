<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/stores/midi';
import { downloadFirmware, type FirmwareImage, type FirmwareRelease } from '@/firmware/api';
import { flashFirmware, requestRomPort, waitForGrantedRomPort } from '@/firmware/flash';
import { boardVersion, formatVersion, versionNumber } from '@/firmware/version';
import { downloadModeFrame } from '@/sysex/board';
import type { DeviceLink } from '@/serial/device-link';
import BaseModal from '@/components/ui/BaseModal.vue';
import { ICONS } from '@/ui/icons';

/**
 * Updating the firmware of a board that reboots into its ROM download mode
 * and is written over the same USB cable (the ESP32). The steps tick along;
 * the only one that may need a click is the ROM's port, which the browser
 * wants picked by hand the first time.
 */
const props = defineProps<{
  open: boolean;
  release: FirmwareRelease | null;
  /** 0x204 of the board, null when unknown. */
  current: number | null;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  /** True from the first step until the board is back: the page must not take the link's loss for good. */
  (e: 'running', running: boolean): void;
  (e: 'done'): void;
}>();

const midiStore = useMidiStore();
const { t } = useI18n();

const STEPS = ['download', 'silence', 'reboot', 'port', 'flash', 'restart'] as const;
type Step = (typeof STEPS)[number];
type Phase = 'ready' | 'running' | 'needPort' | 'done' | 'error';

/** The ROM shows up a moment after the reboot. */
const ROM_WAIT_MS = 8000;
/** The new firmware starts, then USB enumerates. */
const BACK_WAIT_MS = 25000;

const phase = ref<Phase>('ready');
const step = ref<Step | null>(null);
const skipped = ref<Step[]>([]);
const progress = ref(0);
const error = ref('');
const installed = ref<number | null>(null);
let images: FirmwareImage[] | null = null;
let abort: AbortController | null = null;

const running = computed(() => phase.value === 'running');
// until it is over, the board may be in its download mode, without a link: the page stays
const holding = computed(() => phase.value === 'running' || phase.value === 'needPort' || phase.value === 'error');
watch(holding, (h) => emit('running', h));
watch(() => props.open, (open) => { if (open) reset(); });
onBeforeUnmount(() => abort?.abort());

function reset(): void {
  phase.value = 'ready';
  step.value = null;
  skipped.value = [];
  progress.value = 0;
  error.value = '';
  installed.value = null;
  images = null;
}

function stepState(s: Step): 'done' | 'now' | 'todo' | 'skip' | 'error' {
  if (skipped.value.includes(s)) return 'skip';
  if (phase.value === 'done') return 'done';
  const at = step.value ? STEPS.indexOf(step.value) : -1;
  const i = STEPS.indexOf(s);
  if (i < at) return 'done';
  if (i === at) return phase.value === 'error' ? 'error' : 'now';
  return 'todo';
}

function fail(err: unknown): void {
  phase.value = 'error';
  error.value = err instanceof Error ? err.message : String(err);
}

async function start(): Promise<void> {
  if (!props.release || running.value) return;
  abort = new AbortController();
  phase.value = 'running';
  error.value = '';
  try {
    step.value = 'download';
    images ??= await downloadFirmware(props.release);
    const link = midiStore.deviceLink;
    if (link) {
      step.value = 'silence';
      midiStore.panic();
      step.value = 'reboot';
      link.send(downloadModeFrame());
    } else {
      // already in its download mode (a retry, or put there with BOOT + RESET)
      skipped.value = ['silence', 'reboot'];
    }
    step.value = 'port';
    const port = await waitForGrantedRomPort(ROM_WAIT_MS, abort.signal);
    if (abort.signal.aborted) return;
    if (port) await write(port);
    else phase.value = 'needPort';
  } catch (err) {
    fail(err);
  }
}

async function pickPort(): Promise<void> {
  let port: SerialPort;
  try {
    port = await requestRomPort();
  } catch (err) {
    // the picker closed without a choice: still waiting for one
    if ((err as DOMException)?.name !== 'NotFoundError') fail(err);
    return;
  }
  phase.value = 'running';
  try {
    await write(port);
  } catch (err) {
    fail(err);
  }
}

async function write(port: SerialPort): Promise<void> {
  if (!props.release || !images) return;
  step.value = 'flash';
  progress.value = 0;
  await flashFirmware(port, props.release, images, (p) => { progress.value = p.ratio; });
  step.value = 'restart';
  const link = await linkBack();
  // a moment for the new firmware to settle before it answers
  if (link) await new Promise((r) => setTimeout(r, 300));
  const reply = link ? (await link.read(0x204, 0)).find((f) => f.pnFull === 0x204) : undefined;
  installed.value = reply ? boardVersion(reply.valueInt) : null;
  phase.value = 'done';
  emit('done');
}

/** The board's link once its new firmware has started, or null. */
function linkBack(): Promise<DeviceLink | null> {
  if (midiStore.deviceLink) return Promise.resolve(midiStore.deviceLink);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watch(() => midiStore.deviceLink, (link) => {
      if (!link) return;
      clearTimeout(timer);
      stop();
      resolve(link);
    });
    timer = setTimeout(() => { stop(); resolve(null); }, BACK_WAIT_MS);
  });
}

const doneText = computed(() => {
  if (!props.release) return '';
  if (installed.value == null) return t('fw.doneUnchecked');
  return installed.value === versionNumber(props.release.version)
    ? t('fw.done', { version: formatVersion(installed.value) })
    : t('fw.doneOther', { version: formatVersion(installed.value) });
});

function close(): void {
  if (running.value) return;
  abort?.abort();
  reset();
  emit('close');
}
</script>

<template>
  <BaseModal :open="open" :title="t('fw.title')" icon="fa-microchip" card-class="fw-modal" :close-label="t('label.close')"
    :close-on-backdrop="false" :close-on-esc="!running" @close="close">
    <template v-if="release">
      <p class="fw-vers">
        <span>{{ current != null ? formatVersion(current) : '?' }}</span>
        <i class="fas fa-arrow-right"></i>
        <span class="fw-vers__to">v{{ release.version }}</span>
        <span v-if="release.prerelease" class="fw-vers__beta">{{ t('fw.beta') }}</span>
      </p>
      <p v-if="phase === 'ready'" class="fw-intro">{{ t('fw.intro') }}</p>

      <ol class="fw-steps">
        <li v-for="(s, i) in STEPS" :key="s" class="fw-step" :class="`is-${stepState(s)}`">
          <span class="fw-step__ic">
            <i v-if="stepState(s) === 'done'" class="fas fa-check"></i>
            <i v-else-if="stepState(s) === 'error'" class="fas fa-xmark"></i>
            <i v-else-if="stepState(s) === 'skip'" class="fas fa-minus"></i>
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="fw-step__label">{{ t(`fw.steps.${s}`) }}</span>
          <span v-if="s === 'port' && phase === 'needPort'" class="fw-step__body">
            {{ t('fw.portHint') }}
            <button class="btn btn--volt" type="button" @click="pickPort">
              <span class="icon"><i class="fas" :class="ICONS.serial"></i></span>{{ t('fw.portPick') }}
            </button>
          </span>
          <span v-else-if="s === 'flash' && stepState(s) === 'now'" class="fw-step__body">
            {{ t('fw.flashHint') }}
            <span class="fw-bar"><span class="fw-bar__fill" :style="{ width: `${Math.round(progress * 100)}%` }"></span></span>
          </span>
        </li>
      </ol>

      <p v-if="phase === 'done'" class="fw-result is-ok"><i class="fas fa-circle-check"></i>{{ doneText }}</p>
      <p v-else-if="phase === 'error'" class="fw-result is-error"><i class="fas fa-triangle-exclamation"></i>{{ t('fw.error', { message: error }) }}</p>
      <p v-if="phase === 'needPort' || phase === 'error'" class="fw-help">
        <i class="fas fa-circle-info"></i>{{ t('fw.help') }}
      </p>
    </template>

    <template #actions>
      <button v-if="phase === 'ready'" class="btn btn--ghost" type="button" @click="close">{{ t('label.cancel') }}</button>
      <button v-if="phase === 'ready'" class="btn btn--volt" type="button" @click="start">
        <span class="icon"><i class="fas fa-download"></i></span>{{ t('fw.start') }}
      </button>
      <button v-if="phase === 'error'" class="btn btn--volt" type="button" @click="start">{{ t('fw.retry') }}</button>
      <button v-if="phase === 'done' || phase === 'error' || phase === 'needPort'" class="btn" type="button" @click="close">
        {{ t('label.close') }}
      </button>
    </template>
  </BaseModal>
</template>
