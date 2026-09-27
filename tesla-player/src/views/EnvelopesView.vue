<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios, { AxiosError } from 'axios';
import { useMidiStore } from '@/stores/midi';
import { notify } from '@/utils/toast';
import {
  CUSTOM_PROGRAM_MAX,
  CUSTOM_PROGRAM_MIN,
  ENVELOPES,
  envelope,
  programSteps,
  type EnvStep,
} from '@/sysex/envelopes';
import { cloneSteps, firstFreeProgram, normalizeSteps, sameSteps, starterSteps } from '@/envelopes/chain';
import { auditionOnCoil, auditionOnSynth } from '@/envelopes/audition';
import type { ToneRunner } from '@/tuning/tone-runner';
import { noteHzLabel, noteName } from '@/ui/piano-layout';
import { MAX_COILS } from '@/types/domain';
import type { CustomEnvelope } from '@/types/domain';
import EnvelopeGraph from '@/envelopes/EnvelopeGraph.vue';
import EnvelopeStepsTable from '@/envelopes/EnvelopeStepsTable.vue';
import EnvelopeThumb from '@/envelopes/EnvelopeThumb.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';

/**
 * The envelope library: the user's envelopes (programs 20-63), editable, and
 * the firmware's (0-19), read-only but duplicable. `:program` in the route
 * picks what is shown.
 */
const midiStore = useMidiStore();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/* ----------------------------- current envelope ---------------------------- */
interface Draft {
  id: number | null;
  program: number;
  name: string;
  steps: EnvStep[];
}
// steps are kept normalized (see normalizeSteps): the editor's columns are the firmware steps in order
const draft = reactive<Draft>({ id: null, program: 1, name: '', steps: normalizeSteps(programSteps(1)) });
// the saved version, to tell what changed; null for a new one (never saved)
const baseline = shallowRef<Draft | null>(null);
const builtin = ref(true);

const dirty = computed(() => {
  if (builtin.value) return false;
  const b = baseline.value;
  return !b || b.name !== draft.name || b.program !== draft.program || !sameSteps(b.steps, draft.steps);
});
const isNew = computed(() => !builtin.value && draft.id == null);

function show(d: Draft, isBuiltin: boolean, saved: Draft | null): void {
  Object.assign(draft, { ...d, steps: cloneSteps(d.steps) });
  builtin.value = isBuiltin;
  baseline.value = saved ? { ...saved, steps: cloneSteps(saved.steps) } : null;
  hoverStep.value = null;
}
function openProgram(program: number): void {
  const saved = midiStore.envelopeList.find((e) => e.program === program);
  if (saved) {
    const d = { id: saved.id, program, name: saved.name, steps: normalizeSteps(saved.steps) };
    show(d, false, d);
  } else if (program >= 0 && program < CUSTOM_PROGRAM_MIN) {
    show({ id: null, program, name: envelope(program).name, steps: normalizeSteps(programSteps(program)) }, true, null);
  } else {
    openDefault();
  }
}
function openDefault(): void {
  const first = midiStore.envelopeList[0];
  openProgram(first ? first.program : 1);
}
function startNew(name: string, steps: EnvStep[]): boolean {
  const program = firstFreeProgram(midiStore.envelopeList.map((e) => e.program));
  if (program == null) {
    notify('envelopes.noFreeSlot', 'error');
    return false;
  }
  show({ id: null, program, name, steps }, false, null);
  return true;
}

const routeProgram = (): number | null => {
  const raw = route.params.program;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return raw != null && raw !== '' && Number.isInteger(n) ? n : null;
};
function openFromRoute(): void {
  const p = routeProgram();
  if (p == null) openDefault();
  else openProgram(p);
}
onMounted(openFromRoute);
watch(() => route.params.program, () => { if (route.name === 'envelopes') openFromRoute(); });
// The list changed under a clean page: it arrived after a cold load here, or a
// sync rewrote it. Leave alone what is shown if it is still what is saved (e.g.
// right after our own save, before the route follows the new program).
watch(() => midiStore.envelopeList, (list) => {
  if (dirty.value) return;
  const shown = draft.id != null ? list.find((e) => e.id === draft.id) : undefined;
  const b = baseline.value;
  if (shown && b && shown.program === b.program && shown.name === b.name && sameSteps(normalizeSteps(shown.steps), b.steps)) return;
  openFromRoute();
});

async function select(program: number): Promise<void> {
  if (program !== routeProgram()) {
    router.push({ name: 'envelopes', params: { program } });
    return;
  }
  // same route (e.g. back from a new draft): no navigation, so no guard either
  if (await confirmDiscard()) openProgram(program);
}

/* ------------------------------ unsaved changes ---------------------------- */
const pendingLeave = ref<((ok: boolean) => void) | null>(null);
function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return Promise.resolve(true);
  return new Promise((resolve) => { pendingLeave.value = resolve; });
}
function answerDiscard(ok: boolean): void {
  pendingLeave.value?.(ok);
  pendingLeave.value = null;
}
onBeforeRouteUpdate(() => confirmDiscard());
onBeforeRouteLeave(() => confirmDiscard());

async function newEnvelope(): Promise<void> {
  if (await confirmDiscard()) startNew(t('envelopes.newName'), starterSteps());
}
function duplicate(): void {
  // the copy takes what is on screen, unsaved edits included: a "save as"
  const name = builtin.value ? draft.name : t('envelopes.copyName', { name: draft.name });
  if (startNew(name, cloneSteps(draft.steps))) notify(t('envelopes.duplicated', { p: draft.program }), 'info');
}

/* ------------------------------ library lists ------------------------------ */
interface Use { name: string; channels: number[] }
function usesOf(program: number): Use[] {
  return midiStore.midiFileList
    .map((f) => ({
      name: f.name,
      channels: Object.entries(f.programs ?? {})
        .filter(([, p]) => p === program)
        .map(([ch]) => Number(ch))
        .sort((a, b) => a - b),
    }))
    .filter((u) => u.channels.length > 0);
}
const customRows = computed(() =>
  midiStore.envelopeList.map((e) => ({ ...e, uses: usesOf(e.program).length })),
);
// who plays the SAVED slot: moving an envelope elsewhere does not move its files
const uses = computed(() => (builtin.value ? [] : usesOf(baseline.value?.program ?? draft.program)));
const USES_SHOWN = 3;

const takenPrograms = computed(() => new Set(midiStore.envelopeList.filter((e) => e.id !== draft.id).map((e) => e.program)));
const programOptions = computed(() =>
  Array.from({ length: CUSTOM_PROGRAM_MAX - CUSTOM_PROGRAM_MIN + 1 }, (_, i) => CUSTOM_PROGRAM_MIN + i),
);
// 20-39 live in the device's EEPROM; 40-63 are wiped at boot (the app resends either way)
const slotKind = computed(() => (builtin.value ? 'firmware' : draft.program <= 39 ? 'eeprom' : 'volatile'));

/* ---------------------------------- saving --------------------------------- */
const saving = ref(false);
const confirmMove = ref(false);
async function save(): Promise<void> {
  if (builtin.value || saving.value || !dirty.value) return;
  const from = baseline.value?.program;
  if (from != null && from !== draft.program && usesOf(from).length && !confirmMove.value) {
    confirmMove.value = true;
    return;
  }
  confirmMove.value = false;
  saving.value = true;
  const payload = { program: draft.program, name: draft.name.trim() || t('envelopes.newName'), steps: draft.steps };
  try {
    const { data } = draft.id == null
      ? await axios.post<CustomEnvelope>('/api/envelopes', payload)
      : await axios.put<CustomEnvelope>(`/api/envelopes/${draft.id}`, payload);
    midiStore.upsertEnvelope(data);
    const d = { id: data.id, program: data.program, name: data.name, steps: normalizeSteps(data.steps) };
    show(d, false, d);
    notify('envelopes.saved');
    if (routeProgram() !== data.program) router.replace({ name: 'envelopes', params: { program: data.program } });
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    notify(status === 409 ? t('envelopes.programTaken', { p: draft.program }) : 'label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}

const confirmDelete = ref(false);
async function doDelete(): Promise<void> {
  confirmDelete.value = false;
  if (draft.id == null) {
    openDefault(); // an unsaved one: nothing on the server
    return;
  }
  try {
    await axios.delete(`/api/envelopes/${draft.id}`);
    midiStore.deleteEnvelope(draft.id);
    baseline.value = null;
    builtin.value = true; // nothing left to protect before navigating
    notify('envelopes.deleted');
    router.replace({ name: 'envelopes', params: { program: midiStore.envelopeList[0]?.program ?? 1 } });
  } catch {
    notify('envelopes.deleteFailed', 'error');
  }
}

function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));

/* ------------------------------ graph controls ----------------------------- */
const MAX_NOTE_MS = 6000;
const hoverStep = ref<number | null>(null);
const zoom = ref<'note' | 'attack'>('note');
const zoomOptions = computed(() => [
  { value: 'note' as const, label: t('envelopes.zoomNote') },
  { value: 'attack' as const, label: t('envelopes.zoomAttack') },
]);
function stored(key: string, fallback: number, lo: number, hi: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= lo && v <= hi && localStorage.getItem(key) !== null ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: number): void {
  try { localStorage.setItem(key, String(v)); } catch { /* private mode: not remembered */ }
}
const noteMs = ref(stored('envelopeNoteMs', 900, 50, MAX_NOTE_MS));
watch(noteMs, (v) => remember('envelopeNoteMs', v));
const fmtMs = (v: number): string => (v >= 1000 ? `${+(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);

/* -------------------------------- audition --------------------------------- */
const AUDITION_NOTES = [48, 55, 60, 67, 72];
const auditionNote = ref(60);
const synthRunner = shallowRef<ToneRunner | null>(null);
const coilRunner = shallowRef<ToneRunner | null>(null);
const audition = () => ({
  program: draft.program,
  steps: builtin.value ? null : draft.steps,
  note: auditionNote.value,
  noteMs: noteMs.value,
});
function stopAll(): void {
  synthRunner.value?.stop();
  coilRunner.value?.stop();
}
function toggleSynth(): void {
  if (synthRunner.value) { synthRunner.value.stop(); return; }
  stopAll();
  synthRunner.value = auditionOnSynth(audition(), () => { synthRunner.value = null; });
}

const coilMenu = ref(false);
const testCoil = ref(Math.min(MAX_COILS - 1, stored('envelopeTestCoil', 0, 0, MAX_COILS - 1)));
const testOntime = ref(stored('envelopeTestOntime', 30, 0, 1000));
watch(testCoil, (v) => remember('envelopeTestCoil', v));
watch(testOntime, (v) => { if (Number.isFinite(v)) remember('envelopeTestOntime', v); });
const coilOutput = computed(() => (midiStore.midiOutput && !midiStore.isSynthOutput ? midiStore.midiOutput : null));
const coilOptions = computed(() =>
  Array.from({ length: Math.max(midiStore.appConfig.defaultCoilCount, testCoil.value + 1) }, (_, i) => i),
);
function toggleCoil(): void {
  if (coilRunner.value) { coilRunner.value.stop(); return; }
  const out = coilOutput.value;
  if (!out || !(testOntime.value > 0)) return;
  stopAll();
  coilRunner.value = auditionOnCoil(out, (f) => midiStore.sendSysex(f), audition(), testCoil.value,
    Math.round(testOntime.value), () => { coilRunner.value = null; });
}
const coilMenuEl = ref<HTMLElement | null>(null);
function onDocPointer(e: PointerEvent): void {
  if (coilMenu.value && coilMenuEl.value && !coilMenuEl.value.contains(e.target as Node)) coilMenu.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onDocPointer));

onBeforeUnmount(() => {
  stopAll();
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', onDocPointer);
});
</script>

<template>
  <div class="screen env-screen">
    <header class="screen-head env-head">
      <div class="env-head__title">
        <h1 class="view-head__title">{{ $t('envelopes.title') }}<page-tour-button v-if="!dirty" id="envelopes" /></h1>
        <span class="env-head__sub">{{ $t('envelopes.subtitle') }}</span>
      </div>
      <div class="env-head__actions">
        <span v-if="dirty" class="env-dirty"><i class="fas fa-circle"></i>{{ $t('envelopes.unsaved') }}</span>
        <template v-if="builtin">
          <button class="btn btn--volt" type="button" @click="duplicate">
            <span class="icon"><i class="fas fa-copy"></i></span>{{ $t('envelopes.duplicateToEdit') }}
          </button>
        </template>
        <template v-else>
          <button class="btn btn--danger-ghost" type="button" @click="confirmDelete = true">
            <span class="icon"><i class="fas fa-trash"></i></span>{{ $t('label.delete') }}
          </button>
          <button class="btn btn--ghost" type="button" @click="duplicate">
            <span class="icon"><i class="fas fa-copy"></i></span>{{ $t('envelopes.duplicate') }}
          </button>
          <button class="btn btn--volt" type="button" :disabled="!dirty || saving" :title="$t('envelopes.saveShortcut')"
            @click="save">
            <span class="icon"><i class="fas fa-floppy-disk"></i></span>{{ $t('label.save') }}
          </button>
        </template>
      </div>
    </header>

    <div class="env-body">
      <!-- library -->
      <section class="env-card env-lib">
        <div class="env-lib__scroll">
          <div class="env-lib__group"><span>{{ $t('envelopes.mine') }}</span><span>{{ midiStore.envelopeList.length }} / {{
            CUSTOM_PROGRAM_MAX - CUSTOM_PROGRAM_MIN + 1 }}</span></div>
          <button v-if="isNew" type="button" class="env-row is-active">
            <span class="env-pchip">P{{ draft.program }}</span>
            <span class="env-row__text"><span class="env-row__name">{{ draft.name || $t('envelopes.newName') }}</span><span
                class="env-row__meta is-new">{{ $t('envelopes.unsaved') }}</span></span>
            <envelope-thumb :steps="draft.steps" />
          </button>
          <button v-for="e in customRows" :key="e.id" type="button" class="env-row"
            :class="{ 'is-active': !builtin && draft.id === e.id }" @click="select(e.program)">
            <span class="env-pchip">P{{ e.program }}</span>
            <span class="env-row__text"><span class="env-row__name">{{ e.name }}</span><span class="env-row__meta">{{ e.uses
              ? $t('envelopes.usedFiles', e.uses) : $t('envelopes.unused') }}</span></span>
            <envelope-thumb :steps="!builtin && draft.id === e.id ? draft.steps : e.steps" />
          </button>
          <p v-if="!customRows.length && !isNew" class="env-lib__empty">{{ $t('envelopes.empty') }}</p>

          <div class="env-lib__group"><span>{{ $t('envelopes.builtin') }}</span><span>P0–P19</span></div>
          <button v-for="e in ENVELOPES" :key="e.program" type="button" class="env-row"
            :class="{ 'is-active': builtin && draft.program === e.program }" @click="select(e.program)">
            <span class="env-pchip is-builtin">P{{ e.program }}</span>
            <span class="env-row__text"><span class="env-row__name">{{ e.name }}</span></span>
            <envelope-thumb :steps="programSteps(e.program)" />
          </button>
        </div>
        <div class="env-lib__foot">
          <button class="btn env-lib__new" type="button" @click="newEnvelope">
            <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('envelopes.new') }}
          </button>
        </div>
      </section>

      <section class="env-editor">
        <!-- identity: name, slot, who plays it -->
        <div class="env-card env-ident">
          <input v-model="draft.name" class="text-field env-ident__name" type="text" maxlength="40"
            :disabled="builtin" :aria-label="$t('envelopes.name')" :placeholder="$t('envelopes.newName')">
          <div class="select-field env-ident__program">
            <select v-model.number="draft.program" :disabled="builtin" :aria-label="$t('envelopes.program')">
              <option v-if="builtin" :value="draft.program">P{{ draft.program }}</option>
              <option v-for="p in programOptions" v-else :key="p" :value="p" :disabled="takenPrograms.has(p)">
                P{{ p }}{{ takenPrograms.has(p) ? ` · ${$t('envelopes.programTakenShort')}` : '' }}</option>
            </select>
          </div>
          <span class="env-slot" :class="'is-' + slotKind" :title="$t('envelopes.slot.' + slotKind + 'Hint')">
            <i class="fas" :class="{ firmware: 'fa-lock', eeprom: 'fa-memory', volatile: 'fa-rotate' }[slotKind]"></i>{{
              $t('envelopes.slot.' + slotKind) }}
          </span>
          <span class="env-ident__sep" aria-hidden="true"></span>
          <div class="env-uses">
            <template v-if="builtin"><span class="env-uses__label">{{ $t('envelopes.builtinUses') }}</span></template>
            <template v-else-if="uses.length">
              <span class="env-uses__label">{{ $t('envelopes.usedBy') }}</span>
              <span v-for="u in uses.slice(0, USES_SHOWN)" :key="u.name" class="env-uses__chip"
                :title="$t('envelopes.usedByHint')">{{ u.name }}<span class="env-uses__ch">ch {{ u.channels.join(', ')
                }}</span></span>
              <span v-if="uses.length > USES_SHOWN" class="env-uses__chip"
                :title="uses.slice(USES_SHOWN).map((u) => u.name).join(', ')">+{{ uses.length - USES_SHOWN }}</span>
            </template>
            <span v-else class="env-uses__label">{{ $t('envelopes.notUsedYet') }}</span>
          </div>
        </div>

        <!-- the curve -->
        <div class="env-card env-graph-card">
          <div class="env-toolbar">
            <segmented-control v-model="zoom" :options="zoomOptions" :aria-label="$t('envelopes.zoom')" />
            <!-- the test note: its length is also the note-off line of the graph -->
            <div class="env-test" role="group" :aria-label="$t('envelopes.testGroup')">
              <span class="env-test__label"><i class="fas fa-headphones"></i><span class="env-test__label-text">{{
                $t('envelopes.testGroup') }}</span></span>
              <label class="env-notelen" :title="$t('envelopes.noteLength')">
                <input v-model.number="noteMs" type="range" min="50" :max="MAX_NOTE_MS" step="10"
                  :aria-label="$t('envelopes.noteLength')">
                <output>{{ fmtMs(noteMs) }}</output>
              </label>
            <div class="env-listen">
              <div class="select-field env-listen__note">
                <select v-model.number="auditionNote" :aria-label="$t('envelopes.listenNote')">
                  <option v-for="n in AUDITION_NOTES" :key="n" :value="n">{{ noteName(n) }} · {{ noteHzLabel(n) }}</option>
                </select>
              </div>
              <button class="btn btn--volt env-listen__btn" type="button" :title="$t('envelopes.listenSynthHint')"
                @click="toggleSynth">
                <span class="icon"><i class="fas" :class="synthRunner ? 'fa-stop' : 'fa-play'"></i></span>{{ synthRunner
                  ? $t('label.stop') : $t('envelopes.listenSynth') }}
              </button>
              <div ref="coilMenuEl" class="env-coil">
                <button class="btn env-listen__btn" type="button" :class="{ 'btn--stop': coilRunner }"
                  :disabled="!coilOutput && !coilRunner"
                  :title="coilOutput ? $t('envelopes.listenCoilHint') : $t('envelopes.coilNeedsOutput')"
                  @click="coilRunner ? toggleCoil() : (coilMenu = !coilMenu)">
                  <span class="icon"><i class="fas" :class="coilRunner ? 'fa-stop' : 'fa-bolt'"></i></span>{{ coilRunner
                    ? $t('label.stop') : $t('envelopes.listenCoil') }}
                </button>
                <div v-if="coilMenu && !coilRunner" class="env-coil__menu">
                  <p class="env-coil__title">{{ $t('envelopes.coilTestTitle') }}</p>
                  <div class="env-coil__row">
                    <div class="select-field">
                      <select v-model.number="testCoil" :aria-label="$t('label.coil')">
                        <option v-for="i in coilOptions" :key="i" :value="i">{{ $t('label.coil') }} {{ i }}{{
                          midiStore.coilName(i) ? ` · ${midiStore.coilName(i)}` : '' }}</option>
                      </select>
                    </div>
                    <label class="env-coil__ontime">
                      <input v-model.number="testOntime" class="text-field" type="number" min="1" max="1000" step="1"
                        :aria-label="$t('label.ontime')">
                      <span>µs</span>
                    </label>
                  </div>
                  <p class="env-coil__hint">{{ $t('envelopes.coilTestHint') }}</p>
                  <button class="btn btn--volt env-coil__play" type="button" :disabled="!(testOntime > 0)"
                    @click="coilMenu = false; toggleCoil()">
                    <span class="icon"><i class="fas fa-bolt"></i></span>{{ $t('envelopes.coilTestPlay') }}
                  </button>
                </div>
              </div>
            </div>
            </div>
          </div>
          <envelope-graph v-model:steps="draft.steps" v-model:note-ms="noteMs" v-model:hover-step="hoverStep"
            :readonly="builtin" :zoom="zoom" :max-note-ms="MAX_NOTE_MS" />
        </div>

        <!-- the 8 steps -->
        <div class="env-card env-steps-card">
          <envelope-steps-table v-model:steps="draft.steps" v-model:hover-step="hoverStep" :readonly="builtin" />
        </div>
      </section>
    </div>

    <ConfirmModal :open="confirmDelete" :title="$t('envelopes.deleteTitle')" :message="uses.length
      ? $t('envelopes.deleteUsed', { p: draft.program, n: uses.length })
      : $t('envelopes.deleteQuestion', { p: draft.program, name: draft.name })" :confirm-label="$t('label.delete')"
      :cancel-label="$t('label.cancel')" @confirm="doDelete" @close="confirmDelete = false" />
    <ConfirmModal :open="confirmMove" :title="$t('envelopes.moveTitle')"
      :message="$t('envelopes.moveQuestion', { from: baseline?.program ?? '', to: draft.program, n: usesOf(baseline?.program ?? -1).length })"
      :confirm-label="$t('label.save')" :cancel-label="$t('label.cancel')" @confirm="save" @close="confirmMove = false" />
    <ConfirmModal :open="pendingLeave != null" :title="$t('envelopes.discardTitle')"
      :message="$t('envelopes.discardQuestion')" :confirm-label="$t('envelopes.discard')"
      :cancel-label="$t('label.cancel')" @confirm="answerDiscard(true)" @close="answerDiscard(false)" />
  </div>
</template>

<style scoped>
/* fills the viewport: only the library scrolls */
.env-screen { min-height: 0; }
.env-head { gap: 1rem; flex-wrap: wrap; min-height: 4.4rem; }
.env-head__title { display: flex; align-items: baseline; gap: 0.9rem; min-width: 0; flex-wrap: wrap; }
.env-head__sub { color: var(--text-mute); font-size: var(--fs-sm); }
.env-head__actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.env-dirty { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--amber); font-size: var(--fs-sm); white-space: nowrap; margin-right: 0.3rem; }
.env-dirty i { font-size: 0.45rem; }

.env-body {
  flex: 1 1 auto; min-height: 0;
  display: grid; grid-template-columns: 15.5rem minmax(0, 1fr); gap: 1rem;
  padding: 0 2rem 1.2rem;
}
.env-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg); }

/* library */
.env-lib { display: flex; flex-direction: column; min-height: 0; }
.env-lib__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 0.5rem 0.4rem; }
.env-lib__group {
  position: sticky; top: 0; z-index: 1; background: var(--panel);
  display: flex; justify-content: space-between; gap: 0.5rem;
  padding: 0.7rem 0.4rem 0.4rem; font-size: var(--fs-xs); color: var(--text-mute);
  text-transform: uppercase; letter-spacing: 0.08em;
}
.env-lib__empty { margin: 0.2rem 0.4rem 0.6rem; font-size: var(--fs-sm); color: var(--text-mute); line-height: 1.45; }
.env-row {
  display: grid; grid-template-columns: 2.4rem minmax(0, 1fr) auto; align-items: center; gap: 0.5rem;
  width: 100%; padding: 0.4rem; border-radius: var(--radius); border: 1px solid transparent;
  background: transparent; color: var(--text); text-align: left; cursor: pointer; font: inherit;
}
.env-row:hover { background: var(--volt-08); }
.env-row.is-active { background: var(--panel-2); border-color: var(--line-strong); }
.env-pchip {
  font-family: var(--font-mono); font-size: var(--fs-xs); text-align: center; padding: 2px 0;
  color: var(--volt); background: var(--volt-10); border: 1px solid var(--volt-30); border-radius: var(--radius-sm);
}
.env-pchip.is-builtin { color: var(--text-dim); background: transparent; border-color: var(--line-strong); }
.env-row__text { display: flex; flex-direction: column; min-width: 0; }
.env-row__name { font-size: var(--fs-md); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.env-row__meta { font-size: var(--fs-xs); color: var(--text-mute); }
.env-row__meta.is-new { color: var(--amber); }
.env-lib__foot { padding: 0.6rem; border-top: 1px solid var(--line); }
.env-lib__new { width: 100%; justify-content: center; }

/* editor */
.env-editor { display: flex; flex-direction: column; gap: 0.75rem; min-height: 0; min-width: 0; }
.env-ident { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; min-width: 0; }
.env-ident__name { flex: 1 1 12rem; min-width: 8rem; width: auto; }
.env-ident__program { flex: 0 0 7rem; }
.env-ident__sep { width: 1px; align-self: stretch; background: var(--line); }
.env-slot {
  display: inline-flex; align-items: center; gap: 0.4rem; padding: 3px 9px; border-radius: 999px; white-space: nowrap;
  font-size: var(--fs-xs); color: var(--text-dim); border: 1px solid var(--line-strong); cursor: help;
}
.env-slot.is-eeprom { color: var(--ok); border-color: rgb(61 220 151 / 0.35); }
.env-uses { flex: 1 1 14rem; min-width: 0; display: flex; align-items: center; gap: 0.4rem; overflow: hidden; }
.env-uses__label { font-size: var(--fs-xs); color: var(--text-mute); white-space: nowrap; }
.env-uses__chip {
  font-size: var(--fs-xs); white-space: nowrap; padding: 2px 8px; border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong); max-width: 14rem; overflow: hidden; text-overflow: ellipsis;
}
.env-uses__ch { margin-left: 0.35rem; font-family: var(--font-mono); color: var(--text-mute); }

.env-graph-card { flex: 1 1 auto; min-height: 12rem; display: flex; flex-direction: column; }
.env-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1rem;
  padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--line);
}
/* everything that plays the test note, boxed apart from the view controls */
.env-test {
  display: flex; align-items: center; gap: 0.6rem; margin-left: auto;
  padding: 0.25rem 0.3rem 0.25rem 0.7rem; border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--bg-2);
}
.env-test__label { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--text-dim); font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; }
.env-test__label i { color: var(--volt); }
.env-notelen { display: flex; align-items: center; gap: 0.5rem; font-size: var(--fs-sm); color: var(--text-dim); margin: 0; padding: 0; }
.env-notelen input { width: 8rem; accent-color: var(--volt); }
.env-notelen output { font-family: var(--font-mono); color: var(--text); min-width: 3.4rem; font-size: var(--fs-sm); }
.env-listen { display: flex; align-items: center; gap: 0.4rem; }
.env-listen__note select { padding: 0.35rem 1.8rem 0.35rem 0.6rem; font-size: var(--fs-sm); }
.env-listen__btn { padding: 0.4rem 0.8rem; font-size: var(--fs-sm); }
.env-coil { position: relative; }
.env-coil__menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: 19rem;
  background: var(--panel-2); border: 1px solid var(--line-strong); border-radius: var(--radius);
  padding: 0.8rem; box-shadow: 0 12px 32px rgb(0 0 0 / 0.45); display: flex; flex-direction: column; gap: 0.6rem;
}
.env-coil__title { margin: 0; font-weight: 600; font-size: var(--fs-md); }
.env-coil__row { display: grid; grid-template-columns: minmax(0, 1fr) 6.5rem; gap: 0.5rem; }
.env-coil__row select { font-size: var(--fs-sm); padding: 0.45rem 1.8rem 0.45rem 0.6rem; }
.env-coil__ontime { display: flex; align-items: center; gap: 0.35rem; margin: 0; padding: 0; color: var(--text-mute); font-size: var(--fs-sm); }
.env-coil__ontime .text-field { padding: 0.4rem 0.5rem; font-size: var(--fs-sm); }
.env-coil__hint { margin: 0; font-size: var(--fs-xs); color: var(--text-mute); line-height: 1.45; }
.env-coil__play { justify-content: center; }

.env-steps-card { padding: 0.5rem 0.75rem 0.6rem; flex: none; }

/* a laptop width: keep the toolbar on one line so the graph keeps its height */
@media (max-width: 1400px) {
  .env-notelen input { width: 5.5rem; }
  .env-test__label-text { display: none; }
}

/* narrow or very short windows: back to a page that scrolls */
@media (max-width: 1100px), (max-height: 620px) {
  .env-body { flex: none; grid-template-columns: 1fr; padding: 0 1rem 1rem; }
  .env-lib { max-height: 17rem; }
  .env-graph-card { flex: none; height: 21rem; }
  .env-steps-card { overflow-x: auto; }
  .env-steps-card :deep(table) { min-width: 44rem; }
  .env-ident { flex-wrap: wrap; }
}
</style>
