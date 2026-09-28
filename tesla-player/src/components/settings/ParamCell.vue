<script setup lang="ts">
import { computed } from 'vue';
import type { SynthParam } from '@/sysex/syntherrupter-params';

/**
 * The editor for one Syntherrupter parameter, label-free — just the control
 * (number-with-unit / toggle / text-or-password / read-only) with a dirty
 * highlight when it differs from the device. Numbers use the same in-field unit
 * suffix as the editor's coil cards (.readout__field). When `unread` (the device
 * gave no value), the control is disabled and an orange warning is shown instead
 * of a misleading default. Used in table cells and, wrapped by ParamRow, in the
 * vertical System card.
 */
const props = defineProps<{
  param: SynthParam;
  deviceValue?: number | string | boolean;
  unread?: boolean;
}>();
const model = defineModel<number | string | boolean>();

const dirty = computed(
  () => props.deviceValue !== undefined && String(model.value ?? '') !== String(props.deviceValue),
);
</script>

<template>
  <span class="param-cell" :class="{ 'is-dirty': dirty, 'is-unread': unread }">
    <span v-if="param.readOnly" class="param-cell__ro">{{ model ?? '—' }}</span>

    <label v-else-if="param.kind === 'bool'" class="switch param-cell__switch">
      <input type="checkbox" v-model="model" :disabled="unread">
      <span class="switch__track"></span>
    </label>

    <input v-else-if="param.kind === 'string'" class="text-field param-cell__field"
      :type="param.secret ? 'password' : 'text'" :maxlength="param.maxChars"
      :placeholder="param.secret ? '••••' : param.writeOnly ? $t('sp.writeOnly') : ''" v-model="model">

    <label v-else class="param-cell__box">
      <input type="number" :min="param.min" :max="param.max" :step="param.step ?? 1" v-model.number="model"
        :disabled="unread">
      <i v-if="param.unit">{{ param.unit }}</i>
    </label>

    <i v-if="unread" class="param-cell__warn fas fa-triangle-exclamation" :title="$t('sp.unreadHint')"></i>
  </span>
</template>
