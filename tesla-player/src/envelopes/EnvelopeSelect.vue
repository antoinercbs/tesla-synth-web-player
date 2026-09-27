<script setup lang="ts">
import { computed } from 'vue';
import { envelope, envelopeChoices } from '@/sysex/envelopes';

/**
 * The envelope picker every screen shares: the library's envelopes, then the
 * firmware's. A value outside both (a deleted library envelope, a program the
 * file sets above 63…) stays listed so it can be kept or reverted.
 */
const model = defineModel<number | null>({ required: true });
const props = defineProps<{
  /** Adds a "none" entry (value null) with this label. */
  noneLabel?: string;
  /** Programs that must stay selectable even if unknown (e.g. a file's original). */
  keep?: number[];
  disabled?: boolean;
  ariaLabel?: string;
}>();

const choices = computed(() => envelopeChoices());
const others = computed(() => {
  const known = new Set([...choices.value.custom, ...choices.value.builtin].map((e) => e.program));
  const extra = new Set<number>(props.keep ?? []);
  if (model.value != null) extra.add(model.value);
  return [...extra].filter((p) => !known.has(p)).sort((a, b) => a - b).map((p) => envelope(p));
});
</script>

<template>
  <div class="select-field">
    <select v-model="model" :disabled="disabled" :aria-label="ariaLabel">
      <option v-if="noneLabel" :value="null">{{ noneLabel }}</option>
      <optgroup v-if="others.length" :label="$t('envelopes.groupOther')">
        <option v-for="e in others" :key="e.program" :value="e.program">P{{ e.program }} · {{ e.name }}</option>
      </optgroup>
      <optgroup v-if="choices.custom.length" :label="$t('envelopes.mine')">
        <option v-for="e in choices.custom" :key="e.program" :value="e.program">P{{ e.program }} · {{ e.name }}</option>
      </optgroup>
      <optgroup :label="$t('envelopes.groupBuiltin')">
        <option v-for="e in choices.builtin" :key="e.program" :value="e.program">P{{ e.program }} · {{ e.name }}</option>
      </optgroup>
    </select>
  </div>
</template>
