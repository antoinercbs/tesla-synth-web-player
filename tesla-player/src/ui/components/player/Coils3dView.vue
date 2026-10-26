<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useMidiStore } from '@/app/stores/midi';
import { useScenesStore } from '@/app/stores/scenes';
import { BANG_OCD, BANG_STRIKE, type DevSimulation } from '@/model/devices/simulation';
import { PhySpec } from '@/model/coils/spec';
import { PhyCoil, TORTUOSITY } from '@/model/coils/physics';
import { PhyResponse } from '@/model/coils/response';
import { tokenColor } from '@/ui/helpers/token-color';
import { COIL_COLOR_COUNT } from '@/ui/helpers/coil-colors';
import { PhyPosedCoil } from '@/model/coils/staging';
import { REF_HZ } from '@/model/coils/summary';
import type { GfxScene, StageCoil } from '@/engine/gfx';
import ScenePicker from '@/ui/components/coils/ScenePicker.vue';
import type { CoilConfig, SongStereo } from '@/model/domain';

/**
 * The song's coils in 3D, as on stage: each drawn from its sheet, side by
 * side (where the song's spatialisation puts them, else in their order), its
 * tube toward the audience, its arcs as the simulation has them at the
 * playhead: their reach, their bang rate, and a strike on its ground mat when it says so.
 * Their tubes point outward and a little toward the audience: the arcs seen
 * from the side. Each base wears its fibre cap's colour; the pointer on a
 * coil names it and its output, a click opens its sheet.
 *
 * In a scene (the menu over the view, kept on this device): its décor, and
 * the coils it poses as it poses them, the others where they would be
 * without it, in front. The simulation keeps the sheets' one tube: each of a
 * posed coil's tubes stretches its simulated channel as the model with all of
 * them on its top does at a reference setting, and strikes when that reaches
 * the ground or the ring.
 */
const props = defineProps<{
  sim: DevSimulation | null;
  coils: CoilConfig[];
  stereo?: SongStereo | null;
  playheadMs: number;
  /** Where the song is heard, read every frame while it plays: `playheadMs` comes a few times a second only. */
  clock?: (() => number) | null;
  playing: boolean;
}>();
const midiStore = useMidiStore();
const scenes = useScenesStore();
const { t } = useI18n();
const router = useRouter();

const view = ref<HTMLElement | null>(null);
const scene = shallowRef<GfxScene | null>(null);
const failed = ref(false);

// the coils with a sheet, in the simulation's order (its tracks follow the song's coils, placed on outputs)
const shown = computed(() => props.coils.map((c, track) => {
  const coil = midiStore.wiredCoil(c.coilIndex);
  return coil ? { track, id: coil.id, uuid: coil.uuid, name: coil.name, output: c.coilIndex, spec: PhySpec.resolve(coil.spec) } : null;
}).filter((x) => x != null));

/* ------------------------------------------------------------ its scene */
// shared with the sidebar, which names it (app/stores/scenes.ts)
const picked = computed<string | null>({ get: () => scenes.played, set: (v) => scenes.play(v) });
const sceneData = computed(() => scenes.list.find((x) => x.uuid === picked.value)?.data ?? null);
// the song's coils, for its menu: the scenes that pose them first
const songCoils = computed(() => shown.value.map((c) => ({ uuid: c.uuid, color: tokenColor(`--coil-${c.output % COIL_COLOR_COUNT}`) })));
const poses = computed(() => shown.value.map((c) => sceneData.value?.coils.find((p) => p.coil === c.uuid) ?? null));
// each posed coil's tubes against the sheet's one, at the club's usual setting
const scales = computed(() => shown.value.map((c, i) => (poses.value[i] ? new PhyPosedCoil(poses.value[i]!, c.spec).scale(80, REF_HZ, sceneData.value ?? {}) : null)));
// each one's strongest bang, at its board's max ontime on a low note: its arcs' colour goes from violet to white up to it
const strongest = computed(() => shown.value.map((c) => PhyResponse.of(c.spec).at(new PhyCoil(c.spec).pulseUs(c.spec.board.ontime, 110), 110).e));
const missing = computed(() => props.coils.length - shown.value.length);

// each coil's longest arcs in the song, to frame the stage with them
const reaches = computed(() => shown.value.map((c) => {
  const tr = props.sim?.tracks[c.track];
  return tr ? tr.arcM.reduce((m, v) => Math.max(m, v), 0) / TORTUOSITY : 0;
}));

/** Side by side with a metre between them, or along the stage where the spatialisation places them. */
function layout(): StageCoil[] {
  const list = shown.value;
  const width = (i: number) => {
    const s = list[i].spec;
    return s.top.D / 1000 + 2 * (s.pin.h / 1000) * Math.cos((s.pin.tilt * Math.PI) / 180) + 1;
  };
  const total = list.reduce((t, _, i) => t + width(i), 0);
  const places = list.map((c) => props.stereo?.coils[props.coils[c.track].coilIndex]?.position);
  const placed = places.every((p) => p != null);
  let x = -total / 2;
  const toward = Math.PI / 6;
  return list.map((c, i) => {
    const w = width(i);
    const at = placed ? (places[i]! - 0.5) * Math.max(total, 3) : x + w / 2;
    x += w;
    const color = tokenColor(`--coil-${c.output % COIL_COLOR_COUNT}`), pose = poses.value[i];
    if (pose) return { ...new PhyPosedCoil(pose, c.spec).stage(color), reach: reaches.value[i] * Math.max(...scales.value[i]!.ratios, 1) };
    return {
      spec: c.spec, x: at, z: sceneData.value ? 1.6 : 0, azimuth: i < (list.length - 1) / 2 ? Math.PI - toward : toward, reach: reaches.value[i], color,
    };
  });
}

// the reaches the coils were built for: a longer arc needs its field and its frame again, a shorter one
// fits in (the power moved while it plays would rebuild them a few times a second)
let builtReaches: number[] = [];
function build(): void {
  builtReaches = reaches.value.slice();
  scene.value?.setCoils(layout(), sceneData.value?.decor ?? null, false, sceneData.value ?? {});
  update();
}
onMounted(async () => {
  try {
    const { GfxScene } = await import('@/engine/gfx');
    if (!view.value) return;
    scene.value = new GfxScene(view.value, { mat: tokenColor('--text-mute') });
    build();
  } catch (err) {
    console.error('3D view', err);
    failed.value = true;
  }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  scene.value?.dispose();
});
watch(() => JSON.stringify([shown.value.map((c) => [c.spec, c.output]), props.stereo?.coils, sceneData.value]), build);
watch(reaches, (r) => {
  if (r.some((x, i) => x > (builtReaches[i] ?? 0) + 0.05 || x < (builtReaches[i] ?? 0) * 0.7)) build();
});

/** Each coil's arcs where the song is heard, as the board plays them. */
function update(): void {
  const sc = scene.value, sim = props.sim;
  if (!sc) return;
  const s = sim ? sim.stepAt(props.clock?.() ?? props.playheadMs) : 0;
  shown.value.forEach((c, i) => {
    const tr = sim?.tracks[c.track];
    const on = props.playing && !!tr && tr.pulseUs[s] > 0 && tr.arcM[s] > 0;
    const perBang = on && tr!.bangHz[s] > 0 ? tr!.powerW[s] / tr!.bangHz[s] : 0;
    const channel = on ? tr!.arcM[s] : 0, scale = scales.value[i];
    // a posed coil: each tube's channel, and the first that reaches its ground (or the mat's strike, simulated)
    const chans = scale ? scale.ratios.map((r) => channel * r) : [channel];
    const reaching = scale ? chans.findIndex((l, j) => l >= scale.strikeLens[j]) : -1;
    const struck = on && (tr!.bang[s] === BANG_STRIKE || reaching >= 0);
    sc.setArcs(i, {
      on, reach: Math.max(...chans) / TORTUOSITY, reaches: chans.map((l) => l / TORTUOSITY), strike: struck ? 'strike' : 'air',
      strikeFrom: reaching >= 0 ? reaching : undefined, bangHz: on ? tr!.bangHz[s] : 0, ocd: on && tr!.bang[s] >= BANG_OCD,
      energy: strongest.value[i] > 0 ? Math.min(1, perBang / strongest.value[i]) : 0.5,
    });
  });
}
// while it plays, every frame: the arcs keep time with the sound
let raf = 0;
function follow(): void {
  update();
  raf = requestAnimationFrame(follow);
}
watch(() => props.playing, (playing) => {
  cancelAnimationFrame(raf);
  if (playing) follow();
  else update();
}, { immediate: true });
watch(() => [props.playheadMs, props.sim], () => { if (!props.playing) update(); });

/* ------------------------------------------------------------ the pointer on a coil */
const hover = ref<{ i: number; x: number; y: number } | null>(null);
const hovered = computed(() => {
  const c = hover.value ? shown.value[hover.value.i] : null;
  return c ? { name: c.name, cap: t('player.wiring.cap', { n: c.output, color: t(`player.wiring.caps.${c.output % COIL_COLOR_COUNT}`) }) } : null;
});
let down: { x: number; y: number } | null = null;
const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
function onMove(e: PointerEvent): void {
  if (e.buttons || e.pointerType === 'touch') { hover.value = null; return; }
  const i = scene.value?.pick(e.clientX, e.clientY) ?? null;
  const box = view.value?.getBoundingClientRect();
  hover.value = i != null && box ? { i, x: e.clientX - box.left, y: e.clientY - box.top } : null;
}
// a click, not the end of a turn of the view: its sheet
function onUp(e: PointerEvent): void {
  const from = down;
  down = null;
  if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
  const i = scene.value?.pick(e.clientX, e.clientY);
  const c = i != null ? shown.value[i] : null;
  if (c) void router.push({ name: 'coils', params: { id: String(c.id) } });
}
</script>

<template>
  <div class="coils-3d">
    <div class="coils-3d__scene"><scene-picker v-model="picked" :song="songCoils" /></div>
    <div ref="view" class="coils-3d__view" :class="{ 'is-on-coil': hovered }" :title="hovered ? undefined : $t('coils.view3d.hint')"
      @pointermove="onMove" @pointerleave="hover = null" @pointerdown="onDown" @pointerup="onUp">
      <p v-if="failed" class="coils-3d__note">{{ $t('coils.view3d.failed') }}</p>
      <div v-if="hover && hovered" class="coils-3d__tip" :style="{ '--x': `${hover.x}px`, '--y': `${hover.y}px` }">
        <b>{{ hovered.name }}</b>
        <span class="fiber-cap" :style="{ '--c': `var(--coil-${shown[hover.i].output % 6})` }">{{ hovered.cap }}</span>
        <small>{{ $t('player.view3d.openSheet') }}</small>
      </div>
      <p v-else-if="coils.length && !shown.length" class="coils-3d__note">{{ $t('player.view3d.noSheet') }}</p>
    </div>
    <p v-if="missing && shown.length" class="coils-3d__missing">{{ $t('player.view3d.missing', missing) }}</p>
  </div>
</template>
