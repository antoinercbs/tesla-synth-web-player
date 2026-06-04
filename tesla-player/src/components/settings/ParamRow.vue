<script setup lang="ts">
import type { SynthParam } from '@/sysex/syntherrupter-params';
import ParamCell from '@/components/settings/ParamCell.vue';

/**
 * A labelled parameter row (label + safety/EEPROM flags + unit) wrapping a
 * {@link ParamCell}. Used in the vertical System card; the coil/user tables use
 * ParamCell directly with the column header as the label.
 */
const props = defineProps<{ param: SynthParam; deviceValue?: number | string | boolean; unread?: boolean }>();
const model = defineModel<number | string | boolean>();
const emit = defineEmits<{ (e: 'info', param: SynthParam): void }>();
</script>

<template>
  <label class="param-row" :class="{ 'is-ro': param.readOnly }">
    <span class="param-row__label">
      {{ $t('sp.' + param.key) }}
      <span v-if="param.safety" class="param-row__flag is-safety" :title="$t('sp.safetyHint')">
        <i class="fas fa-triangle-exclamation"></i>
      </span>
      <span v-if="!param.eeprom && !param.readOnly" class="param-row__flag" :title="$t('sp.volatileHint')">
        <i class="fas fa-clock-rotate-left"></i>
      </span>
      <button type="button" class="param-row__info" :title="$t('label.info')"
        @click.stop.prevent="emit('info', props.param)"><i class="fas fa-circle-info"></i></button>
    </span>
    <span class="param-row__control">
      <param-cell :param="param" :device-value="deviceValue" :unread="unread" v-model="model" />
    </span>
  </label>
</template>

<style scoped>
.param-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.6rem;
  padding: 0.4rem 0.55rem; border: 1px solid var(--line); border-radius: var(--radius-sm, 9px);
  background: var(--line-005);
}
.param-row.is-ro { opacity: 0.85; }
.param-row__label {
  display: inline-flex; align-items: center; gap: 0.4rem; min-width: 0;
  font-size: 0.82rem; color: var(--text);
}
.param-row__flag { color: var(--text-mute); font-size: 0.72rem; }
.param-row__flag.is-safety { color: var(--danger); }
.param-row__info {
  border: 0; background: transparent; cursor: pointer; color: var(--text-mute);
  padding: 0; margin-left: 0.15rem; font-size: 0.78rem; line-height: 1; flex: 0 0 auto;
}
.param-row__info:hover { color: var(--volt); }
.param-row__control { display: inline-flex; align-items: center; gap: 0.4rem; flex: 0 0 auto; }
.param-row__control .param-cell { width: 7rem; } /* numeric + unit suffix in the card */
</style>
