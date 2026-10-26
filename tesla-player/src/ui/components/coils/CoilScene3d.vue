<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ScenePicker from './ScenePicker.vue';
import { PhySpec, type CoilSpec } from '@/model/coils/spec';
import { PhyCoil, TORTUOSITY } from '@/model/coils/physics';
import { PhyPosedCoil } from '@/model/coils/staging';
import type { ArcState, GfxScene, StageCoil } from '@/engine/gfx';
import { useMidiStore } from '@/app/stores/midi';
import { useScenesStore } from '@/app/stores/scenes';
import { tokenColor } from '@/ui/helpers/token-color';
import { COIL_COLOR_COUNT } from '@/ui/helpers/coil-colors';

/**
 * The coil in 3D (three.js, fetched with this view), its sparks as long as
 * the model's middle arc gives them at the sheet's play point (its note and
 * ontime): the channel's length over ~1.25, as a broken spark goes less far
 * than its path, a dashed ring around the tip as far. They strike the ground
 * when the model says so; violet at a short pulse, white at the board's max.
 * In a scene it is posed in (the menu, kept on this device): its décor, the
 * scene's other coils silent around it, its tubes and its ring, each tube's
 * arcs from the model with all of them on its top.
 */
/** output: the one it is wired to (its base wears its fibre cap's colour); −1: none. uuid: the coil's, for its scenes. */
const props = defineProps<{ spec: CoilSpec; output?: number; uuid?: string | null; ontime: number; noteHz: number }>();
const { locale } = useI18n();
const midiStore = useMidiStore();
const scenes = useScenesStore();

const view = ref<HTMLElement | null>(null);
const scene = shallowRef<GfxScene | null>(null);
const failed = ref(false);
const arcs = ref(true);
const strike = ref(false);
const ontime = computed(() => props.ontime);

/* ------------------------------------------------------------ its scene */
const SCENE_KEY = 'scene3d.sheet';
const picked = ref<string | null>((() => { try { return localStorage.getItem(SCENE_KEY); } catch { return null; } })());
watch(picked, (v) => { try { if (v) localStorage.setItem(SCENE_KEY, v); else localStorage.removeItem(SCENE_KEY); } catch { /* a private window: not kept */ } });
const sceneData = computed(() => {
  const d = scenes.list.find((x) => x.uuid === picked.value)?.data;
  return d && props.uuid && d.coils.some((p) => p.coil === props.uuid) ? d : null;
});
const pose = computed(() => sceneData.value?.coils.find((p) => p.coil === props.uuid) ?? null);

/* ------------------------------------------------------------ its arcs */
// the board's max ontime's bang: the same while the ontime moves
const topE = computed(() => new PhyCoil(props.spec).run({ ontimeUs: props.spec.board.ontime, f: props.noteHz }).eArc);
const sheetArcs = computed((): Omit<ArcState, 'on'> => {
  const s = props.spec, coil = new PhyCoil(s);
  const f = props.noteHz, top = topE.value, here = coil.run({ ontimeUs: ontime.value, f, strikes: true });
  const reach = coil.run({ ontimeUs: ontime.value, f }).l / TORTUOSITY;
  // each bang's energy against the board's max ontime's
  return { reach, strike: here.struck ? 'strike' : 'air', bangHz: f, energy: top > 0 ? Math.min(1, here.eArc / top) : 0, ocd: here.ocdAt != null || here.struck };
});
const arcsNow = computed(() => (pose.value ? new PhyPosedCoil(pose.value, props.spec).arcs(ontime.value, props.noteHz, sceneData.value ?? {}) : sheetArcs.value));
const reach = computed(() => arcsNow.value.reach);
const arcState = (): ArcState => ({ on: arcs.value, ...arcsNow.value });
const capOf = (output: number) => tokenColor(output >= 0 ? `--coil-${output % COIL_COLOR_COUNT}` : '--text-mute');
const caption = computed(() => `${props.noteHz} Hz · ${Math.round(props.ontime).toLocaleString(locale.value)} µs`);

/** This coil first; in a scene, the others after it, silent. */
function stage(): StageCoil[] {
  const me = capOf(props.output ?? -1), d = sceneData.value;
  if (!d || !pose.value) return [{ spec: props.spec, x: 0, azimuth: 0, reach: reach.value, color: me }];
  const others = d.coils.filter((p) => p.coil !== props.uuid).map((p) => ({ p, coil: midiStore.coilByUuid(p.coil) })).filter((x) => x.coil != null);
  return [
    { ...new PhyPosedCoil(pose.value, props.spec).stage(me), reach: reach.value },
    ...others.map((x) => new PhyPosedCoil(x.p, PhySpec.resolve(x.coil!.spec)).stage(capOf(midiStore.outputOf(x.p.coil)))),
  ];
}
// the reach the coil was built for: a longer arc needs its field and its frame again, a shorter one fits in
let built = 0;
const place = () => {
  built = reach.value;
  scene.value?.setCoils(stage(), sceneData.value?.decor ?? null, false, sceneData.value ?? {});
  scene.value?.setArcs(0, arcState());
};
let poll: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  try {
    const { GfxScene } = await import('@/engine/gfx');
    if (!view.value) return;
    scene.value = new GfxScene(view.value, { mat: tokenColor('--text-mute') });
    scene.value.reachRing = true;
    place();
    poll = setInterval(() => { strike.value = !!scene.value?.striking(0); }, 150);
  } catch (err) {
    console.error('3D view', err);
    failed.value = true;
  }
});
onBeforeUnmount(() => {
  clearInterval(poll);
  scene.value?.dispose();
});

let timer: ReturnType<typeof setTimeout> | undefined;
const placeSoon = () => {
  clearTimeout(timer);
  timer = setTimeout(place, 200);
};
watch([() => JSON.stringify(props.spec), () => props.output, sceneData], placeSoon);
watch(reach, (r) => { if (r > built + 0.05 || r < built * 0.7) placeSoon(); });
watch([arcs, arcsNow], () => scene.value?.setArcs(0, arcState()));
</script>

<template>
  <div class="coil-3d">
    <div ref="view" class="coil-3d__view" :title="$t('coils.view3d.hint')">
      <p v-if="failed" class="coil-3d__failed">{{ $t('coils.view3d.failed') }}</p>
    </div>
    <!-- over the picture's corner, not in it: a click on them doesn't turn the view -->
    <div class="coil-3d__over">
      <label class="switch coil-3d__glass"><input v-model="arcs" type="checkbox"><span class="switch__track"></span><span
          class="switch__text">{{ $t('coils.view3d.arcs') }}</span></label>
      <scene-picker v-model="picked" :only="uuid ?? undefined" />
    </div>
    <span class="coil-3d__cap">{{ caption }}</span>
    <span v-if="arcs && strike" class="coil-3d__strike"><i class="fas fa-bolt"></i>{{ $t('coils.view3d.strike') }}</span>
  </div>
</template>
