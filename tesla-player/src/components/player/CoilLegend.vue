<script setup lang="ts">
/**
 * The per-coil legend chips on the player's song line (colour + effective
 * ontime + duty). Purely presentational — the parent computes the effective
 * values (base × power × automation at the playhead) and passes them in.
 */
interface LegendRow {
  coilIndex: number;
  color: string;
  ontime: number;
  duty: number;
}
defineProps<{ rows: LegendRow[] }>();
</script>

<template>
  <div v-if="rows.length" class="player-coils">
    <div v-for="c in rows" :key="c.coilIndex" class="player-coil" :style="{ '--c': c.color }">
      <span class="player-coil__chip">{{ c.coilIndex }}</span>
      <span class="player-coil__readouts">
        <span class="player-coil__readout">{{ c.ontime }}<i>µs</i></span>
        <span class="player-coil__readout">{{ c.duty }}<i>%</i></span>
      </span>
    </div>
  </div>
</template>
