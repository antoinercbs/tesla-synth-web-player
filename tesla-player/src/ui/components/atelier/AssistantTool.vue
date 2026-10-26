<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AssistSummary, CalibResult } from '@/model/calib';
import { CLEAN_POWER } from '@/model/calib';
import { CalRoles, type ChannelProfile, type ChannelRole } from '@/model/calib/roles';
import { CalAssistant, type CoilProposal, type Intention, type PadPos, type PadState, type Preset } from '@/model/calib/assistant';
import { useCoilColor } from '@/ui/helpers/coil-colors';
import { pctLabel } from '@/utils/format';
import CoilPad from '@/ui/components/atelier/CoilPad.vue';
import CoilLevel from '@/ui/components/atelier/CoilLevel.vue';
import DropMenu from '@/ui/components/ui/DropMenu.vue';

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
  /** The saved setting's, and the one now in the editor; none in Débutant. */
  before: AssistSummary | null;
  now: AssistSummary | null;
  /**
   * Débutant (ui/helpers/ui-mode.ts): the intentions and presets in plain words, each
   * coil a level (its pad's vertical axis) and the parts it plays, the stored
   * numbers in the level's title.
   */
  simple?: boolean;
}>();
const emit = defineEmits<{
  (e: 'intention', v: Intention): void;
  (e: 'preset', v: Preset): void;
  (e: 'pad', k: number, pos: PadPos): void;
  (e: 'priority', v: boolean): void;
  (e: 'reroute'): void;
  (e: 'coilRole', k: number, role: ChannelRole | null): void;
}>();
const coilColor = useCoilColor();
const { t } = useI18n();

const loud = computed(() => props.intention === 'loud');
const plan = computed(() => props.result?.[props.intention] ?? null);
// the key names the colours the pads show
const padStates = computed(() => {
  const seen = new Set<PadState>();
  for (const c of props.coils) {
    if (!c.cell) continue;
    for (const row of plan.value?.pads[c.coilIndex] ?? []) for (const cell of row) seen.add(CalAssistant.padState(cell, props.intention));
  }
  return seen;
});
const pct = (f: number): number => Math.round(f * 100);
const dec = (v: number, digits = 1): string => v.toFixed(digits).replace('.', t('atelier.decimal'));

// the presets' shapes along the register, low to high: the clean ones' ontime, the loud ones' arc length
const SHAPES: Record<string, number[]> = {
  balanced: [5, 5, 5, 5], strong: [2, 2, 2, 2], safe: [9, 9, 9, 9], bass: [2, 4, 6, 8], bright: [8, 6, 5, 4],
  loud: [2, 2, 2, 2], loudSoft: [5, 4, 3, 2], loudShort: [6, 5, 5, 4],
};
const shapePath = (key: string): string => SHAPES[key].map((v, i) => `${i ? 'L' : 'M'}${1 + i * 12} ${v + 2}`).join(' ');

/** A loud tile says what it gives on this song: its pulse, how often the board holds it back. */
function loudSub(key: Preset): string {
  const r = props.result;
  if (!r) return '';
  const pads = new CalAssistant(r).presetPads('loud', key);
  const cells = r.loud.pads.map((pad, k) => pad?.[pads[k].y]?.[pads[k].x]).filter(Boolean);
  if (!cells.length) return '';
  const busy = cells.reduce((s, c) => s + c!.busy, 0) / cells.length;
  return `${cells[0]!.o} µs · ${busy < 0.01 ? t('atelier.assist.neverHeld') : t('atelier.assist.heldPct', { pct: pct(busy) })}`;
}

// a beginner reads no µs, and no crossover under the bass and treble presets
const PLAIN_TILES: Preset[] = ['balanced', 'strong', 'safe'];
const tiles = computed(() => (loud.value
  ? CalAssistant.LOUD_PRESETS.map((p) => ({ key: p.key as Preset, sub: props.simple ? '' : loudSub(p.key) }))
  : CalAssistant.CLEAN_PRESETS.map((p) => ({
    key: p.key as Preset,
    sub: !props.simple || PLAIN_TILES.includes(p.key) ? t(`atelier.assist.cleanSub.${p.key}`) : '',
  }))));

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
  if (props.simple) return [t('atelier.assist.endShort'), t('atelier.assist.endLong')];
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
      text: t(props.simple ? 'atelier.assist.gaugeLongest' : 'atelier.assist.gaugeAtMax', { pct: pct(cell.capped) }),
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

// a beginner reads the parts a coil plays, not the channels: each role once
const partsOf = (mask: number): string => [...new Set(playsOf(mask).map((p) => t(`atelier.roles.${p.role}`)))].join(' · ');

interface Stat { key: string; icon: string; value: string; was: string | null; trend: string }
/** The comparison as three figures, read as shown: lower is better for the first two, the saved one's only where it differs. */
const stats = computed<Stat[]>(() => {
  const now = props.now, before = props.before;
  if (!now) return [];
  const share = (key: 'capped' | 'reduced', icon: string, value: (p: number) => string): Stat => {
    const a = pct(now[key]), b = before ? pct(before[key]) : null;
    return {
      key, icon, value: value(a), was: b == null || b === a ? null : `${b} %`,
      trend: b == null || b === a ? '' : a < b ? 'is-better' : 'is-worse',
    };
  };
  const out = [
    share('capped', 'fa-arrows-up-to-line', (p) => `${p} %`),
    share('reduced', 'fa-compress', (p) => t('atelier.assist.stat.reducedTime', { pct: p })),
  ];
  if (before) {
    const d = now.level - before.level;
    out.push({ key: 'level', icon: 'fa-volume-high', value: `${d >= 0 ? '+' : '−'}${dec(Math.abs(d))} dB`, was: null, trend: '' });
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
        <span><b>{{ $t('atelier.assist.clean') }}</b><small>{{ $t(simple ? 'atelier.assist.cleanTextSimple' : 'atelier.assist.cleanText') }}</small></span>
      </button>
      <button type="button" class="assist__intent is-loud" :class="{ 'is-on': loud }" role="radio" :aria-checked="loud"
        @click="emit('intention', 'loud')">
        <i class="fas fa-bolt"></i>
        <span><b>{{ $t('atelier.assist.loud') }}</b><small>{{ $t(simple ? 'atelier.assist.loudTextSimple' : 'atelier.assist.loudText') }}</small></span>
      </button>
    </div>

    <div v-if="!result" class="assist__wait">
      <span class="arc-loader" aria-hidden="true"></span>{{ $t('atelier.assist.computing') }}
    </div>

    <template v-else>
      <!-- the presets, and the one the pads stand on once moved by hand -->
      <div class="assist__tiles" :class="{ 'is-loud': loud }" :style="{ '--n': tiles.length + 1 }">
        <button v-for="tile in tiles" :key="tile.key" type="button" class="assist__tile" :class="{ 'is-on': preset === tile.key }"
          :aria-pressed="preset === tile.key" @click="emit('preset', tile.key)">
          <svg viewBox="0 0 38 16" aria-hidden="true"><path :d="shapePath(tile.key)"></path></svg>
          <span><b>{{ $t(`atelier.assist.presets.${tile.key}`) }}</b><small v-if="tile.sub">{{ tile.sub }}</small></span>
        </button>
        <span class="assist__tile is-custom" :class="{ 'is-on': preset === 'custom' }" :title="$t('atelier.assist.customHint')">
          <i class="fas fa-hand-pointer"></i>
          <span><b>{{ $t('atelier.assist.presets.custom') }}</b><small>{{ $t(simple ? 'atelier.assist.customSubSimple' : 'atelier.assist.customSub') }}</small></span>
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
          <div v-for="s in stats" :key="s.key" class="assist__stat" :class="s.trend"
            :title="$t(`atelier.assist.stat.${s.key}Hint`)">
            <i class="fas" :class="s.icon"></i>
            <span class="assist__stat-key">{{ $t(`atelier.assist.stat.${s.key}`) }}</span>
            <b class="assist__stat-value">{{ s.value }}</b>
            <span v-if="s.was" class="assist__stat-was">{{ $t('atelier.assist.was', { v: s.was }) }}</span>
          </div>
        </div>
      </section>

      <div class="assist__pads">
        <div v-for="c in coils" :key="c.coilIndex" class="assist__coil" :style="{ '--c': coilColor(c.coilIndex) }">
          <div class="assist__coil-head">
            <b>{{ coilNames[c.coilIndex] || `${$t('label.coil')} ${c.coilIndex}` }}</b>
            <!-- what the user asks of the coil; below, what it plays -->
            <drop-menu trigger-class="assist__role" :class="{ 'is-set': roleOf(c.coilIndex) }" :label="$t('atelier.assist.coilRoleHint')">
              <template #trigger>
                <span class="assist__role-key">{{ $t('atelier.assist.roleLabel') }}</span>
                <span :title="$t('atelier.assist.coilRoleHint')">{{
                  roleOf(c.coilIndex) ? $t(`atelier.roles.${roleOf(c.coilIndex)}`) : $t('atelier.assist.coilRoleAuto') }}</span>
                <i class="fas fa-chevron-down"></i>
              </template>
              <button class="dropdown__item" :class="{ 'is-active': !roleOf(c.coilIndex) }" type="button"
                @click="emit('coilRole', c.coilIndex, null)">{{ $t('atelier.assist.coilRoleAutoLong') }}</button>
              <div class="dropdown__divider"></div>
              <button v-for="role in CalRoles.ALL" :key="role" class="dropdown__item" :class="{ 'is-active': roleOf(c.coilIndex) === role }"
                type="button" @click="emit('coilRole', c.coilIndex, role)">{{ $t(`atelier.roles.${role}`) }}</button>
            </drop-menu>
          </div>
          <div v-if="simple" class="assist__plays">
            <span class="assist__plays-key">{{ $t('atelier.assist.plays') }}</span>
            <span class="assist__ch">{{ partsOf(c.channelMask) || '—' }}</span>
          </div>
          <div v-else class="assist__plays">
            <span class="assist__plays-key">{{ $t('atelier.assist.plays') }}</span>
            <span v-for="p in playsOf(c.channelMask)" :key="p.ch" class="assist__ch">{{ $t('label.channel') }} {{ p.ch }} · <b>{{
              $t(`atelier.roles.${p.role}`) }}</b></span>
            <span v-if="!playsOf(c.channelMask).length" class="assist__ch">—</span>
          </div>
          <p v-if="missing(c.coilIndex)" class="assist__missing">
            <i class="fas fa-circle-info"></i>{{ $t('atelier.assist.noRoleChannel', { role: $t(`atelier.roles.${roleOf(c.coilIndex)}`) }) }}
          </p>
          <template v-if="c.cell && plan?.pads[c.coilIndex] && simple">
            <coil-level :cells="plan.pads[c.coilIndex]!" :intention="intention" :color="coilColor(c.coilIndex)"
              :label="loud ? $t('atelier.assist.levelLoud') : $t('atelier.assist.level')" :ends="yLabels(c.coilIndex)"
              :stores="`${$t('atelier.assist.numOntime')} ${c.ontimeUs} µs · ${$t('atelier.assist.numDuty')} ${pctLabel(c.duty)} %`"
              :pos="pads[c.coilIndex]" @update:pos="emit('pad', c.coilIndex, $event)" />
            <p class="assist__gauge-text">{{ gauge(c).text }}</p>
          </template>
          <template v-else-if="c.cell && plan?.pads[c.coilIndex]">
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
          <span v-if="padStates.has('neverHeld')"><i class="assist__sw is-plasma"></i>{{ $t('atelier.assist.keyNeverHeld') }}</span>
          <span v-if="padStates.has('held')"><i class="assist__sw is-amber"></i>{{ $t('atelier.assist.keyHeld') }}</span>
        </template>
        <template v-else>
          <span v-if="padStates.has('free')"><i class="assist__sw is-ok"></i>{{ $t('atelier.assist.keyFree') }}</span>
          <span v-if="padStates.has('reduced')"><i class="assist__sw is-amber"></i>{{ $t('atelier.assist.keyReduced') }}</span>
          <span v-if="padStates.has('capped')"><i class="assist__sw is-danger"></i>{{ $t('atelier.assist.keyCapped') }}</span>
        </template>
        <span v-if="!simple"><i class="fas fa-hand-pointer"></i>{{ $t('atelier.assist.keyDot') }}</span>
      </div>
    </template>
  </div>
</template>
