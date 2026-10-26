<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { coilColor } from '@/ui/helpers/coil-colors';
import { ICONS } from '@/ui/helpers/icons';
import { tour } from '@/ui/tour/tour';
import { BoardCheck, boardCheck, type SettingKey } from '@/app/board-check';

/**
 * The board's outputs aren't set as the sheets of the coils plugged on them
 * (or can't tell): a before / after table of the Syntherrupter, output by
 * output, the after being the coil's sheet, and the offer to update it, for
 * now or saved to its EEPROM. Nothing is written unasked.
 */
const { t, n } = useI18n();

// not during a tour: its demo board is nobody's to set
const shown = computed(() => !tour.active && boardCheck.diffs.length > 0 && BoardCheck.key(boardCheck.diffs) !== boardCheck.dismissed);
const UNIT: Record<SettingKey, string> = { ontimeUs: 'µs', duty: '%', minOntimeUs: 'µs', minOfftimeUs: 'µs', voices: '' };
const fmt = (k: SettingKey, v: number): string => (k === 'duty' ? n(v * 100, { maximumFractionDigits: 1 }) : n(Math.round(v)));
const rows = computed(() => boardCheck.diffs.map((d) => ({
  output: d.output,
  color: coilColor(d.output),
  name: d.coil.name,
  diffs: d.rows.map((r) => ({
    key: r.key,
    label: t(`player.boardSync.key.${r.key}`),
    was: r.board == null ? null : fmt(r.key, r.board),
    to: fmt(r.key, r.sheet),
    unit: UNIT[r.key],
  })),
})));
</script>

<template>
  <div v-if="shown" class="player-alert player-alert--warn player-alert--board" role="status">
    <span class="icon"><i class="fas" :class="ICONS.interrupter"></i></span>
    <span class="player-alert__text">
      <strong>{{ $t('player.boardSync.title') }}</strong>
      <table class="board-sync">
        <thead>
          <tr>
            <th scope="col" rowspan="2">{{ $t('player.boardSync.output') }}</th>
            <th scope="col" rowspan="2">{{ $t('player.boardSync.setting') }}</th>
            <th scope="colgroup" colspan="3" class="board-sync__board"><i class="fas" :class="ICONS.interrupter"></i>Syntherrupter</th>
          </tr>
          <tr>
            <th scope="col" class="board-sync__num">{{ $t('player.boardSync.before') }}</th>
            <th aria-hidden="true"></th>
            <th scope="col" class="board-sync__num" :title="$t('player.boardSync.afterHint')">{{ $t('player.boardSync.after') }}
              <small class="board-sync__from"><i class="fas" :class="ICONS.coil"></i>{{ $t('player.boardSync.fromSheet') }}</small></th>
          </tr>
        </thead>
        <tbody v-for="r in rows" :key="r.output" :style="{ '--c': r.color }">
          <tr v-for="(d, i) in r.diffs" :key="d.key">
            <th v-if="i === 0" scope="rowgroup" :rowspan="r.diffs.length" class="board-sync__out">
              <span class="fiber-cap"><span class="fiber-cap__n">{{ r.output }}</span></span>
              <span class="board-sync__coil">{{ r.name }}</span>
            </th>
            <td class="board-sync__key">{{ d.label }}</td>
            <td class="board-sync__num board-sync__was">
              <template v-if="d.was != null">{{ d.was }}<small>{{ d.unit }}</small></template>
              <span v-else :title="$t('player.boardSync.blind')">?</span>
            </td>
            <td class="board-sync__arrow" aria-hidden="true"><i class="fas fa-arrow-right"></i></td>
            <td class="board-sync__num board-sync__to"><b>{{ d.to }}</b><small>{{ d.unit }}</small></td>
          </tr>
        </tbody>
      </table>
      <span v-if="!boardCheck.readable" class="board-sync__blind">{{ $t('player.boardSync.blind') }}</span>
      <span class="player-alert__acts">
        <button class="btn btn--volt" type="button" :disabled="boardCheck.busy" :title="$t('player.boardSync.applyHint')"
          @click="boardCheck.apply(false)">
          <span class="icon"><i class="fas" :class="boardCheck.busy ? 'fa-spinner fa-spin' : 'fa-check'"></i></span>{{ $t('player.boardSync.apply') }}
        </button>
        <button class="btn btn--ghost" type="button" :disabled="boardCheck.busy" :title="$t('player.boardSync.saveHint')"
          @click="boardCheck.apply(true)">
          <span class="icon"><i class="fas" :class="ICONS.eeprom"></i></span>{{ $t('player.boardSync.save') }}
        </button>
        <button class="btn btn--ghost" type="button" :disabled="boardCheck.busy" @click="boardCheck.dismiss()">
          {{ $t('player.boardSync.ignore') }}
        </button>
      </span>
    </span>
  </div>
</template>
