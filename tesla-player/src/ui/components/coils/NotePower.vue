<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { NoteBar } from './use-play-point';

/**
 * Each note's power into the arcs at the play point's ontime, about how loud
 * it plays: a bar each, the chosen note's lit, a click picks another. A note
 * the max duty holds under the board's max ontime says where.
 */
const props = defineProps<{ bars: NoteBar[] }>();
const note = defineModel<number>('note', { required: true });
const { t, locale } = useI18n();
const fr = (v: number, d = 0) => v.toLocaleString(locale.value, { minimumFractionDigits: d, maximumFractionDigits: d });
const watts = (w: number) => (w < 1000 ? `${fr(w, w < 10 ? 1 : 0)} W` : `${fr(w / 1e3, 1)} kW`);
const top = computed(() => Math.max(1, ...props.bars.map((b) => b.watts)));
const anyCap = computed(() => props.bars.some((b) => b.cap != null));
const hint = (b: NoteBar) => (b.cap != null ? t('coils.power.capHint', { us: Math.round(b.cap) }) : t('coils.power.pick'));
</script>

<template>
  <div class="npower" role="radiogroup" :aria-label="$t('coils.power.title')">
    <button v-for="b in bars" :key="b.f" type="button" role="radio" class="npower__col" :class="{ 'is-on': b.f === note }"
      :aria-checked="b.f === note" :title="hint(b)" @click="note = b.f">
      <span class="npower__plot">
        <span class="npower__v">{{ watts(b.watts) }}</span>
        <span class="npower__bar" :class="{ 'is-capped': b.capped }" :style="{ height: `${(b.watts / top) * 100}%` }"></span>
      </span>
      <span class="npower__f">{{ b.f }} Hz</span>
      <small v-if="anyCap" class="npower__cap">{{ b.cap != null ? $t('coils.power.cap', { us: Math.round(b.cap) }) : '' }}</small>
    </button>
  </div>
</template>
