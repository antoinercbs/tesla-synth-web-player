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
