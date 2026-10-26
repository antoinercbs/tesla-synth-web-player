<script setup lang="ts">
import { computed } from 'vue';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import CoilField from './CoilField.vue';
import OutletIcon from './OutletIcon.vue';
import type { CoilSpec } from '@/model/coils/spec';
import type { SceneTool } from '@/engine/gfx';
import { DEFAULT_RING, type ScenePose } from '@/model/coils/scene-data';
import { PhyPosedCoil } from '@/model/coils/staging';

/**
 * The chosen coil of a scene, under the scene's list: where it stands, its
 * outlet points (the chosen one's numbers), its ground ring (a "+" while it
 * has none). The handles in the
 * picture do the same by hand; here it is to the degree and the millimetre.
 * Every change hands back a whole new pose, with the field it came from (a
 * value typed key after key is one step to undo).
 */
const props = defineProps<{ pose: ScenePose; spec: CoilSpec; name: string; tube: number }>();
const emit = defineEmits<{
  (e: 'change', pose: ScenePose, key: string): void;
  (e: 'tube', index: number): void;
  (e: 'tool', tool: SceneTool): void;
  (e: 'remove'): void;
}>();

function edit(fn: (p: ScenePose) => void, key = ''): void {
  const p: ScenePose = JSON.parse(JSON.stringify(props.pose));
  fn(p);
  emit('change', p, key);
}
const chosen = computed(() => props.pose.tubes[props.tube] ?? null);
const hasCenter = computed(() => props.pose.tubes.some((x) => x.center));
const wrap = (deg: number) => Math.round(((((deg % 360) + 540) % 360) - 180));

function pickTube(j: number): void {
  emit('tube', j);
  emit('tool', 'tubes');
}
function moreTube(center: boolean): void {
  edit((p) => { p.tubes = center ? [...p.tubes, { az: 0, len: props.spec.pin.h, tilt: 90, d: props.spec.pin.d, center: true }] : new PhyPosedCoil(p, props.spec).withOneMorePoint(); });
  pickTube(props.pose.tubes.length);
}
function removeTube(j: number): void {
  edit((p) => { p.tubes.splice(j, 1); });
  emit('tube', 0);
}
const setTube = (key: 'az' | 'len' | 'tilt' | 'd', v: number | undefined) => {
  if (v == null || !chosen.value) return;
  edit((p) => { p.tubes[props.tube][key] = key === 'az' ? ((v % 360) + 360) % 360 : v; }, `tube${props.tube}.${key}`);
};
function addRing(): void {
  // wider on a coil whose topload is wider
  edit((p) => { p.ring = { ...DEFAULT_RING, D: Math.max(DEFAULT_RING.D, props.spec.top.D + 1200), points: { ...DEFAULT_RING.points! } }; });
}
const setRing = (key: 'D' | 'dy', v: number | undefined) => { if (v != null) edit((p) => { if (p.ring) p.ring[key] = v; }, `ring.${key}`); };
const setPoints = (key: 'n' | 'len', v: number | undefined) => edit((p) => {
  if (!p.ring) return;
  if (key === 'n' && !v) { p.ring.points = undefined; return; }
  p.ring.points = { n: p.ring.points?.n ?? 6, len: p.ring.points?.len ?? DEFAULT_RING.points!.len, [key]: v ?? (key === 'n' ? 6 : 100) };
}, `points.${key}`);
</script>

<template>
  <div class="scene-insp">
    <header class="scene-insp__head">
      <b>{{ name }}</b>
      <button class="icon-btn icon-btn--sm" type="button" :title="$t('scenes.panel.remove')" :aria-label="$t('scenes.panel.remove')" @click="emit('remove')"><i
          class="fas fa-trash"></i></button>
    </header>

    <!-- where it stands -->
    <section class="scene-insp__sec">
      <segmented-control :model-value="pose.hang ? 'hung' : 'standing'" fill
        :options="[{ value: 'standing', label: $t('scenes.panel.standing'), icon: 'fa-arrow-up' }, { value: 'hung', label: $t('scenes.panel.hung'), icon: 'fa-arrow-down' }]"
        @update:model-value="edit((p) => { p.hang = $event === 'hung'; })" />
      <div class="scene-insp__grid">
        <coil-field :label="$t('scenes.panel.x')" unit="m" :digits="2" :min="-6" :max="6" :model-value="pose.x" @update:model-value="$event != null && edit((p) => { p.x = $event!; }, 'x')" />
        <coil-field :label="$t('scenes.panel.z')" unit="m" :digits="2" :min="-4" :max="4" :model-value="pose.z" @update:model-value="$event != null && edit((p) => { p.z = $event!; }, 'z')" />
        <coil-field :label="$t('scenes.panel.rot')" unit="°" :digits="0" :min="-180" :max="180" :model-value="pose.rot"
          @update:model-value="$event != null && edit((p) => { p.rot = wrap($event!); }, 'rot')" />
      </div>
    </section>

    <!-- its tubes: a chip each, the chosen one's numbers under them -->
    <section class="scene-insp__sec">
      <h5><outlet-icon />{{ $t('scenes.panel.tubes') }}</h5>
      <div class="scene-insp__chips">
        <span v-for="(x, j) in pose.tubes" :key="j" class="scene-tube" :class="{ 'is-on': j === tube }">
          <button type="button" class="scene-tube__pick" :aria-pressed="j === tube" @click="pickTube(j)">
            <i class="fas" :class="x.center ? 'fa-arrow-up' : 'fa-arrow-right'" :style="x.center ? undefined : { transform: `rotate(${-x.az}deg)` }"></i>{{ x.center ? '' : `${x.az}°` }}
          </button>
          <button v-if="j === tube" type="button" class="scene-tube__x" :title="$t('scenes.panel.tubeRemove')" :aria-label="$t('scenes.panel.tubeRemove')" @click="removeTube(j)"><i
              class="fas fa-xmark"></i></button>
        </span>
        <button class="scene-tube scene-tube--add" type="button" :title="$t('scenes.panel.addTube')" :aria-label="$t('scenes.panel.addTube')" :disabled="pose.tubes.length >= 8"
          @click="moreTube(false)"><i class="fas fa-plus"></i></button>
        <button v-if="!hasCenter" class="scene-tube scene-tube--add" type="button" :title="$t('scenes.panel.centerTube')" :aria-label="$t('scenes.panel.centerTube')"
          :disabled="pose.tubes.length >= 8" @click="moreTube(true)"><i class="fas fa-plus"></i><i class="fas fa-arrow-up"></i></button>
      </div>
      <div v-if="chosen" class="scene-insp__grid">
        <coil-field v-if="!chosen.center" :label="$t('scenes.panel.angle')" unit="°" :digits="0" :min="0" :max="359" :model-value="chosen.az" @update:model-value="setTube('az', $event)" />
        <coil-field :label="$t('scenes.panel.length')" unit="mm" :digits="0" :min="50" :max="1500" :model-value="chosen.len" @update:model-value="setTube('len', $event)" />
        <coil-field v-if="!chosen.center" :label="$t('scenes.panel.tilt')" unit="°" :digits="0" :min="-30" :max="85" :model-value="chosen.tilt" @update:model-value="setTube('tilt', $event)" />
        <coil-field :label="$t('scenes.panel.ringD')" unit="mm" :digits="1" :min="2" :max="40" :model-value="chosen.d ?? spec.pin.d" @update:model-value="setTube('d', $event)" />
      </div>
    </section>

    <!-- its ground ring: a "+" while it has none -->
    <section v-if="pose.ring" class="scene-insp__sec">
      <h5><i class="fas fa-ring"></i>{{ $t('scenes.props.ring') }}<button class="scene-insp__x" type="button" :title="$t('scenes.props.remove')" :aria-label="$t('scenes.props.remove')"
          @click="edit((p) => { p.ring = null; })"><i class="fas fa-xmark"></i></button></h5>
      <div class="scene-insp__grid scene-insp__grid--2">
        <coil-field :label="$t('scenes.panel.ringD')" unit="mm" :digits="0" :min="spec.top.D + 300" :max="5000" :model-value="pose.ring.D" @update:model-value="setRing('D', $event)" />
        <coil-field :label="$t('scenes.panel.height')" unit="mm" :digits="0" :min="-400" :max="500" :hint="$t('scenes.panel.heightHint')" :model-value="pose.ring.dy"
          @update:model-value="setRing('dy', $event)" />
        <coil-field :label="$t('scenes.panel.points')" unit="" :digits="0" :min="1" :max="12" optional :model-value="pose.ring.points?.n" @update:model-value="setPoints('n', $event)" />
        <coil-field v-if="pose.ring.points" :label="$t('scenes.panel.length')" unit="mm" :digits="0" :min="10" :max="400" :model-value="pose.ring.points.len"
          @update:model-value="setPoints('len', $event)" />
      </div>
    </section>
    <section v-else class="scene-insp__sec">
      <button class="scene-add" type="button" @click="addRing"><i class="fas fa-plus"></i><i class="fas fa-ring"></i><span>{{ $t('scenes.props.ring') }}</span></button>
    </section>
  </div>
</template>
