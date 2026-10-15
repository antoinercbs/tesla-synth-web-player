<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CoilLimits } from '@/devices/coil-limits';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import { ICONS } from '@/ui/icons';
import { pctLabel } from '@/utils/format';

/**
 * Live power, and what each coil does with it: a GLOBAL ⇄ ADVANCED toggle.
 * Global = one "Power" fader for every coil; Advanced = one fader per coil, on
 * its row. Each coil's row tells what the board was sent and what it fires right
 * now: its real duty and ontime against its limits, the reduction the max duty
 * forces, the notes it silences for lack of a voice. Every piece keeps its place
 * and size, so nothing moves while the song plays.
 *
 * Presentational — the parent (MidiPlayer) owns the values and the SysEx side
 * effects. We surface intent: `set-scope` (parent inherits/re-asserts power),
 * the model and `coil-input` stream the drag (the parent throttles what it
 * sends), `power-change`/`coil-change` fire on release, `toggle-cap` flips the
 * ≤ 100 % lock.
 */
type PowerScope = 'global' | 'advanced';
interface CoilRow {
  coilIndex: number;
  color: string;
  name: string;
  /** Advanced: this coil's own power, percent. */
  power: number;
  /** What the board was sent for it at this moment. */
  sent: { ontimeUs: number; duty: number };
  limits: CoilLimits | null;
  /** The power past which its bass is at its max ontime (%), null: never under 200 %. */
  notch: number | null;
  /** What it fires at the playhead; null without a song to read. */
  live: {
    dutyAsked: number; duty: number; factor: number; pulseUs: number; askedUs: number;
    skippedNow: boolean; skippedSoFar: number;
  } | null;
}
const masterPower = defineModel<number>('masterPower', { required: true });
const props = defineProps<{
  scope: PowerScope;
  coilRows: CoilRow[];
  boost: boolean; // global readout past nominal (>100%)
  dirty: boolean; // anything off unity → enable reset
  hasSong: boolean;
  capped: boolean;
  max: number;
}>();
const emit = defineEmits<{
  (e: 'set-scope', scope: PowerScope): void;
  (e: 'power-change'): void;
  (e: 'coil-input', coilIndex: number, value: number): void;
  (e: 'coil-change'): void;
  (e: 'reset'): void;
  (e: 'toggle-cap'): void;
}>();
const { t } = useI18n();
// The tracks keep their 0–200 scale (their zones) under the lock: the value is held
// at the cap, and written back to the input, which Vue won't do while the model
// stays at the same capped value.
function cappedValue(e: Event): number {
  const input = e.target as HTMLInputElement;
  const v = Math.min(Number(input.value), props.max);
  if (Number(input.value) !== v) input.value = String(v);
  return v;
}

/** Where a value of a 0–200 range falls, the thumb's own width taken into account. */
const onTrack = (pct: number, thumbPx: number): string => `calc(${pct / 2}% + ${(0.5 - pct / 200) * thumbPx}px)`;
// the global fader's marks: two coils close together share one tag
const notches = computed(() => {
  const list = props.coilRows.filter((r) => r.notch != null).sort((a, b) => a.notch! - b.notch!);
  const out: { left: string; color: string; tag: string | null; title: string; ahead: boolean }[] = [];
  let tagged: { tag: string | null; title: string } | null = null;
  let lastAt = -99;
  for (const r of list) {
    const title = t('ontime.rack.notchTitle', { name: r.name || `${t('label.coil')} ${r.coilIndex}`, pct: r.notch, max: r.limits?.ontimeUs ?? '–' });
    const mark = { left: onTrack(r.notch!, 16), color: r.color, tag: null as string | null, title, ahead: masterPower.value <= r.notch! };
    if (tagged && r.notch! - lastAt < 7) {
      tagged.tag += ` ${r.coilIndex}`;
      tagged.title += ` / ${title}`;
    } else {
      mark.tag = String(r.coilIndex);
      tagged = mark;
      lastAt = r.notch!;
    }
    out.push(mark);
  }
  return out;
});
const anyNotch = computed(() => props.coilRows.some((r) => r.notch != null));

// the rows' gauges run to 1.5 × the coil's limit: the limit's mark sits at two thirds
function gauge(v: number, asked: number, limit: number | undefined): { fill: number; over: number } | null {
  if (limit == null || !(limit > 0)) return null;
  return {
    fill: (Math.min(v / limit, 1) / 1.5) * 100,
    over: (Math.max(0, Math.min(asked / limit, 1.5) - 1) / 1.5) * 100,
  };
}
const rows = computed(() => props.coilRows.map((r) => {
  const lim = r.limits;
  const live = r.live;
  const duty = live ? gauge(live.duty, live.dutyAsked, lim?.duty) : null;
  const ontime = live ? gauge(live.pulseUs, live.askedUs > (lim?.ontimeUs ?? Infinity) ? live.askedUs : 0, lim?.ontimeUs) : null;
  const minNote = lim?.minOntimeUs ? ` ${t('ontime.rack.minIncluded', { min: lim.minOntimeUs })}` : '';
  return {
    ...r,
    dutyOver: lim?.duty != null && r.sent.duty > lim.duty,
    ontimeOver: lim?.ontimeUs != null && r.sent.ontimeUs > lim.ontimeUs,
    duty,
    ontime,
    dutyText: live ? pctLabel(live.duty) : '–',
    ontimeText: live ? String(Math.round(live.pulseUs)) : '–',
    dutyTip: !live ? '' : live.dutyAsked > live.duty + 1e-4
      ? t('ontime.rack.dutyTipCut', { duty: pctLabel(live.duty), asked: pctLabel(live.dutyAsked) })
      : t('ontime.rack.dutyTip', { duty: pctLabel(live.duty), max: lim?.duty != null ? pctLabel(lim.duty) : '–' }),
    ontimeTip: !live ? '' : (lim?.ontimeUs != null && live.askedUs > lim.ontimeUs
      ? t('ontime.rack.ontimeTipCut', { us: Math.round(live.pulseUs), asked: Math.round(live.askedUs) })
      : t('ontime.rack.ontimeTip', { us: Math.round(live.pulseUs), max: lim?.ontimeUs ?? '–' })) + minNote,
    reduction: live && live.factor < 0.995 ? `−${Math.round((1 - live.factor) * 100)} %` : '',
  };
}));
</script>

<template>
  <div class="player-power" :class="{ 'is-capped': capped }">
    <div class="power-head">
      <span class="power-head__key" :title="$t('label.power')"><span class="icon"><i class="fas" :class="ICONS.power"></i></span>
        <span class="power-head__key-text">{{ $t('label.power') }}</span></span>
      <segmented-control class="power-scope" :model-value="scope" @update:model-value="emit('set-scope', $event)"
        :options="[
          { value: 'global', label: $t('label.scopeGlobal') },
          { value: 'advanced', label: $t('label.scopeAdvanced') },
        ]" />
      <span v-if="scope === 'global'" class="power-head__val" :class="{ 'is-boost': boost }">{{ masterPower }}%</span>
      <span v-else class="power-head__each">{{ $t('ontime.rack.perCoil') }}</span>
      <button class="power-head__cap" :class="{ 'is-on': capped }" type="button" :aria-pressed="capped"
        :title="capped ? $t('player.uncapPower') : $t('player.capPower')" @click="emit('toggle-cap')">
        <i class="fas" :class="capped ? 'fa-lock' : 'fa-lock-open'"></i>
      </button>
      <button class="power-head__reset" type="button" :disabled="!hasSong || !dirty" @click="emit('reset')"
        :title="$t('label.resetPower')"><i class="fas fa-rotate-left"></i></button>
    </div>

    <!-- GLOBAL: one hero power fader (tri-zone track), the marks past which a coil's bass stops following -->
    <template v-if="scope === 'global'">
      <div class="power-track">
        <input class="power-range" type="range" min="0" max="200" step="1" :value="masterPower"
          :disabled="!hasSong" :title="$t('label.powerHint')" @input="masterPower = cappedValue($event)"
          @change="emit('power-change')">
        <span v-for="(n, i) in notches" :key="i" class="power-notch" :class="{ 'is-ahead': n.ahead }"
          :style="{ left: n.left, '--c': n.color }">
          <span v-if="n.tag" class="power-notch__tag" :title="n.title">{{ n.tag }}</span>
          <span class="power-notch__line"></span>
        </span>
      </div>
      <div class="power-zones">
        <span>{{ $t('label.zoneSoft') }}</span>
        <span class="power-zones__mid">{{ $t('label.zoneNominal') }} · 100%</span>
        <span class="power-zones__over">{{ $t('label.zoneOver') }}</span>
      </div>
      <p v-if="anyNotch" class="power-notches">
        <span class="power-notches__what" :title="$t('ontime.rack.notchHint')">{{ $t('ontime.rack.notch') }}</span>
        <template v-for="(r, i) in coilRows.filter((x) => x.notch != null)" :key="r.coilIndex">
          <span v-if="i" class="power-notches__sep">·</span>
          <span class="power-notches__coil" :style="{ '--c': r.color }">{{ r.name || r.coilIndex }} <b>{{ r.notch }} %</b></span>
        </template>
      </p>
    </template>

    <!-- each coil: what it was sent, what it fires now -->
    <div v-if="hasSong && rows.length" class="power-rack">
      <p v-if="scope === 'advanced' && anyNotch" class="power-rack__note">{{ $t('ontime.rack.notchEach') }}</p>
      <div class="power-rack__head">
        <span>{{ $t('ontime.rack.coil') }}</span>
        <span :title="$t('ontime.rack.sentHint')">{{ $t('ontime.rack.sent') }}</span>
        <span :title="$t('ontime.rack.dutyHint')">{{ $t('ontime.rack.duty') }}</span>
        <span :title="$t('ontime.rack.ontimeHint')">{{ $t('ontime.rack.ontime') }}</span>
        <span :title="$t('ontime.rack.reductionHint')">{{ $t('ontime.rack.reduction') }}</span>
        <span :title="$t('ontime.rack.skippedHint')">{{ $t('ontime.rack.skipped') }}</span>
      </div>
      <div v-for="r in rows" :key="r.coilIndex" class="power-rack__row" :style="{ '--c': r.color }">
        <span class="power-rack__name"><b>{{ r.coilIndex }}</b>{{ r.name }}</span>
        <span class="power-rack__sent">
          <span>{{ $t('ontime.rack.bass') }} <b>{{ pctLabel(r.sent.duty) }} %</b><span v-if="r.dutyOver" class="power-rack__lim"
              :title="$t('ontime.rack.overLimit', { v: `${pctLabel(r.limits!.duty!)} %` })"><i class="fas fa-lock"></i> {{
                $t('ontime.rack.max', { v: `${pctLabel(r.limits!.duty!)} %` }) }}</span></span>
          <span>{{ $t('ontime.rack.treble') }} <b>{{ Math.round(r.sent.ontimeUs) }} µs</b><span v-if="r.ontimeOver" class="power-rack__lim"
              :title="$t('ontime.rack.overLimit', { v: `${r.limits!.ontimeUs} µs` })"><i class="fas fa-lock"></i> {{
                $t('ontime.rack.max', { v: `${r.limits!.ontimeUs} µs` }) }}</span></span>
        </span>
        <span class="power-gauge power-gauge--duty" :title="r.dutyTip">
          <span class="power-gauge__meter" :class="{ 'is-unknown': !r.duty }">
            <template v-if="r.duty">
              <span class="power-gauge__fill" :style="{ width: r.duty.fill + '%' }"></span>
              <span class="power-gauge__over" :style="{ width: r.duty.over + '%' }"></span>
              <span class="power-gauge__max"></span>
            </template>
          </span>
          <span class="power-gauge__v"><b>{{ r.dutyText }}</b><template v-if="r.limits?.duty != null"> / {{
            pctLabel(r.limits.duty) }}</template> %</span>
        </span>
        <span class="power-gauge power-gauge--ontime" :title="r.ontimeTip">
          <span class="power-gauge__meter" :class="{ 'is-unknown': !r.ontime }">
            <template v-if="r.ontime">
              <span class="power-gauge__fill" :style="{ width: r.ontime.fill + '%' }"></span>
              <span class="power-gauge__over" :style="{ width: r.ontime.over + '%' }"></span>
              <span class="power-gauge__max"></span>
            </template>
          </span>
          <span class="power-gauge__v"><b>{{ r.ontimeText }}</b><template v-if="r.limits?.ontimeUs != null"> / {{
            r.limits.ontimeUs }}</template> µs</span>
        </span>
        <span class="power-rack__red">{{ r.reduction }}</span>
        <span class="power-rack__skip"><span class="power-rack__led" :class="{ 'is-on': r.live?.skippedNow }"></span><b>{{
          r.live?.skippedSoFar ?? 0 }}</b></span>

        <!-- ADVANCED: this coil's own power, on its row -->
        <div v-if="scope === 'advanced'" class="power-rack__pow">
          <span class="power-rack__pow-k">{{ $t('ontime.rack.power') }}</span>
          <span class="power-rack__pow-track">
            <input class="bias__range" type="range" min="0" max="200" step="1" :value="r.power"
              :aria-label="`${$t('ontime.rack.power')} · ${$t('label.coil')} ${r.coilIndex}`"
              @input="emit('coil-input', r.coilIndex, cappedValue($event))" @change="emit('coil-change')">
            <span v-if="r.notch != null" class="power-rack__notch" :class="{ 'is-ahead': r.power <= r.notch }"
              :style="{ left: onTrack(r.notch, 14) }"
              :title="$t('ontime.rack.notchTitle', { name: r.name || r.coilIndex, pct: r.notch, max: r.limits?.ontimeUs ?? '–' })"></span>
          </span>
          <span class="power-rack__pow-v">{{ r.power }} %</span>
        </div>
      </div>
    </div>
  </div>
</template>
