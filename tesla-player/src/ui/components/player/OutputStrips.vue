<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/app/stores/midi';
import { COIL_COLOR_COUNT, coilColor } from '@/ui/helpers/coil-colors';
import { ICONS } from '@/ui/helpers/icons';
import { notify } from '@/ui/helpers/toast';
import { pctLabel } from '@/utils/format';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import VFader from '@/ui/components/ui/VFader.vue';
import type { TeslaCoil } from '@/model/coils/inventory';
import type { CoilLimits } from '@/model/devices/coil-limits';
import { boardCheck } from '@/app/board-check';
import { CoilWiring, coilWiring } from '@/app/wiring';

/**
 * On stage, one strip per output of the board, in its order: its fibre's cap
 * and the coil plugged on it (its menu swaps or unplugs it), the coil's power
 * (it follows the coil to another output), what it fires now against its
 * limits (duty, ontime), the reduction the max duty forces, the notes it
 * silences. A coil of the song on no output gets a ghost strip with the
 * output to plug it on; the next free output, a strip to plug one. The
 * general Power (`master` slot) ends the row, as on a mixing desk.
 *
 * The parent (MidiPlayer) owns the powers and what is sent: `power-input`
 * streams a fader's drag, `power-change` fires once it is let go.
 */
export interface StripRow {
  output: number;
  /** The inventory's coil plugged there; null on a server without the inventory. */
  coil: TeslaCoil | null;
  name: string;
  color: string;
  /** Where the coil's power is kept. */
  powerKey: string;
  /** Its own share, the fader's handle. */
  power: number;
  /** What it receives: its share × the general Power (capped). */
  received: number;
  /** The power it receives past which its bass is at its max ontime; null: never under 200 %. */
  notch: number | null;
  /** The song loaded plays it. */
  inSong: boolean;
  /** What the board was sent for it at this moment. */
  sent: { ontimeUs: number; duty: number } | null;
  limits: CoilLimits | null;
  /** What it fires at the playhead. */
  live: {
    dutyAsked: number; duty: number; factor: number; pulseUs: number; askedUs: number;
    skippedNow: boolean; skippedSoFar: number;
  } | null;
  /** Near the board's protection threshold: the warning. */
  warn: string;
}
const props = defineProps<{
  strips: StripRow[];
  /** The song's places with no output, and their coil. */
  offStage: { place: number; coil: TeslaCoil | null }[];
  max: number;
  /** The general Power, for what each coil receives. */
  master: number;
  /**
   * Débutant (ui/helpers/ui-mode.ts): a power and an activity gauge per coil; the wiring,
   * the duty and ontime meters, the reduction, the skipped notes and the key go.
   */
  simple?: boolean;
}>();
const emit = defineEmits<{
  (e: 'power-input', key: string, value: number): void;
  (e: 'power-change'): void;
}>();
const { t } = useI18n();
const midiStore = useMidiStore();

const FOLD_KEY = 'playerStripsFolded';
const folded = ref(localStorage.getItem(FOLD_KEY) === '1');
watch(folded, (v) => {
  try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* folded for the visit */ }
});

const capLabel = (o: number): string => t('player.wiring.cap', { n: o, color: t(`player.wiring.caps.${o % COIL_COLOR_COUNT}`) });
const firstFree = computed(() => {
  for (let o = 0; o < midiStore.deviceProfile.coils; o++) if (!midiStore.wiredCoil(o)) return o;
  return -1;
});
const unplugged = computed(() => midiStore.coilList.filter((c) => midiStore.outputOf(c.uuid) < 0));
// the board's real outputs read back, all set as the sheets
const inSync = computed(() => !!midiStore.midiOutput && !midiStore.isSynthOutput && boardCheck.readable && !boardCheck.diffs.length);

async function put(output: number, coil: TeslaCoil | null): Promise<void> {
  const next = coil ? CoilWiring.wire(midiStore.wiring, output, coil.uuid) : midiStore.wiring.map((u, o) => (o === output ? '' : u));
  try {
    await coilWiring.save(next);
  } catch (err) {
    console.error('Save wiring failed', err);
    notify('label.saveFailed', 'error');
  }
}

// the meters run to 1.5 × the coil's limit: the limit's mark sits at two thirds. Solid,
// what it fires; hatched right above, what was asked and cut (by the max, or the duty limiter)
const TOP = 1.5;
function gauge(v: number, asked: number, limit: number | undefined): { fill: number; over: number } | null {
  if (limit == null || !(limit > 0)) return null;
  const fill = (Math.min(v / limit, TOP) / TOP) * 100;
  const upTo = (Math.min(Math.max(v, asked) / limit, TOP) / TOP) * 100;
  return { fill, over: upTo - fill };
}
const rows = computed(() => props.strips.map((s) => {
  const lim = s.limits;
  const live = s.live;
  const minNote = lim?.minOntimeUs ? ` ${t('ontime.rack.minIncluded', { min: lim.minOntimeUs })}` : '';
  const sent = s.sent
    ? [
      `${t('ontime.rack.bass')} ${pctLabel(s.sent.duty)} %${lim?.duty != null && s.sent.duty > lim.duty ? ` (${t('ontime.rack.max', { v: `${pctLabel(lim.duty)} %` })})` : ''}`,
      `${t('ontime.rack.treble')} ${Math.round(s.sent.ontimeUs)} µs${lim?.ontimeUs != null && s.sent.ontimeUs > lim.ontimeUs ? ` (${t('ontime.rack.max', { v: `${lim.ontimeUs} µs` })})` : ''}`,
    ].join(' · ')
    : '';
  return {
    ...s,
    title: [`${s.name} · ${capLabel(s.output)}`, sent && `${t('ontime.rack.sent')} : ${sent}`].filter(Boolean).join('\n'),
    notchTitle: s.notch != null
      ? t('ontime.rack.notchTitle', { name: s.name, pct: s.notch, max: lim?.ontimeUs ?? '–' })
      : undefined,
    // at 100 % the sum would only repeat the strip's value
    receivedTitle: props.master !== 100
      ? t('player.strips.receivedHint', { received: s.received, own: s.power, master: props.master })
      : undefined,
    duty: gauge(live?.duty ?? 0, live?.dutyAsked ?? 0, lim?.duty),
    ontime: gauge(live?.pulseUs ?? 0, live?.askedUs ?? 0, lim?.ontimeUs),
    dutyTip: !live ? t('ontime.rack.dutyHint') : live.dutyAsked > live.duty + 1e-4
      ? t('ontime.rack.dutyTipCut', { duty: pctLabel(live.duty), asked: pctLabel(live.dutyAsked) })
      : t('ontime.rack.dutyTip', { duty: pctLabel(live.duty), max: lim?.duty != null ? pctLabel(lim.duty) : '–' }),
    ontimeTip: !live ? t('ontime.rack.ontimeHint') : (lim?.ontimeUs != null && live.askedUs > lim.ontimeUs
      ? t('ontime.rack.ontimeTipCut', { us: Math.round(live.pulseUs), asked: Math.round(live.askedUs) })
      : t('ontime.rack.ontimeTip', { us: Math.round(live.pulseUs), max: lim?.ontimeUs ?? '–' })) + minNote,
    reduction: live && live.factor < 0.995 ? `−${Math.round((1 - live.factor) * 100)} %` : '',
  };
}));
// the key names what the strips show: the limits' marks once a coil has them, the
// hatch once something was cut since the playback started (it stays to the stop)
const hasLimits = computed(() => rows.value.some((r) => r.duty || r.ontime));
const seenCut = ref(false);
watch(rows, (list) => {
  if (!list.some((r) => r.live)) seenCut.value = false;
  else if (list.some((r) => (r.duty?.over ?? 0) > 0.5 || (r.ontime?.over ?? 0) > 0.5)) seenCut.value = true;
});
const ghostName = (m: { place: number; coil: TeslaCoil | null }): string => m.coil?.name ?? `${t('label.coil')} ${m.place}`;
</script>

<template>
  <section class="strips" :class="{ 'is-folded': folded }" :aria-label="$t('player.wiring.title')">
    <header class="strips__head">
      <button class="strips__fold" type="button" :aria-expanded="!folded" :title="$t(folded ? 'player.strips.unfold' : 'player.strips.fold')"
        @click="folded = !folded">
        <i class="fas fa-plug"></i><span class="strips__title" :title="$t('player.wiring.hint')">{{ $t('player.wiring.title') }}</span>
        <i class="fas strips__chev" :class="folded ? 'fa-chevron-left' : 'fa-chevron-right'"></i>
      </button>
      <span v-if="inSync && !simple" class="strips__sync" :title="$t('player.wiring.inSyncHint')" :aria-label="$t('player.wiring.inSync')"><i
          class="fas fa-circle-check"></i></span>
    </header>

    <div class="strips__row">
      <div v-for="s in rows" :key="s.output" class="strip" :class="{ 'is-idle': !s.inSong }" :style="{ '--c': s.color }" :title="s.title">
        <drop-menu v-if="midiStore.coilList.length && !simple" trigger-class="strip__head" menu-class="strip__menu"
          :label="`${capLabel(s.output)} · ${s.name}`">
          <template #trigger>
            <span class="fiber-cap fiber-cap--lg"><span class="fiber-cap__n">{{ s.output }}</span></span>
            <span class="strip__name"><span class="strip__name-text">{{ s.name }}</span><i class="fas fa-chevron-down strip__chev"></i></span>
          </template>
          <span class="dropdown__header" :style="{ '--c': s.color }"><span class="fiber-cap"><span class="fiber-cap__n">{{ s.output }}</span></span>{{ capLabel(s.output) }}</span>
          <button v-for="c in midiStore.coilList" :key="c.uuid" class="dropdown__item" :class="{ 'is-active': s.coil?.uuid === c.uuid }"
            type="button" @click="put(s.output, c)">
            <i class="fas" :class="ICONS.coil"></i><span>{{ c.name }}</span>
            <small v-if="midiStore.outputOf(c.uuid) >= 0 && midiStore.outputOf(c.uuid) !== s.output" class="stage-out__elsewhere"
              :style="{ '--c': coilColor(midiStore.outputOf(c.uuid)) }">
              <span class="fiber-cap fiber-cap--sm" aria-hidden="true"></span>{{ $t('player.wiring.onOutput', { n: midiStore.outputOf(c.uuid) }) }}</small>
            <small v-else-if="midiStore.outputOf(c.uuid) < 0" class="stage-out__elsewhere">{{ $t('player.wiring.unplugged') }}</small>
          </button>
          <button class="dropdown__item" type="button" @click="put(s.output, null)">
            <i class="fas fa-plug-circle-xmark"></i><span>{{ $t('player.wiring.unplug') }}</span>
          </button>
        </drop-menu>
        <span v-else class="strip__head">
          <span class="fiber-cap fiber-cap--lg"><span class="fiber-cap__n">{{ s.output }}</span></span>
          <span class="strip__name">{{ s.name }}</span>
        </span>

        <span class="strip__val" :class="{ 'is-boost': s.power > 100 }" :title="s.receivedTitle">{{ s.power }} %<span
            v-if="s.received !== s.power && !simple" class="strip__received" :class="{ 'is-boost': s.received > 100 }">→ {{ s.received }} %</span></span>
        <div class="strip__body">
          <v-fader :model-value="s.power" :class="{ 'vfader--plain': simple }" :scale="simple ? 100 : 200" :level="simple ? null : s.received" :level-title="s.receivedTitle" :max="max" :notch="simple ? null : s.notch"
            :notch-title="s.notchTitle" :label="`${$t('label.power')} · ${s.name}`"
            @update:model-value="emit('power-input', s.powerKey, $event)" @change="emit('power-change')" />
          <!-- a beginner's: how busy the coil is, no unit, no limit -->
          <span v-if="simple" class="strip__meters is-simple">
            <span class="vmeter" :title="$t('player.strips.activityHint')">
              <span class="vmeter__fill" :style="{ height: (s.duty?.fill ?? 0) + '%' }"></span>
            </span>
          </span>
          <span v-else class="strip__meters">
            <span class="vmeter" :class="{ 'is-unknown': !s.duty }" :title="s.dutyTip">
              <template v-if="s.duty">
                <span class="vmeter__fill" :style="{ height: s.duty.fill + '%' }"></span>
                <span class="vmeter__over" :style="{ bottom: s.duty.fill + '%', height: s.duty.over + '%' }"></span>
                <span class="vmeter__max"></span>
              </template>
            </span>
            <span class="vmeter" :class="{ 'is-unknown': !s.ontime }" :title="s.ontimeTip">
              <template v-if="s.ontime">
                <span class="vmeter__fill" :style="{ height: s.ontime.fill + '%' }"></span>
                <span class="vmeter__over" :style="{ bottom: s.ontime.fill + '%', height: s.ontime.over + '%' }"></span>
                <span class="vmeter__max"></span>
              </template>
            </span>
            <small>%</small><small>µs</small>
          </span>
        </div>
        <span class="strip__foot">
          <span v-if="s.reduction && !simple" class="strip__red" :title="$t('ontime.rack.reductionHint')">{{ s.reduction }}</span>
          <i v-if="s.warn" class="fas fa-triangle-exclamation strip__warn" :title="s.warn"></i>
          <span v-if="!simple && (s.live?.skippedSoFar || s.live?.skippedNow)" class="strip__skip" :title="$t('ontime.rack.skippedHint')"><span class="strip__led"
              :class="{ 'is-on': s.live?.skippedNow }"></span><b>{{ s.live?.skippedSoFar ?? 0 }}</b></span>
        </span>
      </div>

      <!-- a coil of the song on no output: it doesn't play -->
      <div v-for="m in simple ? [] : offStage" :key="`off${m.place}`" class="strip strip--ghost" :title="$t('player.wiring.none')">
        <span class="strip__head"><i class="fas fa-plug-circle-exclamation"></i><span class="strip__name">{{ ghostName(m) }}</span></span>
        <button v-if="m.coil && firstFree >= 0" class="btn btn--ghost strip__plug" type="button" @click="put(firstFree, m.coil)">
          {{ $t('player.strips.plug', { n: firstFree }) }}
        </button>
      </div>

      <!-- the next free output -->
      <drop-menu v-if="firstFree >= 0 && unplugged.length && !offStage.length && !simple" trigger-class="strip strip--add"
        menu-class="strip__menu" :label="$t('player.wiring.add', { n: firstFree })" :style="{ '--c': coilColor(firstFree) }">
        <template #trigger><i class="fas fa-plus"></i><span class="strip__free">{{ $t('player.wiring.output', { n: firstFree }) }}</span></template>
        <span class="dropdown__header" :style="{ '--c': coilColor(firstFree) }"><span class="fiber-cap"><span class="fiber-cap__n">{{ firstFree }}</span></span>{{ capLabel(firstFree) }}</span>
        <button v-for="c in unplugged" :key="c.uuid" class="dropdown__item" type="button" @click="put(firstFree, c)">
          <i class="fas" :class="ICONS.coil"></i><span>{{ c.name }}</span>
        </button>
      </drop-menu>

      <!-- the general Power, multiplying them all -->
      <slot name="master" />
    </div>

    <!-- how to read a strip -->
    <p v-if="!folded && !simple" class="strips__key">
      <span :title="$t('player.strips.keyPowerHint')"><span class="strips__sw strips__sw--fader" aria-hidden="true"></span>{{
        $t('player.strips.keyPower') }}</span>
      <span v-if="hasLimits" :title="$t('player.strips.keyMetersHint')"><span class="strips__sw strips__sw--meter" aria-hidden="true"></span>{{
        $t('player.strips.keyMeters') }}</span>
      <span v-if="hasLimits" :title="$t('ontime.rack.dutyHint')"><span class="strips__sw strips__sw--max" aria-hidden="true"></span>{{
        $t('player.strips.keyMax') }}</span>
      <span v-if="seenCut" :title="$t('ontime.rack.ontimeHint')"><span class="strips__sw strips__sw--cut" aria-hidden="true"></span>{{
        $t('player.strips.keyCut') }}</span>
    </p>
  </section>
</template>
