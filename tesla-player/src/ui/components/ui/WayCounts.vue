<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/app/stores/midi';
import { PhyStage } from '@/model/coils/stage';
import type { Song } from '@/model/domain';

/**
 * A song in a list: how many coils each of its variants plays on (1 · 2 · 3),
 * in bold the one the coils wired now play; their coils in the tooltip.
 */
const props = defineProps<{ song: Song }>();
const midiStore = useMidiStore();
const { t } = useI18n();

const ways = computed(() => {
  const s = props.song;
  const inv = midiStore.coilList;
  const all = [
    { v: null, coils: s.coils.slice(0, s.coilCount), name: '' },
    ...(s.variants ?? []).map((v) => ({ v, coils: v.coils.slice(0, v.coilCount), name: v.name })),
  ];
  const chosen = inv.length ? new PhyStage(inv).chooseWay(s, midiStore.outputOf) : null;
  return all.map((w) => ({
    n: w.coils.length,
    name: inv.length ? new PhyStage(inv).wayName(w.coils, w.name) : '',
    plays: !!chosen?.fits && chosen.variant === w.v,
  }));
});
// a count once, in bold when the variant played here has it
const counts = computed(() => [...new Set(ways.value.map((w) => w.n))].sort((a, b) => a - b)
  .map((n) => ({ n, plays: ways.value.some((w) => w.n === n && w.plays) })));
const title = computed(() => ways.value
  .map((w) => `${t('atelier.ways.count', w.n)}${w.name ? ` · ${w.name}` : ''}${w.plays ? ` (${t('stage.playsHere')})` : ''}`)
  .join('\n'));
</script>

<template>
  <span class="way-counts" :title="title">
    <template v-for="(c, i) in counts" :key="c.n">
      <span v-if="i" class="way-counts__sep" aria-hidden="true">·</span>
      <span class="way-counts__n" :class="{ 'is-playing': c.plays }">{{ c.n }}</span>
    </template>
    <slot />
  </span>
</template>
