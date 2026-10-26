<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { coilColor } from '@/ui/helpers/coil-colors';
import { ICONS } from '@/ui/helpers/icons';
import VFader, { type FaderMark } from '@/ui/components/ui/VFader.vue';

/**
 * The general Power, the master strip at the end of the outputs': it
 * multiplies each coil's own (its strip), ontime and duty together. Its marks
 * are the coils' notches, tagged with their outputs: past a coil's, its bass is
 * at its max ontime. The ≤ 100 % lock holds every fader under 100; the reset
 * puts them all back to 100.
 *
 * The parent (MidiPlayer) owns the values and what is sent: the model streams
 * the drag, `power-change` fires on release.
 */
const masterPower = defineModel<number>('masterPower', { required: true });
const props = defineProps<{
  /** Each coil's notch on this fader (%), with its output and its name. */
  marks: { output: number; at: number; name: string; maxUs: number | null }[];
  dirty: boolean;
  hasSong: boolean;
  capped: boolean;
  max: number;
  /** Débutant (ui/helpers/ui-mode.ts): held under 100 % for good, no marks, no lock. */
  simple?: boolean;
}>();
const emit = defineEmits<{
  (e: 'power-change'): void;
  (e: 'reset'): void;
  (e: 'toggle-cap'): void;
}>();
const { t } = useI18n();

// coils close together share one mark, their caps side by side
const notches = computed<FaderMark[]>(() => {
  const out: FaderMark[] = [];
  let lastAt = -99;
  for (const m of [...props.marks].sort((a, b) => a.at - b.at)) {
    const title = t('ontime.rack.notchTitle', { name: m.name, pct: m.at, max: m.maxUs ?? '–' });
    const prev = out[out.length - 1];
    const tag = { label: String(m.output), color: coilColor(m.output) };
    if (prev && m.at - lastAt < 7) {
      prev.tags.push(tag);
      prev.title += `\n${title}`;
      continue;
    }
    lastAt = m.at;
    out.push({ at: m.at, color: coilColor(m.output), title, tags: [tag], ahead: masterPower.value <= m.at });
  }
  return out;
});
</script>

<template>
  <div class="strip strip--master player-power" :class="{ 'is-capped': capped }">
    <span class="strip__head" :title="$t('label.powerHint')">
      <i class="fas strip__master-icon" :class="ICONS.power"></i>
      <span class="strip__name"><span class="strip__name-text">{{ $t('label.power') }}</span></span>
    </span>
    <span class="strip__val power-head__val" :class="{ 'is-boost': masterPower > 100 }">{{ masterPower }} %</span>
    <div class="strip__body">
      <v-fader v-model="masterPower" :class="{ 'vfader--plain': simple }" :scale="simple ? 100 : 200" :max="max" :marks="simple ? [] : notches" :label="$t('label.power')" :disabled="!hasSong"
        @change="emit('power-change')" />
    </div>
    <span class="strip__foot">
      <button v-if="!simple" class="power-head__cap" :class="{ 'is-on': capped }" type="button" :aria-pressed="capped"
        :title="capped ? $t('player.uncapPower') : $t('player.capPower')" @click="emit('toggle-cap')">
        <i class="fas" :class="capped ? 'fa-lock' : 'fa-lock-open'"></i>
      </button>
      <button class="power-head__reset" type="button" :disabled="!hasSong || !dirty" :title="$t('label.resetPower')"
        @click="emit('reset')"><i class="fas fa-rotate-left"></i></button>
    </span>
  </div>
</template>
