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
      <input type="number" :min="param.min" :max="param.max" :step="param.step ?? 1"
        v-model.number="model" :disabled="unread">
      <i v-if="param.unit">{{ param.unit }}</i>
    </label>

    <i v-if="unread" class="param-cell__warn fas fa-triangle-exclamation" :title="$t('sp.unreadHint')"></i>
  </span>
</template>

<style scoped>
.param-cell { display: inline-flex; align-items: center; gap: 0.35rem; width: 100%; }
.param-cell__field { width: 100%; }

/* number + in-field unit suffix — mirrors the editor's .readout__field */
.param-cell__box {
  display: flex; align-items: center; width: 100%;
  background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm, 8px);
  padding: 0 0.55rem; transition: 0.15s;
}
.param-cell__box input {
  width: 100%; min-width: 0; background: transparent; border: 0; outline: none;
  color: var(--text); font-family: var(--font-mono); font-size: 0.88rem; padding: 0.35rem 0;
}
.param-cell__box i {
  font-style: normal; flex: 0 0 auto; padding-left: 0.35rem;
  color: var(--text-mute); font-family: var(--font-mono); font-size: 0.72rem;
}
.param-cell__box:focus-within { border-color: var(--volt); box-shadow: 0 0 0 1px var(--volt-30); }
.param-cell.is-dirty .param-cell__box,
.param-cell.is-dirty .param-cell__field { border-color: var(--volt); box-shadow: 0 0 0 1px var(--volt-30); }
.param-cell.is-dirty .switch__track { box-shadow: 0 0 0 2px var(--volt-30); }
.param-cell__ro { font-family: var(--font-mono); font-size: 0.85rem; color: var(--volt); }

/* unread — device returned no value: disabled control + orange warning */
.param-cell__warn { color: var(--warn, #f5a623); font-size: 0.8rem; flex: 0 0 auto; }
.param-cell.is-unread .param-cell__box,
.param-cell.is-unread .param-cell__field { border-color: var(--warn, #f5a623); opacity: 0.5; }
.param-cell.is-unread .switch { opacity: 0.5; }
.param-cell.is-unread input { cursor: not-allowed; }
</style>
