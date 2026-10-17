<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChannelProfile, ChannelRole, RhythmCue } from '@/calib/roles';
import { ROLES } from '@/calib/roles';
import { coilColor } from '@/ui/coil-colors';
import { noteName } from '@/ui/piano-layout';
import { ICONS } from '@/ui/icons';
import DropMenu from '@/components/ui/DropMenu.vue';
import EnvelopeSelect from '@/envelopes/EnvelopeSelect.vue';

/**
 * Which channel goes where: a row per channel, a column per coil and one for
 * the speakers (the second output). Several pins on a row: the channel plays on
 * several coils (its notes striped on the score). Its role, and its envelope.
 */
const props = defineProps<{
  profiles: ChannelProfile[];
  masks: number[];
  output2Mask: number;
  /** The song plays on the speakers too (the head's switch): their column shows. */
  speakers: boolean;
  programs: Record<number, number>;
  /** The file's own envelope per channel, kept selectable. */
  filePrograms: Record<number, number>;
  coilNames: string[];
}>();
const emit = defineEmits<{
  (e: 'toggle', ch: number, coil: number | 'speakers'): void;
  (e: 'role', ch: number, role: ChannelRole): void;
  (e: 'program', ch: number, program: number): void;
}>();
const hoverCh = defineModel<number | null>('hoverCh', { default: null });
const { t } = useI18n();

const outs = computed(() => [
  ...props.masks.map((_, k) => ({
    key: k as number | 'speakers', label: props.coilNames[k] || `${k}`, title: `${t('label.coil')} ${k}${props.coilNames[k] ? ` · ${props.coilNames[k]}` : ''}`, color: coilColor(k),
  })),
  ...(props.speakers ? [{ key: 'speakers' as const, label: '', title: t('label.secondOutputChannels'), color: 'var(--plasma)' }] : []),
]);
const on = (ch: number, key: number | 'speakers'): boolean =>
  key === 'speakers' ? (props.output2Mask & (1 << ch)) !== 0 : (props.masks[key] & (1 << ch)) !== 0;

function cue(c: RhythmCue): string {
  if (c.kind === 'short') return t('atelier.why.short', { beats: c.beats.toFixed(2).replace('.', t('atelier.decimal')) });
  if (c.kind === 'struck') return t('atelier.why.struck', { pitches: c.pitches, times: c.times });
  return t('atelier.why.gmDrums');
}
const whyOf = (p: ChannelProfile): string => (p.why.length ? `${t('atelier.whyRhythm')} ${p.why.map(cue).join(', ')}` : t('atelier.roleHint'));
</script>

<template>
  <div class="route" :style="{ '--outs': outs.length }">
    <div class="route__grid">
      <span class="route__h"></span>
      <span class="route__h">{{ $t('label.channel') }}</span>
      <span class="route__h">{{ $t('atelier.envelope') }}</span>
      <span v-for="o in outs" :key="String(o.key)" class="route__h route__out" :title="o.title" :style="{ '--c': o.color }">
        <template v-if="o.key === 'speakers'"><i class="fas" :class="ICONS.speakers"></i></template>
        <template v-else><span class="route__dot"></span>{{ o.label }}</template>
      </span>

      <template v-for="p in profiles" :key="p.ch">
        <span class="route__cell" @mouseenter="hoverCh = p.ch" @mouseleave="hoverCh = null">
          <drop-menu trigger-class="tl__role" :class="`is-${p.role}`" :label="whyOf(p)" float>
            <template #trigger><span :title="whyOf(p)">{{ $t(`atelier.roles.${p.role}`) }}</span></template>
            <button v-for="role in ROLES" :key="role" class="dropdown__item" :class="{ 'is-active': role === p.role }"
              type="button" @click="emit('role', p.ch, role)">{{ $t(`atelier.roles.${role}`) }}</button>
          </drop-menu>
        </span>
        <span class="route__cell route__ch" :class="{ 'is-hover': hoverCh === p.ch }" @mouseenter="hoverCh = p.ch" @mouseleave="hoverCh = null">
          {{ $t('label.channel') }} {{ p.ch }} <small>{{ noteName(p.lo) }}–{{ noteName(p.hi) }}</small>
        </span>
        <span class="route__cell route__env">
          <envelope-select :model-value="programs[p.ch] ?? p.program" :keep="[filePrograms[p.ch] ?? p.program]"
            :aria-label="`${$t('atelier.envelope')} · ${$t('label.channel')} ${p.ch}`"
            @update:model-value="(v) => v != null && emit('program', p.ch, v)" />
        </span>
        <span v-for="o in outs" :key="String(o.key)" class="route__cell route__pin-cell">
          <button type="button" class="route__pin" :class="{ 'is-on': on(p.ch, o.key) }" :style="{ '--c': o.color }"
            :aria-pressed="on(p.ch, o.key)" :title="`${$t('label.channel')} ${p.ch} → ${o.title}`"
            @click="emit('toggle', p.ch, o.key)" @mouseenter="hoverCh = p.ch" @mouseleave="hoverCh = null"></button>
        </span>
      </template>
    </div>
  </div>
</template>
