<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RELEASE_STEP, type EnvStep } from '@/sysex/envelopes';
import {
  MAX_PHASES,
  appendPhase,
  removePhase,
  stepRole,
  toShape,
  toSteps,
  walkChain,
  withEnd,
  type EnvShape,
  type HeldEndKind,
} from '@/envelopes/chain';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

/**
 * The steps in playing order (one column each), what a held note does after
 * the last one, and the release. Edits go through the shape model and come
 * back as a firmware table, so the "next step" wiring is never shown.
 */
const steps = defineModel<EnvStep[]>('steps', { required: true });
const hoverStep = defineModel<number | null>('hoverStep', { default: null });
const props = defineProps<{ readonly: boolean }>();
const { t } = useI18n();

type NumField = 'amp' | 'durMs' | 'ntau';
const FIELDS: NumField[] = ['amp', 'durMs', 'ntau'];
const LIMITS: Record<NumField, { min: number; max: number; step: number }> = {
  amp: { min: 0, max: 10, step: 0.05 },
  durMs: { min: 0, max: 2_000_000, step: 1 },
  ntau: { min: -1000, max: 1000, step: 0.5 },
};
const UNIT: Record<NumField, string> = { amp: '×', durMs: 'ms', ntau: '' };

const shape = computed(() => toShape(steps.value));
const chain = computed(() => walkChain(steps.value));
const commit = (next: EnvShape): void => { steps.value = toSteps(next); };

// the graph speaks in firmware steps; a column is the step the chain plays there
const stepOf = (i: number): number => chain.value.points[i]?.step ?? i;
const columns = computed(() =>
  shape.value.phases.map((phase, i) => ({ i, phase, role: stepRole(stepOf(i), chain.value) })),
);
const canAdd = computed(() => !props.readonly && shape.value.phases.length < MAX_PHASES);

const endKind = computed<HeldEndKind>({
  get: () => shape.value.end.kind,
  set: (kind) => commit(withEnd(shape.value, kind)),
});
const endOptions = computed(() =>
  (['hold', 'loop', 'release'] as const).map((kind) => ({
    value: kind,
    label: t(`envelopes.end.${kind}`),
    icon: { hold: 'fa-minus', loop: 'fa-rotate', release: 'fa-arrow-right-to-bracket' }[kind],
    title: t(`envelopes.end.${kind}Hint`),
    disabled: props.readonly || (kind === 'loop' && shape.value.phases.length < 2),
  })),
);
const loopFrom = computed<number>({
  get: () => (shape.value.end.kind === 'loop' ? shape.value.end.from : 0),
  set: (from) => commit({ ...shape.value, end: { kind: 'loop', from } }),
});

const show = (v: number): number => +v.toFixed(3);

// the input keeps what was typed unless rewritten: a rejected or clamped entry must not linger
function parse(field: NumField, input: HTMLInputElement, current: number): number | null {
  const v = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(v)) {
    input.value = String(show(current));
    return null;
  }
  const { min, max } = LIMITS[field];
  const clamped = Math.min(max, Math.max(min, v));
  if (clamped !== v) input.value = String(show(clamped));
  return clamped;
}
function setPhase(i: number, field: NumField, input: HTMLInputElement): void {
  const v = parse(field, input, shape.value.phases[i][field]);
  if (v == null) return;
  const phases = shape.value.phases.map((p, k) => (k === i ? { ...p, [field]: v } : p));
  commit({ ...shape.value, phases });
}
function setRelease(field: 'durMs' | 'ntau', input: HTMLInputElement): void {
  const v = parse(field, input, shape.value.release[field]);
  if (v == null) return;
  commit({ ...shape.value, release: { ...shape.value.release, [field]: v } });
}
function remove(i: number): void {
  hoverStep.value = null;
  commit(removePhase(shape.value, i));
}
function add(): void {
  commit(appendPhase(shape.value));
}
</script>

<template>
  <div class="env-steps">
    <div class="env-steps__end">
      <span class="env-steps__end-label">{{ t('envelopes.heldEnd') }}</span>
      <segmented-control v-model="endKind" :options="endOptions" :aria-label="t('envelopes.heldEnd')" />
      <label v-if="shape.end.kind === 'loop'" class="env-steps__from">
        {{ t('envelopes.loopFrom') }}
        <span class="select-field">
          <select v-model.number="loopFrom" :disabled="readonly">
            <option v-for="n in shape.phases.length - 1" :key="n" :value="n - 1">{{ n }}</option>
          </select>
        </span>
      </label>
    </div>

    <table class="env-steps__table">
      <colgroup>
        <col class="env-steps__label-col">
        <col v-for="c in columns" :key="c.i">
        <col v-if="canAdd" class="env-steps__add-col">
        <col>
      </colgroup>
      <tbody>
        <tr class="env-steps__head">
          <th></th>
          <th v-for="c in columns" :key="c.i" :class="{ 'is-hover': hoverStep === stepOf(c.i) }"
            @mouseenter="hoverStep = stepOf(c.i)" @mouseleave="hoverStep = null">
            <div class="env-steps__col-head">
              <span class="env-steps__n">{{ c.i + 1 }}</span>
              <span class="env-steps__role" :class="'is-' + c.role">{{ t('envelopes.role.' + c.role) }}</span>
              <button v-if="!readonly && columns.length > 1" type="button" class="env-steps__remove"
                :title="t('envelopes.removeStep', { n: c.i + 1 })"
                :aria-label="t('envelopes.removeStep', { n: c.i + 1 })" @click="remove(c.i)"><i
                  class="fas fa-xmark"></i></button>
            </div>
          </th>
          <td v-if="canAdd" rowspan="4" class="env-steps__add-cell">
            <button type="button" class="env-steps__add" @click="add">
              <i class="fas fa-plus"></i>
              <span>{{ t('envelopes.addStep') }}</span>
              <span class="env-steps__add-hint">{{ t('envelopes.addStepHint') }}</span>
            </button>
          </td>
          <th class="is-release" :class="{ 'is-hover': hoverStep === RELEASE_STEP }"
            @mouseenter="hoverStep = RELEASE_STEP" @mouseleave="hoverStep = null">
            <div class="env-steps__col-head">
              <span class="env-steps__role is-release">{{ t('envelopes.role.release') }}</span>
              <span class="env-steps__sub">{{ t('envelopes.atNoteOff') }}</span>
            </div>
          </th>
        </tr>
        <tr v-for="field in FIELDS" :key="field">
          <th class="env-steps__row-label" :title="t('envelopes.row.' + field + 'Hint')">{{ t('envelopes.row.' + field)
            }}<i class="fas fa-circle-question"></i></th>
          <td v-for="c in columns" :key="c.i" :class="{ 'is-hover': hoverStep === stepOf(c.i) }"
            @mouseenter="hoverStep = stepOf(c.i)" @mouseleave="hoverStep = null">
            <div class="env-steps__cell">
              <input type="number" :value="show(c.phase[field])" :min="LIMITS[field].min" :max="LIMITS[field].max"
                :step="LIMITS[field].step" :disabled="readonly" :aria-label="`${t('envelopes.row.' + field)} ${c.i + 1}`"
                @change="setPhase(c.i, field, $event.target as HTMLInputElement)">
              <span class="env-steps__unit">{{ UNIT[field] }}</span>
            </div>
          </td>
          <td class="is-release" :class="{ 'is-hover': hoverStep === RELEASE_STEP }"
            @mouseenter="hoverStep = RELEASE_STEP" @mouseleave="hoverStep = null">
            <div class="env-steps__cell">
              <input v-if="field === 'amp'" type="number" value="0" disabled
                :aria-label="`${t('envelopes.row.amp')} ${t('envelopes.role.release')}`">
              <input v-else type="number" :value="show(shape.release[field])" :min="LIMITS[field].min"
                :max="LIMITS[field].max" :step="LIMITS[field].step" :disabled="readonly"
                :aria-label="`${t('envelopes.row.' + field)} ${t('envelopes.role.release')}`"
                @change="setRelease(field, $event.target as HTMLInputElement)">
              <span class="env-steps__unit">{{ UNIT[field] }}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
