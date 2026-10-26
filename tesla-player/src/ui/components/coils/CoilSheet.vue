<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useMidiStore } from '@/app/stores/midi';
import { coilColor, UNPLUGGED_COLOR } from '@/ui/helpers/coil-colors';
import { notify } from '@/ui/helpers/toast';
import { serverMessage } from '@/api/http';
import { useLeaveGuard } from '@/ui/helpers/leave-guard';
import { useScrolled } from '@/ui/helpers/use-scrolled';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import { mobileLayout } from '@/ui/helpers/viewport';
import CoilField from './CoilField.vue';
import CoilDimensions from './CoilDimensions.vue';
import CoilScene3d from './CoilScene3d.vue';
import NotePower from './NotePower.vue';
import OntimeRuler from './OntimeRuler.vue';
import { createCoil, deleteCoil, reorderCoils, updateCoil } from '@/api/coils';
import type { TeslaCoil } from '@/model/coils/inventory';
import { PhySpec, type CoilPresetId, type CoilSpec } from '@/model/coils/spec';
import { PhyJavaTc } from '@/model/coils/javatc';
import { useCoilFields } from './use-coil-fields';
import { useCoilModel } from './use-coil-model';
import { usePlayPoint } from './use-play-point';

/**
 * A real coil's sheet: what the model needs of it (typed on a drawing to
 * scale and in one electrical panel, or read from a JavaTC output), and what
 * the model makes of it at a play point, a note and an ontime: its 3D
 * picture, what each ontime does (the slider's ruler, where the board's max
 * ontime sits on it), each note's power.
 */
/** `start`: the preset a coil being added starts from. */
const props = defineProps<{ coil: TeslaCoil | null; start?: CoilPresetId }>();
const { t, locale } = useI18n();
const router = useRouter();
const midiStore = useMidiStore();
const headScrolled = useScrolled();

// the colour of the fibre it is on; its curves keep the accent when it is on none
const output = computed(() => (props.coil ? midiStore.outputOf(props.coil.uuid) : -1));
const color = computed(() => (output.value >= 0 ? coilColor(output.value) : UNPLUGGED_COLOR));
const newName = computed(() => t('coils.newName', { n: midiStore.coilList.length + 1 }));
const draft = reactive<{ name: string; spec: CoilSpec; notes: string }>({
  name: props.coil?.name ?? newName.value,
  spec: props.coil ? PhySpec.resolve(props.coil.spec) : PhySpec.preset(props.start ?? 'petite'),
  notes: props.coil?.notes ?? '',
});
const payload = () => JSON.stringify({ name: draft.name.trim(), spec: PhySpec.stored(draft.spec), notes: draft.notes.trim() });
// a new coil left as it came asks nothing on leaving; it can still be saved as it is
const baseline = ref(payload());
const dirty = computed(() => payload() !== baseline.value);
// opened before the inventory came: its number follows the inventory while the name is untouched
watch(newName, (name, old) => {
  if (props.coil || draft.name !== old) return;
  const untouched = !dirty.value;
  draft.name = name;
  if (untouched) baseline.value = payload();
});
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => dirty.value);

/* ------------------------------------------------------------ the fields */
const noteHz = ref(220);
const { calc, model, mid } = useCoilModel(() => draft.spec, noteHz, () => !anyInvalid.value);
const fields = useCoilFields(() => draft.spec, model);
const anyInvalid = ref(false);
const fieldsEl = ref<HTMLElement | null>(null);
function checkInvalid(): void {
  anyInvalid.value = !!fieldsEl.value?.querySelector('.coil-field.is-invalid');
}
const elecRows = (['power', 'tank', 'board'] as const).map((id) => ({ id, fields: fields.groups[id] }));
// the board's max ontime: a field, and a handle on the ontime ruler
const maxOntime = computed({
  get: () => draft.spec.board.ontime,
  set: (v: number) => fields.set(fields.groups.board[0], Math.max(1, Math.min(2000, v))),
});

/* ------------------------------------------------------------ JavaTC */
const importInput = ref<HTMLInputElement | null>(null);
async function onImport(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const found = PhyJavaTc.parse(await file.text());
  if (!found) { notify('coils.importFailed', 'error'); return; }
  for (const [k, v] of Object.entries(found)) (draft.spec as unknown as Record<string, unknown>)[k] = v;
  if (!found.top) delete draft.spec.top.rings;
  notify('coils.imported');
}

/* ------------------------------------------------------------ the model at the play point */
const NOTES = [55, 110, 220, 440, 880];
// the club plays mostly around 30–40 µs
const ontime = ref(40);
const { reach, bars, ruler } = usePlayPoint(() => draft.spec, model, calc, noteHz, ontime, NOTES);

const fr = (v: number, d = 0) => v.toLocaleString(locale.value, { maximumFractionDigits: d, minimumFractionDigits: d });
// its calculations page, at the note shown here
const calcLink = () => ({ name: 'coilsCalc', params: { id: props.coil?.id }, query: { hz: noteHz.value } });
// its own frequency, beside the resonance's fields: the sheet alone sets it
const freq = computed(() => {
  const fl = Math.round(model.value.fl / 1e3), withArc = mid.value ? Math.round(mid.value.o.fMin / 1e3) : fl;
  return { fl: fr(fl), arc: withArc !== fl ? t('coils.stat.flSub', { f: fr(withArc) }) : '' };
});

/* ------------------------------------------------------------ the phone: the picture held on top, the rest in tabs under it */
const phone = computed(() => mobileLayout.value);
const tab = ref<'results' | 'sheet'>('results');

/* ------------------------------------------------------------ saving */
const saving = ref(false);
const nameOk = computed(() => draft.name.trim().length > 0);
async function save(): Promise<void> {
  checkInvalid();
  if (saving.value || !nameOk.value || anyInvalid.value) return;
  saving.value = true;
  try {
    const input = { name: draft.name.trim(), spec: PhySpec.stored(draft.spec), notes: draft.notes.trim(), twinGroup: props.coil?.twinGroup ?? null };
    const saved = props.coil ? await updateCoil(props.coil.id, input) : await createCoil(input);
    midiStore.upsertCoil(saved);
    // its exemplaires are one config: theirs follows, their names and notes stay theirs
    for (const u of units.value) {
      if (JSON.stringify(u.spec) === JSON.stringify(input.spec)) continue;
      midiStore.upsertCoil(await updateCoil(u.id, { name: u.name, notes: u.notes, spec: input.spec, twinGroup: u.twinGroup }));
    }
    baseline.value = payload();
    notify('coils.saved');
    if (!props.coil) await router.replace({ name: 'coils', params: { id: String(saved.id) } });
  } catch (err) {
    console.error('Save coil failed', serverMessage(err) ?? err);
    notify('label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}

/* ------------------------------------------------------------ its exemplaires */
// coils built alike are one config (declared in the list): saving it saves theirs too
const units = computed(() => {
  const group = props.coil?.twinGroup;
  return group ? midiStore.coilList.filter((c) => c.twinGroup === group && c.uuid !== props.coil?.uuid) : [];
});
const sharedText = computed(() => t('coils.units.shared', { names: units.value.map((u) => u.name).join(', ') }, units.value.length));
const unitColor = (uuid: string) => { const o = midiStore.outputOf(uuid); return o >= 0 ? coilColor(o) : UNPLUGGED_COLOR; };

async function duplicate(): Promise<void> {
  try {
    const copy = await createCoil({ name: t('coils.copyName', { name: draft.name.trim() }), spec: PhySpec.stored(draft.spec), notes: draft.notes.trim() });
    midiStore.upsertCoil(copy);
    await router.push({ name: 'coils', params: { id: String(copy.id) } });
  } catch (err) {
    console.error('Duplicate coil failed', err);
    notify('label.saveFailed', 'error');
  }
}

const confirmDelete = ref(false);
async function remove(): Promise<void> {
  confirmDelete.value = false;
  const coil = props.coil;
  if (!coil) return;
  try {
    await deleteCoil(coil.id);
    midiStore.removeCoil(coil.id);
    // the coils after it move up one place: positions stay 0…n−1
    if (midiStore.coilList.length) midiStore.setCoilList(await reorderCoils(midiStore.coilList.map((c) => c.id)));
    baseline.value = payload();
    await router.push({ name: 'coils' });
  } catch (err) {
    console.error('Delete coil failed', err);
    notify('label.deleteFailed', 'error');
  }
}

function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!leavePending.value && !confirmDelete.value) void save();
  }
}
</script>

<template>
  <div class="screen coil-sheet" :style="{ '--c': color }" @keydown="onKey">
    <header class="screen-head coil-sheet__head" :class="{ 'is-scrolled': headScrolled }">
      <div class="coil-sheet__title">
        <router-link class="icon-btn" :to="{ name: 'coils' }" :title="$t('coils.back')" :aria-label="$t('coils.back')"><i
            class="fas fa-arrow-left"></i></router-link>
        <span class="coil-sheet__dot" aria-hidden="true"></span>
        <input v-model="draft.name" class="coil-sheet__name" type="text" maxlength="40" :aria-label="$t('coils.name')"
          :class="{ 'is-invalid': !nameOk }" :placeholder="$t('coils.name')">
        <!-- its exemplaires (declared in the list): one config, saved to all of them -->
        <span v-if="units.length" class="coil-twin" :title="sharedText"><i class="fas fa-clone"></i><span class="coil-twin__lead">{{
          $t('coils.units.chip') }}</span><span v-for="u in units" :key="u.id" class="coil-twin__name"><i class="coil-twin__dot"
            :style="{ '--c': unitColor(u.uuid) }"></i>{{ u.name }}</span></span>
      </div>
      <div class="coil-sheet__actions">
        <span v-if="dirty" class="coil-sheet__dirty"><i class="fas fa-circle"></i>{{ $t('coils.unsaved') }}</span>
        <router-link v-if="coil && !phone" class="btn btn--ghost" :to="calcLink()" :title="$t(dirty ? 'coils.calc.openSaved' : 'coils.calc.openHint')">
          <span class="icon"><i class="fas fa-square-root-variable"></i></span>{{ $t('coils.calc.open') }}
        </router-link>
        <drop-menu trigger-class="icon-btn icon-btn--sm" :label="$t('label.moreOptions')">
          <button class="dropdown__item" type="button" :title="$t('coils.importHint')" @click="importInput?.click()"><i
              class="fas fa-file-import"></i><span>{{ $t('coils.import') }}</span></button>
          <template v-if="coil">
            <button class="dropdown__item" type="button" @click="duplicate"><i class="fas fa-copy"></i><span>{{ $t('coils.duplicate') }}</span></button>
            <div class="dropdown__divider"></div>
            <button class="dropdown__item is-danger" type="button" @click="confirmDelete = true"><i class="fas fa-trash"></i><span>{{
              $t('label.delete') }}</span></button>
          </template>
        </drop-menu>
        <input ref="importInput" type="file" accept=".txt,text/plain" hidden @change="onImport">
        <button class="btn btn--volt coil-sheet__save" type="button" :disabled="(!dirty && !!coil) || saving || !nameOk" :title="$t('coils.saveShortcut')"
          :aria-label="$t('label.save')" @click="save">
          <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span><span class="coil-sheet__save-label">{{
            $t('label.save') }}</span>
        </button>
      </div>
    </header>

    <div class="coil-sheet__body" :class="{ 'is-phone': phone }">
      <!-- what it is built of -->
      <section v-show="!phone || tab === 'sheet'" ref="fieldsEl" class="coil-sheet__form" @input="checkInvalid">
        <section class="coil-group coil-dims">
          <header class="coil-group__head">{{ $t('coils.group.size') }}<small>{{ $t('coils.dims.scale') }}</small></header>
          <coil-dimensions :spec="draft.spec" :fields="fields.groups.size" :value-of="fields.valueOf" :hint-of="fields.hintOf"
            @set="fields.set" />
        </section>

        <section class="coil-group coil-elec">
          <div v-for="r in elecRows" :key="r.id" class="coil-elec__row">
            <header class="coil-elec__k">{{ $t(`coils.group.${r.id}`) }}<small v-if="r.id === 'board'">{{ $t('coils.group.boardSub') }}</small></header>
            <div class="coil-elec__fields">
              <div v-if="r.id === 'power'" class="coil-field coil-field--choice">
                <span class="coil-field__label">{{ $t('coils.field.bridge') }}</span>
                <segmented-control v-model="draft.spec.bridge"
                  :options="[{ value: 'full', label: $t('coils.bridge.full') }, { value: 'half', label: $t('coils.bridge.half') }]" />
              </div>
              <coil-field v-for="f in r.fields" :key="f.path" :label="$t(`coils.field.${f.key}`)" :unit="f.unit"
                :model-value="fields.valueOf(f)" :factor="f.factor" :digits="f.digits" :optional="f.optional" :min="f.min"
                :max="f.max" :computed-value="f.computed?.()" :empty-text="f.auto ? $t('coils.auto') : undefined" :hint="fields.hintOf(f.key)"
                @update:model-value="fields.set(f, $event)" />
              <p v-if="r.id === 'tank'" class="coil-elec__freq" :title="$t('coils.stat.flHint')"><i class="fas fa-wave-square"></i>{{ freq.fl }}
                kHz<small v-if="freq.arc">{{ freq.arc }}</small></p>
            </div>
          </div>
        </section>

        <label class="coil-group coil-notes">
          <span class="coil-group__head">{{ $t('coils.group.notes') }}</span>
          <textarea v-model="draft.notes" class="coil-notes__text" rows="2" maxlength="2000" :placeholder="$t('coils.notesPlaceholder')"></textarea>
        </label>
      </section>

      <!-- what the model makes of it, at the play point -->
      <section class="coil-sheet__model">
        <coil-scene3d class="coil-sheet__view" :spec="draft.spec" :output="output" :uuid="coil?.uuid" :ontime="ontime" :note-hz="noteHz" />
        <div v-if="phone" class="coil-sheet__tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="tab === 'results'" :class="{ 'is-on': tab === 'results' }" @click="tab = 'results'">{{
            $t('coils.sheetTabs.results') }}</button>
          <button type="button" role="tab" :aria-selected="tab === 'sheet'" :class="{ 'is-on': tab === 'sheet' }" @click="tab = 'sheet'">{{
            $t('coils.sheetTabs.sheet') }}</button>
        </div>
        <div v-show="!phone || tab === 'results'" class="coil-sheet__results">
          <section class="coil-group coil-result">
            <header class="coil-group__head">{{ $t('coils.ruler.title') }}<small>{{ $t('coils.ruler.at', { hz: noteHz }) }}</small></header>
            <ontime-ruler v-if="ruler" v-model:ontime="ontime" v-model:max="maxOntime" :data="ruler" :reach="reach" :compact="phone" />
          </section>
          <section class="coil-group coil-result">
            <header class="coil-group__head">{{ $t('coils.power.title') }}<small>{{ $t('coils.power.at', { us: Math.round(ontime) }) }}</small></header>
            <note-power v-model:note="noteHz" :bars="bars" />
          </section>
          <p v-if="coil" class="coil-sheet__more">{{ $t('coils.calc.more') }} <router-link :to="calcLink()">{{ $t('coils.calc.open') }} →</router-link></p>
          <p class="coil-sheet__note">{{ $t('coils.modelNote') }}</p>
        </div>
      </section>
    </div>

    <confirm-modal :open="confirmDelete" :title="$t('coils.deleteTitle', { name: draft.name })" warn :message="$t('coils.deleteMessage')"
      :confirm-label="$t('label.delete')" :cancel-label="$t('label.cancel')" @confirm="remove" @close="confirmDelete = false" />
    <confirm-modal :open="leavePending" :title="$t('label.unsavedChanges')" :message="$t('coils.discard')"
      :confirm-label="$t('label.discard')" :cancel-label="$t('label.cancel')" @confirm="answerLeave(true)"
      @close="answerLeave(false)" />
  </div>
</template>
