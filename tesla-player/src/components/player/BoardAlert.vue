<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useMidiStore } from '@/stores/midi';
import { boardState } from '@/sysex/board';
import { useClearLatch } from '@/devices/use-clear-latch';
import { coilColor } from '@/ui/coil-colors';
import { ICONS } from '@/ui/icons';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';

/**
 * What the board says where the coils are played: its protection tripped
 * (and the way to re-arm it), it stopped answering, or its STOP switch cuts
 * the fibers. Nothing while all is well, nor for a board that does not tell.
 */
const midiStore = useMidiStore();
const { t } = useI18n();
const router = useRouter();
const { asking, busy, ask, cancel, confirm } = useClearLatch();

const state = computed(() => (midiStore.boardStatus ? boardState(midiStore.boardStatus) : null));
const tripped = computed(() =>
  (midiStore.boardStatus?.latchCoils ?? []).map((i) => ({
    index: i,
    color: coilColor(i),
    label: midiStore.coilName(i) || t('board.coilN', { n: i }),
    trips: midiStore.boardTrips[i] ? t('board.trips', { n: midiStore.boardTrips[i] }, midiStore.boardTrips[i]) : '',
  })),
);
</script>

<template>
  <div v-if="state === 'latched'" class="player-alert player-alert--board" role="alert">
    <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>
    <span class="player-alert__text">
      <strong class="player-alert__title">{{ $t('board.latchedTitle') }}</strong>
      <span v-if="tripped.length" class="player-alert__coils">
        <span v-for="c in tripped" :key="c.index" class="board-coil" :style="{ '--c': c.color }">
          <i class="board-coil__dot" aria-hidden="true"></i>{{ c.label }}<template v-if="c.trips"> · {{ c.trips }}</template>
        </span>
      </span>
      <span>{{ $t('board.latchedCause') }}</span>
      <span class="player-alert__acts">
        <button class="btn btn--danger" type="button" :disabled="busy" @click="ask">
          <span class="icon"><i class="fas fa-rotate-left"></i></span>{{ $t('board.clear') }}
        </button>
        <button v-if="midiStore.deviceLink" class="btn btn--ghost" type="button"
          @click="router.push({ name: 'syntherrupter' })">
          <span class="icon"><i class="fas fa-sliders"></i></span>{{ $t('board.seeLimits') }}
        </button>
      </span>
    </span>
  </div>
  <p v-else-if="midiStore.boardSilent" class="player-alert player-alert--warn" role="status">
    <span class="icon"><i class="fas fa-plug-circle-exclamation"></i></span>
    <span class="player-alert__text">{{ $t('board.silentAlert') }}</span>
  </p>
  <p v-else-if="state === 'stop'" class="player-alert player-alert--warn" role="status">
    <span class="icon"><i class="fas" :class="ICONS.fiber"></i></span>
    <span class="player-alert__text">{{ $t('board.stopAlert') }}</span>
  </p>
  <confirm-modal :open="asking" :title="$t('board.clearTitle')" :message="$t('board.clearMsg')"
    :confirm-label="$t('board.clearConfirm')" :cancel-label="$t('label.cancel')" @confirm="confirm" @close="cancel" />
</template>
