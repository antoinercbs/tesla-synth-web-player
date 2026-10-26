<script setup lang="ts">
import { computed } from 'vue';
import type { LoadLane, LoadMode } from '@/ui/helpers/load-lane';

/**
 * The key under the coils' lanes (the player's Load view, the editor's
 * timeline): what their drawing and marks mean, each only when a lane shows it.
 */
const props = defineProps<{
  mode: LoadMode;
  lanes: readonly Pick<LoadLane, 'capY' | 'over' | 'lost' | 'ocd' | 'strikes' | 'silent'>[];
}>();
const has = computed(() => ({
  limit: props.lanes.some((l) => l.capY != null),
  over: props.lanes.some((l) => l.over),
  lost: props.lanes.some((l) => l.lost),
  ocd: props.mode === 'ontime' && props.lanes.some((l) => l.ocd),
  strikes: props.lanes.some((l) => l.strikes),
  silent: props.lanes.some((l) => l.silent),
}));
</script>

<template>
  <div class="cload__key">
    <span><span class="cload__sw is-area"></span>{{ mode === 'duty' ? $t('ontime.load.keyDuty') : $t('ontime.load.keyPulse') }}</span>
    <span v-if="has.limit"><span class="cload__sw is-limit"></span>{{ mode === 'duty' ? $t('ontime.load.keyDutyMax') : $t('ontime.load.keyOntimeMax') }}</span>
    <span v-if="has.over"><span class="cload__sw is-hatch"></span>{{ mode === 'duty' ? $t('ontime.load.keyReduced') : $t('ontime.load.keyCut') }}</span>
    <span v-if="has.lost"><span class="cload__sw is-lost"></span>{{ $t('ontime.load.keySkipped') }}</span>
    <span v-if="has.ocd"><span class="cload__sw is-ocd"></span>{{ $t('ontime.load.keyOcd') }}</span>
    <span v-if="has.strikes"><span class="cload__sw is-strike"></span>{{ $t('ontime.load.keyStrike') }}</span>
    <span v-if="has.silent" :title="$t('ontime.fig.shortHint')"><span class="cload__sw is-short"></span>{{ $t('ontime.load.keySilent') }}</span>
  </div>
</template>
