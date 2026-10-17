<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CalibResult } from '@/calib/engine';
import { CLEAN_POWER } from '@/calib/engine';
import { ROLES, type ChannelProfile, type ChannelRole } from '@/calib/roles';
import {
  CLEAN_PRESETS, LOUD_PRESETS, presetPads, type CoilProposal, type Intention, type PadPos, type Preset,
} from '@/calib/assistant';
import { coilColor } from '@/ui/coil-colors';
import { pctLabel } from '@/utils/format';
import CoilPad from '@/components/atelier/CoilPad.vue';
import DropMenu from '@/components/ui/DropMenu.vue';

/** One side of the comparison: the share of note time stuck at the max ontime, notes shrunk, loudness (dB). */
export interface AssistSummary { capped: number; reduced: number | null; level: number }

const props = defineProps<{
  result: CalibResult | null;
  busy: boolean;
  intention: Intention;
  preset: Preset;
  pads: PadPos[];
  priority: boolean;
  /** The routing is the user's (Routage): the Assistant keeps it. */
  routingKept: boolean;
  coils: CoilProposal[];
  profiles: ChannelProfile[];
  /** The role given to each coil for this song (null: the Assistant's choice). */
  coilRoles: (ChannelRole | null)[];
  coilNames: string[];
  /** The saved setting's, and the one now in the editor. */
  before: AssistSummary | null;
  now: AssistSummary | null;
}>();
const emit = defineEmits<{
  (e: 'intention', v: Intention): void;
  (e: 'preset', v: Preset): void;
  (e: 'pad', k: number, pos: PadPos): void;
  (e: 'priority', v: boolean): void;
  (e: 'reroute'): void;
  (e: 'coilRole', k: number, role: ChannelRole | null): void;
}>();
const { t } = useI18n();

const loud = computed(() => props.intention === 'loud');
const plan = computed(() => props.result?.[props.intention] ?? null);
const pct = (f: number): number => Math.round(f * 100);
const dec = (v: number, digits = 1): string => v.toFixed(digits).replace('.', t('atelier.decimal'));

// the clean presets' shapes: the ontime along the register, low to high
const SHAPES: Record<string, number[]> = { balanced: [5, 5, 5, 5], strong: [2, 2, 2, 2], safe: [9, 9, 9, 9], bass: [2, 4, 6, 8], bright: [8, 6, 5, 4] };
const shapePath = (key: string): string => SHAPES[key].map((v, i) => `${i ? 'L' : 'M'}${1 + i * 12} ${v + 2}`).join(' ');

/** A loud tile says what it gives on this song: its pulse, how often the board holds it back. */
function loudSub(key: Preset): string {
  const r = props.result;
  if (!r) return '';
  const pads = presetPads(r, 'loud', key);
  const cells = r.loud.pads.map((pad, k) => pad?.[pads[k].y]?.[pads[k].x]).filter(Boolean);
  if (!cells.length) return '';
  const busy = cells.reduce((s, c) => s + c!.busy, 0) / cells.length;
  return `${cells[0]!.o} µs · ${busy < 0.01 ? t('atelier.assist.neverHeld') : t('atelier.assist.heldPct', { pct: pct(busy) })}`;
}

const tiles = computed(() => (loud.value
  ? LOUD_PRESETS.map((p) => ({ key: p.key as Preset, sub: loudSub(p.key) }))
  : CLEAN_PRESETS.map((p) => ({ key: p.key as Preset, sub: t(`atelier.assist.cleanSub.${p.key}`) }))));

const roleOf = (k: number): ChannelRole | null => props.coilRoles[k] ?? null;
// a role no channel of the song has: the coil is left to the Assistant
const missing = (k: number): boolean => {
  const role = roleOf(k);
  return !!role && !props.profiles.some((c) => c.role === role);
};

/** The channels a coil plays, each with its role: two of the same role stay two channels. */
const playsOf = (mask: number): ChannelProfile[] => props.profiles.filter((c) => mask & (1 << c.ch));

function yLabels(k: number): [string, string] {
  const pad = plan.value?.pads[k];
  if (!pad) return ['', ''];
  if (!loud.value) return [`${pct(CLEAN_POWER[0])} %`, `${pct(CLEAN_POWER[CLEAN_POWER.length - 1])} %`];
  return [`${pad[0][0].o} µs`, `${pad[pad.length - 1][0].o} µs`];
}

/**
 * A coil's notes as a gauge: clean, the share stuck at the max ontime, the share
 * shrunk by the max duty, the rest free; loud, the share at the max ontime (the
 * goal) and how often the board holds the duty back.
 */
function gauge(c: CoilProposal): { segs: { cls: string; w: number }[]; text: string; warn: boolean; held: string | null } {
  const cell = c.cell!;
  if (loud.value) {
    return {
      segs: [{ cls: 'is-max', w: cell.capped }],
      text: t('atelier.assist.gaugeAtMax', { pct: pct(cell.capped) }),
      warn: false,
      held: cell.busy > 0.01 ? t('atelier.assist.heldPct', { pct: pct(cell.busy) }) : null,
    };
  }
  const capped = cell.capped, reduced = Math.min(cell.busy, 1 - capped);
  const text = capped > 0.02 ? t('atelier.assist.gaugeCapped', { pct: pct(capped) })
    : reduced > 0.001 ? t('atelier.assist.gaugeReduced', { pct: Math.max(1, pct(reduced)) })
      : t('atelier.assist.untouched');
  return {
    segs: [{ cls: 'is-capped', w: capped }, { cls: 'is-reduced', w: reduced }, { cls: 'is-free', w: Math.max(0, 1 - capped - reduced) }],
    text,
    warn: capped > 0.02 || reduced > 0.001,
    held: null,
  };
}

/** The comparison as three figures: lower is better for the first two. */
const stats = computed(() => {
  const now = props.now, before = props.before;
  if (!now) return [];
  const trend = (a: number | null | undefined, b: number): string => (a == null || Math.abs(a - b) < 1e-9 ? '' : b < a ? 'is-better' : 'is-worse');
  const out = [{
    key: 'capped', value: `${pct(now.capped)} %`, was: before ? `${pct(before.capped)} %` : null,
    trend: trend(before?.capped, now.capped), icon: 'fa-arrows-up-to-line',
  }];
  if (now.reduced != null) {
    out.push({ key: 'reduced', value: String(now.reduced), was: before?.reduced != null ? String(before.reduced) : null,
      trend: trend(before?.reduced, now.reduced), icon: 'fa-compress' });
  }
  if (before) {
    const d = now.level - before.level;
    out.push({ key: 'level', value: `${d >= 0 ? '+' : '−'}${dec(Math.abs(d))} dB`,
      was: t(Math.abs(d) < 0.5 ? 'atelier.assist.same' : d > 0 ? 'atelier.assist.louder' : 'atelier.assist.softer'),
      trend: '', icon: 'fa-volume-high' });
  }
  return out;
});
</script>

<template>
  <div class="assist">
    <div class="assist__intents" role="radiogroup" :aria-label="$t('atelier.assist.intention')">
      <button type="button" class="assist__intent" :class="{ 'is-on': !loud }" role="radio" :aria-checked="!loud"
        @click="emit('intention', 'clean')">
        <i class="fas fa-music"></i>
        <span><b>{{ $t('atelier.assist.clean') }}</b><small>{{ $t('atelier.assist.cleanText') }}</small></span>
      </button>
      <button type="button" class="assist__intent is-loud" :class="{ 'is-on': loud }" role="radio" :aria-checked="loud"
        @click="emit('intention', 'loud')">
        <i class="fas fa-bolt"></i>
        <span><b>{{ $t('atelier.assist.loud') }}</b><small>{{ $t('atelier.assist.loudText') }}</small></span>
      </button>
    </div>

    <div v-if="!result" class="assist__wait">
      <span class="arc-loader" aria-hidden="true"></span>{{ $t('atelier.assist.listening') }}
    </div>

    <template v-else>
      <!-- the presets, and the one the pads stand on once moved by hand -->
      <div class="assist__tiles" :class="{ 'is-loud': loud }" :style="{ '--n': tiles.length + 1 }">
        <button v-for="tile in tiles" :key="tile.key" type="button" class="assist__tile" :class="{ 'is-on': preset === tile.key }"
          :aria-pressed="preset === tile.key" @click="emit('preset', tile.key)">
          <i v-if="loud" class="fas fa-bolt"></i>
          <svg v-else viewBox="0 0 38 16" aria-hidden="true"><path :d="shapePath(tile.key)"></path></svg>
          <span><b>{{ $t(`atelier.assist.presets.${tile.key}`) }}</b><small>{{ tile.sub }}</small></span>
        </button>
        <span class="assist__tile is-custom" :class="{ 'is-on': preset === 'custom' }" :title="$t('atelier.assist.customHint')">
          <i class="fas fa-hand-pointer"></i>
          <span><b>{{ $t('atelier.assist.presets.custom') }}</b><small>{{ $t('atelier.assist.customSub') }}</small></span>
        </span>
      </div>

      <div class="assist__bar">
        <label v-if="!loud" class="switch assist__switch" :title="$t('atelier.assist.priorityHint')">
          <input type="checkbox" :checked="priority" @change="emit('priority', ($event.target as HTMLInputElement).checked)">
          <span class="switch__track"></span>
          <span class="switch__text">{{ $t('atelier.assist.priority') }}</span>
        </label>
        <span v-if="routingKept" class="assist__note" :title="$t('atelier.assist.routingKeptHint')">
          <i class="fas fa-shuffle"></i>{{ $t('atelier.assist.routingKept') }}
          <button type="button" class="assist__link" @click="emit('reroute')">{{ $t('atelier.assist.reroute') }}</button>
        </span>
        <span v-if="busy" class="assist__note"><span class="arc-loader" aria-hidden="true"></span>{{ $t('atelier.assist.computing') }}</span>
      </div>

      <!-- what this setting does to the song, against the saved one when there is one -->
      <section v-if="stats.length" class="assist__compare">
        <span class="assist__compare-title">{{ before ? $t('atelier.assist.compareSaved') : $t('atelier.assist.compareNow') }}</span>
        <div class="assist__stats">
          <div v-for="s in stats" :key="s.key" class="assist__stat" :class="s.trend" :title="$t(`atelier.assist.stat.${s.key}Hint`)">
            <i class="fas" :class="s.icon"></i>
            <span class="assist__stat-key">{{ $t(`atelier.assist.stat.${s.key}`) }}</span>
            <b class="assist__stat-value">{{ s.value }}</b>
            <span v-if="s.was" class="assist__stat-was">{{ s.key === 'level' ? s.was : $t('atelier.assist.was', { v: s.was }) }}</span>
          </div>
        </div>
      </section>

      <div class="assist__pads">
        <div v-for="c in coils" :key="c.coilIndex" class="assist__coil" :style="{ '--c': coilColor(c.coilIndex) }">
          <div class="assist__coil-head">
            <b :title="coilNames[c.coilIndex] ? `${$t('label.coil')} ${c.coilIndex}` : undefined">{{ coilNames[c.coilIndex] || `${$t('label.coil')} ${c.coilIndex}` }}</b>
            <!-- what the user asks of the coil; below, what it plays -->
            <drop-menu trigger-class="assist__role" :class="{ 'is-set': roleOf(c.coilIndex) }" :label="$t('atelier.assist.coilRoleHint')" float>
              <template #trigger>
                <span class="assist__role-key">{{ $t('atelier.assist.roleLabel') }}</span>
                <span :title="$t('atelier.assist.coilRoleHint')">{{
                  roleOf(c.coilIndex) ? $t(`atelier.roles.${roleOf(c.coilIndex)}`) : $t('atelier.assist.coilRoleAuto') }}</span>
                <i class="fas fa-chevron-down"></i>
              </template>
              <button class="dropdown__item" :class="{ 'is-active': !roleOf(c.coilIndex) }" type="button"
                @click="emit('coilRole', c.coilIndex, null)">{{ $t('atelier.assist.coilRoleAutoLong') }}</button>
              <div class="dropdown__divider"></div>
              <button v-for="role in ROLES" :key="role" class="dropdown__item" :class="{ 'is-active': roleOf(c.coilIndex) === role }"
                type="button" @click="emit('coilRole', c.coilIndex, role)">{{ $t(`atelier.roles.${role}`) }}</button>
            </drop-menu>
          </div>
          <div class="assist__plays">
            <span class="assist__plays-key">{{ $t('atelier.assist.plays') }}</span>
            <span v-for="p in playsOf(c.channelMask)" :key="p.ch" class="assist__ch">{{ $t('label.channel') }} {{ p.ch }} · <b>{{
              $t(`atelier.roles.${p.role}`) }}</b></span>
            <span v-if="!playsOf(c.channelMask).length" class="assist__ch">—</span>
          </div>
          <p v-if="missing(c.coilIndex)" class="assist__missing">
            <i class="fas fa-circle-info"></i>{{ $t('atelier.assist.noRoleChannel', { role: $t(`atelier.roles.${roleOf(c.coilIndex)}`) }) }}
          </p>
          <template v-if="c.cell && plan?.pads[c.coilIndex]">
            <coil-pad :cells="plan.pads[c.coilIndex]!" :intention="intention" :color="coilColor(c.coilIndex)"
              :y-labels="yLabels(c.coilIndex)" :label="loud ? $t('atelier.assist.yLoud') : $t('atelier.assist.yClean')"
              :pos="pads[c.coilIndex]" @update:pos="emit('pad', c.coilIndex, $event)" />
            <div class="assist__x">
              <span>{{ loud ? $t('atelier.assist.xLoudLow') : $t('atelier.assist.xCleanLow') }}</span>
              <span>{{ loud ? $t('atelier.assist.xLoudHigh') : $t('atelier.assist.xCleanHigh') }}</span>
            </div>

            <!-- the numbers the song stores, as the coil cards show them -->
            <div class="assist__nums">
              <span><small>{{ $t('atelier.assist.numOntime') }}</small><b>{{ c.ontimeUs }} µs</b></span>
              <span><small>{{ $t('atelier.assist.numDuty') }}</small><b>{{ pctLabel(c.duty) }} %</b></span>
              <span v-if="!loud" :title="$t('atelier.assist.crossoverHint')"><small>{{ $t('atelier.assist.numCrossover') }}</small><b>{{ c.crossover }}</b></span>
            </div>
            <div class="assist__gauge" :class="{ 'is-warn': gauge(c).warn }" :title="loud ? $t('atelier.assist.gaugeHintLoud') : $t('atelier.assist.gaugeHint')">
              <span class="assist__gauge-bar">
                <i v-for="(s, i) in gauge(c).segs" :key="i" :class="s.cls" :style="{ width: s.w * 100 + '%' }"></i>
              </span>
              <span class="assist__gauge-text">{{ gauge(c).text }}</span>
              <span v-if="gauge(c).held" class="assist__gauge-held">{{ gauge(c).held }}</span>
            </div>
            <p v-if="c.dropDb > 0.05" class="assist__drop" :title="$t('atelier.assist.priorityHint')">
              <i class="fas fa-arrow-down"></i>{{ $t('atelier.assist.dropForMelody', { db: dec(c.dropDb) }) }}
            </p>
          </template>
          <p v-else class="assist__empty">{{ $t('atelier.assist.noChannel') }}</p>
        </div>
      </div>

      <div class="assist__key" :title="$t('atelier.assist.keyDotHint')">
        <template v-if="loud">
          <span><i class="assist__sw is-plasma"></i>{{ $t('atelier.assist.keyNeverHeld') }}</span>
          <span><i class="assist__sw is-amber"></i>{{ $t('atelier.assist.keyHeld') }}</span>
        </template>
        <template v-else>
          <span><i class="assist__sw is-ok"></i>{{ $t('atelier.assist.keyFree') }}</span>
          <span><i class="assist__sw is-amber"></i>{{ $t('atelier.assist.keyReduced') }}</span>
          <span><i class="assist__sw is-danger"></i>{{ $t('atelier.assist.keyCapped') }}</span>
        </template>
        <span><i class="fas fa-hand-pointer"></i>{{ $t('atelier.assist.keyDot') }}</span>
      </div>
    </template>
  </div>
</template>
