<script setup lang="ts">
import { computed } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import { useCoilColor } from '@/ui/helpers/coil-colors';
import { MAX_COILS } from '@/model/domain';
import type { TeslaCoil } from '@/model/coils/inventory';

/**
 * The song's coils, ticked among the inventory's: a ticked coil has its place
 * in the song (in the colour of the fibre it is on), the others wait. One not wired on this machine can
 * still be ticked to edit the song; it won't play here.
 */
const props = defineProps<{
  /** The real coil at each place of the song. */
  places: (TeslaCoil | null)[];
}>();
const emit = defineEmits<{ (e: 'toggle', coil: TeslaCoil): void }>();
const midiStore = useMidiStore();
const coilColor = useCoilColor();

const chips = computed(() => midiStore.coilList.map((coil) => {
  const place = props.places.findIndex((c) => c?.uuid === coil.uuid);
  return {
    coil, place,
    color: place >= 0 ? coilColor(place) : undefined,
    wired: midiStore.outputOf(coil.uuid) >= 0,
    // the last one stays, and no more places than a board has outputs
    locked: (place >= 0 && props.places.length <= 1) || (place < 0 && props.places.length >= MAX_COILS),
  };
}));
</script>

<template>
  <span class="coil-picker" role="group" :aria-label="$t('atelier.coilsPicked')">
    <button v-for="c in chips" :key="c.coil.uuid" type="button" class="coil-pick" :class="{ 'is-on': c.place >= 0, 'is-off-stage': !c.wired }"
      :style="c.color ? { '--c': c.color } : undefined" :aria-pressed="c.place >= 0" :disabled="c.locked"
      :title="`${c.coil.name} · ${c.wired ? (c.place >= 0 ? $t('atelier.coilPlace', { n: c.place }) : $t('atelier.coilAdd')) : $t('atelier.coilOffStage')}`"
      @click="emit('toggle', c.coil)">
      <span class="coil-pick__dot" aria-hidden="true"></span>
      <span class="coil-pick__name">{{ c.coil.name }}</span>
      <i v-if="!c.wired" class="fas fa-plug-circle-xmark coil-pick__off" aria-hidden="true"></i>
    </button>
  </span>
</template>
