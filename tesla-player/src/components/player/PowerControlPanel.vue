<script setup lang="ts">
import type { CoilParam } from '@/types/domain';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';

/**
 * Live-power controls: a GLOBAL ⇄ ADVANCED toggle. Global = one "Power" fader
 * scaling ontime+duty for all coils; Advanced = per-coil ontime/duty sliders.
 *
 * Presentational — the parent (MidiPlayer) owns the values and the SysEx side
 * effects. We surface intent: `set-scope` (parent inherits/re-asserts power),
 * `power-change`/`coil-change` fire on slider RELEASE (so the parent sends
 * ≤2·coils SysEx frames, no per-frame flooding), `coil-input` streams the live
 * drag value back so the parent's reactive store (and our readout) follow.
 */
type PowerScope = 'global' | 'advanced';
interface CoilRow {
  coilIndex: number;
  color: string;
  ontime: number;
  duty: number;
}
const masterPower = defineModel<number>('masterPower', { required: true });
defineProps<{
  scope: PowerScope;
  coilRows: CoilRow[];
  boost: boolean; // global readout past nominal (>100%)
  dirty: boolean; // anything off unity → enable reset
  hasSong: boolean;
}>();
const emit = defineEmits<{
  (e: 'set-scope', scope: PowerScope): void;
  (e: 'power-change'): void;
  (e: 'coil-input', coilIndex: number, param: CoilParam, value: number): void;
  (e: 'coil-change'): void;
  (e: 'reset'): void;
}>();
function inputValue(e: Event): number {
  return Number((e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="player-power">
    <div class="power-head">
      <span class="power-head__key"><span class="icon"><i class="fas fa-gauge-high"></i></span>{{ $t('label.power') }}</span>
      <segmented-control class="power-scope" :model-value="scope" @update:model-value="emit('set-scope', $event)"
        :options="[
          { value: 'global', label: $t('label.scopeGlobal') },
          { value: 'advanced', label: $t('label.scopeAdvanced') },
        ]" />
      <span v-if="scope === 'global'" class="power-head__val" :class="{ 'is-boost': boost }">{{ masterPower }}%</span>
      <button class="power-head__reset" type="button" :disabled="!hasSong || !dirty" @click="emit('reset')"
        :title="$t('label.resetPower')"><i class="fas fa-rotate-left"></i></button>
    </div>

    <!-- GLOBAL: one hero power fader (tri-zone track) -->
    <template v-if="scope === 'global'">
      <input class="power-range" type="range" min="0" max="200" step="1" v-model.number="masterPower"
        :disabled="!hasSong" :title="$t('label.powerHint')" @change="emit('power-change')">
      <div class="power-zones">
        <span>{{ $t('label.zoneSoft') }}</span>
        <span class="power-zones__mid">{{ $t('label.zoneNominal') }} · 100%</span>
        <span class="power-zones__over">{{ $t('label.zoneOver') }}</span>
      </div>
    </template>

    <!-- ADVANCED: per-coil ontime + duty -->
    <div v-else-if="hasSong" class="power-coils">
      <div v-for="c in coilRows" :key="c.coilIndex" class="coil-bias" :style="{ '--c': c.color }">
        <span class="coil-bias__chip">{{ c.coilIndex }}</span>
        <label class="coil-bias__item">
          <span class="coil-bias__key">{{ $t('label.ontime') }}</span>
          <input class="bias__range" type="range" min="0" max="200" step="1" :value="c.ontime"
            @input="emit('coil-input', c.coilIndex, 'ontime', inputValue($event))" @change="emit('coil-change')">
          <span class="coil-bias__val">{{ c.ontime }}%</span>
        </label>
        <label class="coil-bias__item">
          <span class="coil-bias__key">{{ $t('label.duty') }}</span>
          <input class="bias__range" type="range" min="0" max="200" step="1" :value="c.duty"
            @input="emit('coil-input', c.coilIndex, 'duty', inputValue($event))" @change="emit('coil-change')">
          <span class="coil-bias__val">{{ c.duty }}%</span>
        </label>
      </div>
    </div>
  </div>
</template>
