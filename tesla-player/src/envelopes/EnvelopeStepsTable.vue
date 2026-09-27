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

<style scoped>
.env-steps { display: flex; flex-direction: column; gap: 0.55rem; }
.env-steps__end { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem 0.8rem; font-size: var(--fs-sm); }
.env-steps__end-label { color: var(--text-mute); }
/* a compact switch: Bulma's .icon box (1.5rem) would set the height otherwise */
.env-steps__end :deep(.segmented) { padding: 2px; gap: 2px; }
.env-steps__end :deep(.segmented button) { padding: 0.2rem 0.65rem; font-size: var(--fs-sm); line-height: 1.4; }
.env-steps__end :deep(.segmented .icon) { width: 1rem; height: 1rem; margin-right: 0.15rem; }
.env-steps__from { display: inline-flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0; color: var(--text-dim); font-size: var(--fs-sm); }
.env-steps__from select { padding: 0.3rem 1.8rem 0.3rem 0.6rem; font-size: var(--fs-sm); }

/* separate borders: collapsed cells ignore border-radius, and the hover column is rounded */
.env-steps__table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: var(--fs-sm); }
.env-steps__label-col { width: 6.2rem; }
.env-steps__add-col { width: 8rem; }
.env-steps__table th, .env-steps__table td { padding: 3px 4px; }
.env-steps__head th { font-weight: 500; text-align: left; padding-bottom: 6px; white-space: nowrap; overflow: hidden; vertical-align: bottom; }
/* the number lines up with the values below, the × goes to the column's right edge */
.env-steps__col-head { display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
.env-steps__n { flex: none; padding-left: 7px; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-dim); }
.env-steps__row-label { text-align: left; font-weight: 500; color: var(--text-mute); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; cursor: help; }
.env-steps__row-label i { margin-left: 4px; opacity: 0.7; }
/* hovering a column (or its point on the graph) lights it as one rounded strip */
.env-steps__table .is-hover { background: var(--volt-08); }
.env-steps__table .is-hover .env-steps__n { color: var(--volt); }
.env-steps__head th.is-hover { border-radius: 8px 8px 0 0; }
.env-steps__table tbody tr:last-child td.is-hover { border-radius: 0 0 8px 8px; }
.env-steps__table .is-release { border-left: 1px dashed var(--line-strong); padding-left: 0.6rem; }
/* on the tag's line: a second line would leave the other headers floating over a gap */
.env-steps__sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-xs); color: var(--text-mute); }

.env-steps__cell { display: flex; align-items: center; gap: 3px; }
.env-steps__unit { width: 1rem; flex: none; color: var(--text-mute); font-size: var(--fs-xs); }
.env-steps input {
  width: 100%; min-width: 0; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
  color: var(--text); padding: 4px 6px; font-family: var(--font-mono); font-size: var(--fs-sm); outline: none;
}
/* no spinners: the cells are too narrow for them (arrow keys still step) */
.env-steps input { appearance: textfield; -moz-appearance: textfield; }
.env-steps input::-webkit-inner-spin-button, .env-steps input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.env-steps input:focus { border-color: var(--volt); box-shadow: 0 0 0 1px var(--volt); }
.env-steps input { transition: border-color 0.12s; }
.env-steps input:disabled { opacity: 0.6; }

.env-steps__role {
  display: inline-block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
  padding: 0 7px; border-radius: 999px; border: 1px solid var(--line-strong);
  color: var(--text-dim); font-size: var(--fs-xs); white-space: nowrap;
}
.env-steps__role.is-attack { color: var(--volt); border-color: var(--volt-30); }
.env-steps__role.is-sustain { color: var(--ok); border-color: rgb(61 220 151 / 0.35); }
.env-steps__role.is-loop { color: var(--coil-4); border-color: color-mix(in srgb, var(--coil-4) 45%, transparent); }
.env-steps__role.is-release { color: var(--danger); border-color: rgb(255 77 98 / 0.35); }
.env-steps__remove {
  flex: none; margin-left: auto; display: grid; place-items: center; width: 1.3rem; height: 1.3rem;
  border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
  padding: 0; border-radius: 4px; font-size: 0.8rem;
}
.env-steps__remove:hover { color: #ff8a96; background: rgb(255 84 104 / 0.1); }

/* the add button spans the whole height of the step rows */
.env-steps__add-cell { position: relative; }
.env-steps__add {
  position: absolute; inset: 3px 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem;
  border: 1px dashed var(--line-strong); border-radius: var(--radius); background: transparent;
  color: var(--text-dim); font: inherit; font-size: var(--fs-sm); cursor: pointer; text-align: center; padding: 0.4rem;
}
.env-steps__add:hover { border-color: var(--volt-30); color: var(--volt); background: var(--volt-08); }
.env-steps__add-hint { font-size: var(--fs-xs); color: var(--text-mute); line-height: 1.3; }

@media (max-width: 1400px) {
  .env-steps__role { padding: 0 5px; }
}
</style>
