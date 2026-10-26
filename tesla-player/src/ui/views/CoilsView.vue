<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useMidiStore } from '@/app/stores/midi';
import { coilColor, UNPLUGGED_COLOR } from '@/ui/helpers/coil-colors';
import { ICONS } from '@/ui/helpers/icons';
import { notify } from '@/ui/helpers/toast';
import { useScrolled } from '@/ui/helpers/use-scrolled';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import CoilSheet from '@/ui/components/coils/CoilSheet.vue';
import CoilsTabs from '@/ui/components/coils/CoilsTabs.vue';
import { createCoil, deleteCoil, reorderCoils, updateCoil } from '@/api/coils';
import type { TeslaCoil } from '@/model/coils/inventory';
import { newId } from '@/utils/ids';
import { serverMessage } from '@/api/http';
import { PhySpec, type CoilPresetId } from '@/model/coils/spec';
import { PhySummary } from '@/model/coils/summary';

/**
 * The club's real coils, a row each on the same scales so that they compare:
 * their arcs at their max (the treble's to the bass's, the ground mat marked),
 * the pulse (no arc, in the air, striking the mat, the sheet's max padlocked),
 * their loudness under the loudest. The coils wear their output's colour on
 * their cap only: the bars' colours say what happens, the key under them. A
 * row opens the coil's sheet (/coils/:id, /coils/new).
 *
 * Coils built alike are one config: a row, its exemplaires' caps and names in
 * it (same twinGroup, as many as there are). One off stage, another plays its
 * songs (model/coils/stage.ts). Declared from the row's menu; their sheets share the
 * config (CoilSheet saves it to all of them).
 */
const route = useRoute();
const { t, locale } = useI18n();
const midiStore = useMidiStore();
const headScrolled = useScrolled();

const sheetId = computed(() => (typeof route.params.id === 'string' && route.params.id ? route.params.id : null));
const sheetCoil = computed(() => (sheetId.value && sheetId.value !== 'new' ? midiStore.coilList.find((c) => String(c.id) === sheetId.value) ?? null : null));
// a sheet asked for a coil that is not (yet) in the list: nothing to show until the list comes
const sheetMissing = computed(() => sheetId.value != null && sheetId.value !== 'new' && !sheetCoil.value);
// a coil being added starts from the values of the size picked
const startFrom = computed(() => (PhySpec.PRESET_IDS as string[]).includes(String(route.query.from)) ? (route.query.from as CoilPresetId) : undefined);

const fr = (v: number, d = 0) => v.toLocaleString(locale.value, { maximumFractionDigits: d, minimumFractionDigits: d });
// a row per config: a coil alone, or the exemplaires of one, in the inventory's order
const cards = computed(() => {
  const rows: { key: string; members: TeslaCoil[] }[] = [];
  for (const coil of midiStore.coilList) {
    const row = coil.twinGroup ? rows.find((r) => r.key === coil.twinGroup) : undefined;
    if (row) row.members.push(coil);
    else rows.push({ key: coil.twinGroup || coil.uuid, members: [coil] });
  }
  const list = rows.map((r, i) => {
    const coil = r.members[0];
    const spec = PhySpec.resolve(coil.spec);
    // each on the output it is on, in the colour of its fibre
    const units = r.members.map((m) => {
      const out = midiStore.outputOf(m.uuid);
      return { coil: m, out, color: out >= 0 ? coilColor(out) : UNPLUGGED_COLOR };
    });
    const on = units.find((u) => u.out >= 0);
    // exemplaires declared before their config was one: their sheets differ until one is taken
    const diverged = r.members.some((m) => JSON.stringify(m.spec) !== JSON.stringify(coil.spec));
    return { key: r.key, i, coil, spec, units, diverged, out: on?.out ?? -1, color: on?.color ?? UNPLUGGED_COLOR, s: PhySummary.of(spec) };
  });
  // the loudness: the power into the arcs at its max, against the loudest's
  const loud = list.reduce<(typeof list)[number] | null>((a, c) => (!a || c.s.powerW > a.s.powerW ? c : a), null);
  return list.map((c) => ({ ...c, levelDb: 10 * Math.log10(Math.max(1e-6, c.s.powerW) / Math.max(1e-6, loud?.s.powerW ?? 1)), loudest: c === loud }));
});
type Card = (typeof cards.value)[number];
const loudest = computed(() => cards.value.find((c) => c.loudest) ?? null);

// the shared scales, round, wide enough for every coil
const scale = computed(() => {
  const cs = cards.value;
  const arcTop = Math.max(1, ...cs.map((c) => Math.max(c.s.arcs.bass, c.s.strikeLen)));
  const m = Math.ceil((arcTop * 1.1) / 0.5) * 0.5;
  const us = Math.ceil((Math.max(100, ...cs.map((c) => c.spec.board.ontime)) * 1.2) / 50) * 50;
  const steps = (top: number, step: number): number[] => {
    const out: number[] = [];
    for (let v = 0; v <= top + 1e-9; v += step) out.push(+v.toFixed(3));
    return out;
  };
  return {
    m, us,
    mTicks: steps(m, m > 2 ? 1 : 0.5),
    usTicks: steps(us, us > 200 ? 100 : 50),
  };
});
const at = (v: number, top: number): number => Math.max(0, Math.min(100, (v / top) * 100));
const pct = (v: number): string => `${v}%`;
const dB = (v: number): string => `${v > -0.05 ? '' : '−'}${fr(Math.abs(v))}`;

// a row's bars, in % of their scale
function bars(c: Card) {
  const { m, us } = scale.value;
  const on = c.spec.board.ontime, strike = c.s.strikeFrom;
  return {
    treble: at(c.s.arcs.treble, m), bass: at(c.s.arcs.bass, m), mat: at(c.s.strikeLen, m),
    over: c.s.arcs.bass > c.s.strikeLen,
    arcFrom: at(c.s.arcFrom, us), strike: strike != null ? at(strike, us) : null, max: at(on, us),
  };
}
function arcsTitle(c: Card): string {
  const sentence = t('coils.list.arcsHint', {
    on: c.spec.board.ontime, duty: fr(c.spec.board.duty * 100, 1), treble: fr(c.s.arcs.treble, 2), bass: fr(c.s.arcs.bass, 2),
  });
  const mat = t(c.s.arcs.bass > c.s.strikeLen ? 'coils.list.matReached' : 'coils.list.matFree', { m: fr(c.s.strikeLen, 2) });
  return `${sentence} ${mat}`;
}
function volTitle(c: Card): string {
  const kw = fr(c.s.powerW / 1000, 1);
  return c.loudest ? t('coils.list.volLoudest', { kw }) : t('coils.list.volHint', { kw, db: fr(-c.levelDb, 1), name: loudest.value?.coil.name ?? '' });
}
// the key names what the bars show
const shows = computed(() => ({
  strike: cards.value.some((c) => c.s.strikeFrom != null || c.s.arcs.bass > c.s.strikeLen),
}));


// a row moves whole: its exemplaires stay together in the inventory's order
async function move(row: number, by: number): Promise<void> {
  const order = cards.value.map((c) => c.units.map((u) => u.coil.id));
  const to = row + by;
  if (row < 0 || to < 0 || to >= order.length) return;
  order.splice(to, 0, ...order.splice(row, 1));
  try {
    midiStore.setCoilList(await reorderCoils(order.flat()));
  } catch (err) {
    console.error('Reorder coils failed', err);
    notify('label.saveFailed', 'error');
  }
}

/* ------------------------------------------------------------ exemplaires */
const keep = (c: TeslaCoil, change: { spec?: TeslaCoil['spec']; twinGroup?: string | null }) =>
  ({ name: c.name, notes: c.notes, spec: change.spec ?? c.spec, twinGroup: change.twinGroup !== undefined ? change.twinGroup : c.twinGroup });
const busy = ref(false);
async function run(what: string, job: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await job();
  } catch (err) {
    console.error(what, serverMessage(err) ?? err);
    notify('label.saveFailed', 'error');
  } finally {
    busy.value = false;
  }
}
// one more built alike: the same config, a name and an output of its own
function addUnit(c: Card): Promise<void> {
  return run('Add exemplaire failed', async () => {
    const group = c.coil.twinGroup || newId();
    if (!c.coil.twinGroup) midiStore.upsertCoil(await updateCoil(c.coil.id, keep(c.coil, { twinGroup: group })));
    const copy = await createCoil({ name: t('coils.units.name', { name: c.coil.name, n: c.units.length + 1 }), spec: c.coil.spec, notes: '', twinGroup: group });
    midiStore.upsertCoil(copy);
    // right after its row
    const order = cards.value.map((r) => r.units.map((u) => u.coil.id)).flat().filter((id) => id !== copy.id);
    order.splice(order.indexOf(c.units[c.units.length - 1].coil.id) + 1, 0, copy.id);
    midiStore.setCoilList(await reorderCoils(order));
  });
}
// a row joins another's: its coils take that config (confirmed first: their sheets are replaced)
const joining = ref<{ row: Card; to: Card } | null>(null);
function join(): Promise<void> {
  const j = joining.value;
  joining.value = null;
  if (!j) return Promise.resolve();
  return run('Join exemplaires failed', async () => {
    const group = j.to.coil.twinGroup || newId();
    for (const u of j.to.units) if (u.coil.twinGroup !== group) midiStore.upsertCoil(await updateCoil(u.coil.id, keep(u.coil, { twinGroup: group })));
    for (const u of j.row.units) midiStore.upsertCoil(await updateCoil(u.coil.id, keep(u.coil, { spec: j.to.coil.spec, twinGroup: group })));
  });
}
// one leaves its row with a copy of the config; a coil left alone is no exemplaire any more
function split(c: Card, coil: TeslaCoil): Promise<void> {
  return run('Split exemplaire failed', async () => {
    midiStore.upsertCoil(await updateCoil(coil.id, keep(coil, { twinGroup: null })));
    const rest = c.units.filter((u) => u.coil.id !== coil.id);
    if (rest.length === 1) midiStore.upsertCoil(await updateCoil(rest[0].coil.id, keep(rest[0].coil, { twinGroup: null })));
  });
}
// declared before their config was one: every exemplaire takes one's sheet
function align(c: Card, from: TeslaCoil): Promise<void> {
  return run('Align exemplaires failed', async () => {
    for (const u of c.units) if (u.coil.id !== from.id) midiStore.upsertCoil(await updateCoil(u.coil.id, keep(u.coil, { spec: from.spec })));
  });
}

async function duplicate(coil: TeslaCoil): Promise<void> {
  try {
    const copy = await createCoil({ name: t('coils.copyName', { name: coil.name }), spec: PhySpec.stored(PhySpec.resolve(coil.spec)), notes: coil.notes });
    midiStore.upsertCoil(copy);
  } catch (err) {
    console.error('Duplicate coil failed', err);
    notify('label.saveFailed', 'error');
  }
}

const toDelete = ref<TeslaCoil | null>(null);
async function remove(): Promise<void> {
  const coil = toDelete.value;
  toDelete.value = null;
  if (!coil) return;
  try {
    await deleteCoil(coil.id);
    midiStore.removeCoil(coil.id);
    if (midiStore.coilList.length) midiStore.setCoilList(await reorderCoils(midiStore.coilList.map((c) => c.id)));
  } catch (err) {
    console.error('Delete coil failed', err);
    notify('label.deleteFailed', 'error');
  }
}

</script>

<template>
  <coil-sheet v-if="sheetId && !sheetMissing" :key="sheetId" :coil="sheetCoil" :start="startFrom" />
  <div v-else class="screen coil-inv-screen">
    <header class="screen-head coil-inv-head" :class="{ 'is-scrolled': headScrolled }">
      <h1 class="view-head__title">{{ $t('coils.title') }}</h1>
      <coils-tabs />
    </header>

    <div class="screen-body coil-inv-body">
      <p v-if="sheetMissing" class="coil-inv-body__missing">{{ $t('coils.missing') }}</p>
      <div class="coil-inv-list">
        <!-- the columns: what each bar is, its scale and unit -->
        <div class="coil-inv-cols" aria-hidden="true">
          <span class="coil-inv-cols__id">{{ $t('coils.list.coil') }}</span>
          <div class="coil-inv-cols__k">
            <b>{{ $t('coils.list.arcs') }}</b>
            <span class="coil-ruler"><span class="coil-ruler__t"><span v-for="v in scale.mTicks" :key="v" :style="{ left: pct(at(v, scale.m)) }">{{
              fr(v, v % 1 ? 1 : 0) }}</span></span><span class="coil-ruler__u">m</span></span>
          </div>
          <div class="coil-inv-cols__k">
            <b>{{ $t('coils.list.pulse') }}<small>{{ $t('coils.list.pulseSub') }}</small></b>
            <span class="coil-ruler is-bare"><span class="coil-ruler__t"><span v-for="(v, k) in scale.usTicks" :key="v" :style="{ left: pct(at(v, scale.us)) }">{{
              v }}{{ k === scale.usTicks.length - 1 ? ' µs' : '' }}</span></span></span>
          </div>
          <div class="coil-inv-cols__k is-vol">
            <b>{{ $t('coils.list.volume') }}<small>{{ $t('coils.list.volumeSub') }}</small></b>
          </div>
          <span></span>
        </div>

        <!-- a row per coil: its name's link covers the row, the menu sits above it -->
        <article v-for="c in cards" :key="c.coil.id" class="coil-inv" :class="{ 'is-off': c.out < 0 }" :style="{ '--c': c.color }">
          <div class="coil-inv__id">
            <!-- each exemplaire: the output it is on (else nothing: it doesn't play here), its name, its sheet -->
            <span v-for="(u, k) in c.units" :key="u.coil.id" class="coil-inv__unit" :style="{ '--c': u.color }">
              <span class="fiber-cap fiber-cap--lg" :title="u.out >= 0 ? $t('player.wiring.cap', { n: u.out, color: $t(`player.wiring.caps.${u.out % 6}`) }) : $t('player.wiring.none')"><span
                  class="fiber-cap__n">{{ u.out >= 0 ? u.out : '–' }}</span></span>
              <router-link class="coil-inv__name" :class="{ 'is-first': k === 0 }" :to="{ name: 'coils', params: { id: String(u.coil.id) } }"
                :title="$t('coils.open', { name: u.coil.name })">{{ u.coil.name }}</router-link>
            </span>
            <span class="coil-inv__meta">
              <span v-if="c.diverged" class="coil-inv__diverged" :title="$t('coils.units.divergedHint')"><i
                  class="fas fa-triangle-exclamation"></i>{{ $t('coils.units.diverged') }}</span>
              <span class="coil-inv__fl" :title="$t('coils.stat.flHint')">{{ fr(c.s.model.fl / 1e3) }} kHz</span>
            </span>
          </div>

          <div class="coil-bar is-arcs" :title="arcsTitle(c)">
            <span class="coil-bar__k">{{ $t('coils.list.arcs') }}</span>
            <span class="coil-bar__track">
              <i v-for="v in scale.mTicks.slice(1, -1)" :key="v" class="coil-bar__grid" :style="{ left: pct(at(v, scale.m)) }"></i>
              <i class="coil-bar__seg is-range" :style="{ width: pct(bars(c).bass) }"></i>
              <i class="coil-bar__seg is-air" :style="{ width: pct(Math.min(bars(c).treble, bars(c).mat)) }"></i>
              <i v-if="bars(c).over" class="coil-bar__seg is-strike"
                :style="{ left: pct(bars(c).mat), width: pct(bars(c).bass - bars(c).mat) }"></i>
              <i class="coil-bar__mat" :style="{ left: pct(bars(c).mat) }" :title="$t('coils.list.matHint', { m: fr(c.s.strikeLen, 2) })"></i>
              <!-- where its treble's arcs stop, where its bass's do: on the bar, not in a key -->
              <template v-if="c.s.arcs.bass - c.s.arcs.treble > 0.02">
                <span class="coil-bar__end" :style="{ left: pct(bars(c).treble) }">{{ $t('coils.list.treble') }}</span>
                <span class="coil-bar__end is-above" :style="{ left: pct(bars(c).bass) }">{{ $t('coils.list.bass') }}</span>
              </template>
            </span>
            <span class="coil-bar__v">{{ fr(c.s.arcs.bass, 2) }}<small>m</small></span>
          </div>

          <div class="coil-bar is-pulse">
            <span class="coil-bar__k">{{ $t('coils.list.pulse') }}</span>
            <span class="coil-bar__track">
              <i v-for="v in scale.usTicks.slice(1, -1)" :key="v" class="coil-bar__grid" :style="{ left: pct(at(v, scale.us)) }"></i>
              <i class="coil-bar__seg is-short" :style="{ width: pct(bars(c).arcFrom) }"
                :title="$t('coils.list.shortHint', { us: Math.round(c.s.arcFrom) })"></i>
              <i class="coil-bar__seg is-air" :style="{ left: pct(bars(c).arcFrom), width: pct((bars(c).strike ?? bars(c).max) - bars(c).arcFrom) }"
                :title="$t('coils.list.airHint', { from: Math.round(c.s.arcFrom), to: Math.round(c.s.strikeFrom ?? c.spec.board.ontime) })"></i>
              <i v-if="bars(c).strike != null" class="coil-bar__seg is-strike"
                :style="{ left: pct(bars(c).strike!), width: pct(bars(c).max - bars(c).strike!) }"
                :title="$t('coils.list.strikeHint', { us: Math.round(c.s.strikeFrom!) })"></i>
              <i class="coil-bar__seg is-past" :style="{ left: pct(bars(c).max), right: 0 }" :title="$t('coils.list.pastHint')"></i>
              <i class="coil-bar__lim" :style="{ left: pct(bars(c).max) }" :title="$t('coils.list.maxHint', { us: c.spec.board.ontime })"></i>
              <span v-if="bars(c).strike != null" class="coil-bar__num is-strike is-above" :style="{ left: pct(bars(c).strike!) }"
                :title="$t('coils.list.strikeHint', { us: Math.round(c.s.strikeFrom!) })">{{ Math.round(c.s.strikeFrom!) }} µs</span>
              <span class="coil-bar__num is-max" :style="{ left: pct(bars(c).max) }" :title="$t('coils.list.maxHint', { us: c.spec.board.ontime })"><i
                  class="fas fa-lock"></i>{{ c.spec.board.ontime }} µs</span>
            </span>
          </div>

          <div class="coil-bar is-vol" :title="volTitle(c)">
            <span class="coil-bar__k">{{ $t('coils.list.volume') }}</span>
            <span class="coil-bar__v" :class="{ 'is-mute': !c.loudest }">{{ dB(c.levelDb) }}<small>dB</small></span>
          </div>

            <span class="coil-inv__menu">
              <drop-menu trigger-class="icon-btn icon-btn--sm" :label="$t('label.moreOptions')">
                <button class="dropdown__item" type="button" :disabled="c.i === 0" @click="move(c.i, -1)"><i class="fas fa-arrow-up"></i><span>{{ $t('coils.moveUp') }}</span></button>
                <button class="dropdown__item" type="button" :disabled="c.i === cards.length - 1" @click="move(c.i, 1)"><i class="fas fa-arrow-down"></i><span>{{ $t('coils.moveDown') }}</span></button>
                <div class="dropdown__divider"></div>
                <button class="dropdown__item" type="button" :disabled="busy" :title="$t('coils.units.addHint')" @click="addUnit(c)"><i
                    class="fas fa-clone"></i><span>{{ $t('coils.units.add') }}</span></button>
                <template v-if="cards.length > 1">
                  <span class="dropdown__header">{{ $t('coils.units.sameAs') }}</span>
                  <button v-for="o in cards.filter((x) => x.key !== c.key)" :key="o.key" class="dropdown__item" type="button" :disabled="busy"
                    @click="joining = { row: c, to: o }"><i class="fas fa-link"></i><span>{{ o.units.map((u) => u.coil.name).join(' · ') }}</span></button>
                </template>
                <template v-if="c.diverged">
                  <span class="dropdown__header">{{ $t('coils.units.alignHeader') }}</span>
                  <button v-for="u in c.units" :key="u.coil.id" class="dropdown__item" type="button" :disabled="busy" @click="align(c, u.coil)"><i
                      class="fas fa-file-import"></i><span>{{ $t('coils.units.alignTo', { name: u.coil.name }) }}</span></button>
                </template>
                <template v-if="c.units.length > 1">
                  <div class="dropdown__divider"></div>
                  <button v-for="u in c.units" :key="u.coil.id" class="dropdown__item" type="button" :disabled="busy" :title="$t('coils.units.splitHint')"
                    @click="split(c, u.coil)"><i class="fas fa-link-slash"></i><span>{{ $t('coils.units.split', { name: u.coil.name }) }}</span></button>
                </template>
                <div class="dropdown__divider"></div>
                <button class="dropdown__item" type="button" @click="duplicate(c.coil)"><i class="fas fa-copy"></i><span>{{ $t('coils.duplicate') }}</span></button>
                <button v-for="u in c.units" :key="`d${u.coil.id}`" class="dropdown__item is-danger" type="button" @click="toDelete = u.coil"><i
                    class="fas fa-trash"></i><span>{{ c.units.length > 1 ? $t('coils.units.delete', { name: u.coil.name }) : $t('label.delete') }}</span></button>
              </drop-menu>
            </span>
        </article>
        <!-- the size only gives the new coil its first values -->
        <div class="coil-inv is-add">
          <span class="coil-inv__add"><i class="fas" :class="ICONS.coil"></i>{{ $t('coils.add') }}</span>
          <span class="coil-inv__sizes" :title="$t('coils.sizeHint')">
            <router-link v-for="id in PhySpec.PRESET_IDS" :key="id" class="btn btn--ghost"
              :to="{ name: 'coils', params: { id: 'new' }, query: { from: id } }">{{ $t(`coils.size.${id}`) }}</router-link>
          </span>
        </div>

        <!-- what the bars' colours say: only those the rows show -->
        <p v-if="cards.length" class="coil-inv-key">
          <span><i class="coil-inv-key__sw is-air"></i>{{ $t('coils.list.key.air') }}</span>
          <span v-if="shows.strike"><i class="coil-inv-key__sw is-strike"></i>{{ $t('coils.list.key.strike') }}</span>
          <span><i class="coil-inv-key__sw is-mat"></i>{{ $t('coils.list.key.mat') }}</span>
          <span><i class="coil-inv-key__sw is-short"></i>{{ $t('coils.list.key.short') }}</span>
          <span><i class="coil-inv-key__sw is-past"></i><i class="fas fa-lock coil-inv-key__lock"></i>{{ $t('coils.list.key.past') }}</span>
        </p>
      </div>
    </div>

    <confirm-modal :open="joining != null" :title="$t('coils.units.joinTitle')"
      :message="joining ? $t('coils.units.joinMessage', { names: joining.row.units.map((u) => u.coil.name).join(', '), to: joining.to.coil.name }) : ''"
      :confirm-label="$t('coils.units.joinConfirm')" :cancel-label="$t('label.cancel')" @confirm="join" @close="joining = null" />
    <confirm-modal :open="toDelete != null" :title="$t('coils.deleteTitle', { name: toDelete?.name ?? '' })" warn :message="$t('coils.deleteMessage')"
      :confirm-label="$t('label.delete')" :cancel-label="$t('label.cancel')" @confirm="remove" @close="toDelete = null" />
  </div>
</template>
