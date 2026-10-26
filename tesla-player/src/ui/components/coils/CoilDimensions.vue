<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { PhyCoilShape } from '@/model/coils/shape';
import type { CoilSpec } from '@/model/coils/spec';
import CoilField from './CoilField.vue';
import type { FieldDef } from './use-coil-fields';

/**
 * The coil seen from its side, to scale and as the 3D builds it (the same
 * PhyCoilShape): the box and its lid, the arms carrying the primary's turns,
 * the secondary, the topload's rings, the outlet tube; each size of the sheet
 * typed on the dimension line it measures. The sizes beside it make room for
 * each other.
 */
const props = defineProps<{
  spec: CoilSpec;
  fields: FieldDef[];
  valueOf: (f: FieldDef) => number | undefined;
  hintOf: (key: string) => string | undefined;
}>();
const emit = defineEmits<{ set: [f: FieldDef, v: number | undefined] }>();
const uid = useId();

const box = ref<HTMLElement | null>(null);
const W = ref(468), H = ref(420);
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    W.value = Math.max(260, Math.round(e.contentRect.width));
    H.value = Math.max(280, Math.round(e.contentRect.height));
  });
  if (box.value) ro.observe(box.value);
});
onBeforeUnmount(() => ro?.disconnect());

const field = (key: string) => props.fields.find((f) => f.key === key);
// a chip: a field's label over its box
const CH = 50, GAP = 6;
type Chip = { key: string; x: number; y: number; w: number };

/** One side's chips top to bottom, none over another, all inside the drawing. */
function stack(chips: Chip[]): Chip[] {
  const out = [...chips].sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + CH + GAP);
  const over = out.length ? out[out.length - 1].y + CH - H.value : 0;
  if (over > 0) for (const c of out) c.y = Math.max(0, c.y - over);
  return out;
}

const g = computed(() => {
  const s = props.spec, sh = new PhyCoilShape(s), w = W.value, h = H.value;
  const cw = w < 420 ? 84 : 104, lane = cw + 18, rw = Math.round(cw * 1.45);
  const top0 = CH + 18, floorY = h - 18;
  const tube = sh.rimTube(s.pin.h, s.pin.tilt);
  const bodyR = Math.max(sh.D / 2, sh.half, sh.rE, sh.rRail + sh.railR, sh.rOut);
  const cx = w / 2, highest = Math.max(sh.topCenterY + sh.d / 2, tube.tip[1]);
  // the scale: the body between the side lanes, the tube out to the edge, the top under the topload's size
  const k = Math.max(1, Math.min((w - 2 * lane) / (2 * bodyR), (w - 8 - cx) / tube.tip[0], (floorY - top0) / highest));
  const X = (m: number) => cx + m * k, Y = (m: number) => floorY - m * k;
  const px = (m: number, min = 1) => Math.max(min, m * k);

  // the base: the box (its lid, its band), the hub and its disc, the arms, the rail, the primary's turns
  const arm = sh.armSide, [qx, qy] = sh.armCurve, at = (side: number, [r, y]: [number, number]) => `${X(side * r).toFixed(1)},${Y(sh.armBot + y).toFixed(1)}`;
  const armPath = (side: number) => `M${at(side, arm[0])} L${at(side, arm[1])} L${at(side, arm[2])} Q${at(side, [qx, qy])} ${at(side, arm[3])} ${arm.slice(4).map((p) => `L${at(side, p)}`).join(' ')} Z`;
  const turns = Array.from({ length: Math.floor(sh.turns) + 1 }, (_, i) => sh.rIn + sh.pitch * Math.min(i, sh.turns));
  const base = {
    box: { x: X(-sh.half), y: Y(sh.boxTop), w: 2 * sh.half * k, h: sh.boxTop * k },
    lid: { y: Y(sh.boxTop), h: px(sh.lidT, 2) },
    band: { y: Y(sh.boxTop - sh.lidT), h: px(sh.bandH, 2) },
    hub: { x: X(-sh.hubR), y: Y(sh.bodyTop), w: 2 * sh.hubR * k, h: (sh.bodyTop - sh.boxTop) * k },
    disc: { x: X(-sh.discR), y: Y(sh.bodyTop + sh.mv(15)), w: 2 * sh.discR * k, h: px(sh.mv(15), 2) },
    arms: [armPath(1), armPath(-1)],
    rail: { y: Y(sh.railY), x: [X(-sh.rRail), X(sh.rRail)], r: px(sh.railR, 1.5) },
    turns: turns.flatMap((r) => [X(-r), X(r)]), turnR: px(sh.tubeR, 1.5), priY: Y(sh.priY),
  };
  // the secondary, the topload on its hub (its rings, or a torus), the outlet tube
  const sec = { x: X(-sh.secR), y: Y(sh.topY), w: 2 * sh.secR * k, h: sh.secH * k };
  const topHub = { x: X(-sh.topHubR), y: Y(sh.topHubHi), w: 2 * sh.topHubR * k, h: (sh.topHubHi - sh.topHubLo) * k };
  const rings = sh.rings.length
    ? sh.rings.map((r) => ({ x: X(-(r.r + r.tubeR)), y: Y(r.y + r.tubeR), w: 2 * (r.r + r.tubeR) * k, h: px(2 * r.tubeR, 2) }))
    : [{ x: X(-sh.D / 2), y: Y(sh.topCenterY + sh.d / 2), w: sh.D * k, h: sh.d * k }];
  const pin = { x1: X(tube.base[0]), y1: Y(tube.base[1]), x2: X(tube.tip[0]), y2: Y(tube.tip[1]), w: px(2 * tube.radius, 1.5) };

  const topTop = Y(sh.topCenterY + sh.d / 2), topBot = Y(sh.topCenterY - sh.d / 2), topL = X(-sh.D / 2);
  const secMid = (Y(sh.secY0) + Y(sh.topY)) / 2, priY = Y(sh.priY), floor = Y(0);
  const standX = X(bodyR) + 12, priDimY = priY - 14;
  const dims = {
    topD: { x1: topL, x2: X(sh.D / 2), y1: topTop - 10, y2: topTop - 10 },
    topd: { x1: topL - 10, x2: topL - 10, y1: topTop, y2: topBot },
    secH: { x1: X(-sh.secR) - 14, x2: X(-sh.secR) - 14, y1: Y(sh.topY), y2: Y(sh.secY0) },
    secD: { x1: X(-sh.secR), x2: X(sh.secR), y1: secMid, y2: secMid },
    priOd: { x1: X(-sh.rOut), x2: X(sh.rOut), y1: priDimY, y2: priDimY },
    stand: { x1: standX, x2: standX, y1: priY, y2: floor },
  };
  const ext = [
    [topL, topTop + 2, topL, topTop - 14], [X(sh.D / 2), topTop + 2, X(sh.D / 2), topTop - 14],
    [topL + 2, topTop, topL - 14, topTop], [topL + 2, topBot, topL - 14, topBot],
    [X(-sh.secR), Y(sh.topY), dims.secH.x1 - 4, Y(sh.topY)], [X(-sh.secR), Y(sh.secY0), dims.secH.x1 - 4, Y(sh.secY0)],
    [X(-sh.rOut), priY, X(-sh.rOut), priDimY - 4], [X(sh.rOut), priY, X(sh.rOut), priDimY - 4],
    [X(sh.rOut), priY, standX + 4, priY],
  ];
  const topDChip: Chip = { key: 'topD', x: cx - cw / 2, y: Math.max(0, dims.topD.y1 - 6 - CH), w: cw };
  const chips = [
    topDChip,
    { key: 'rings', x: topDChip.x - 10 - rw, y: topDChip.y, w: rw },
    ...stack([
      { key: 'topd', x: dims.topd.x1 - 10 - cw, y: Y(sh.topCenterY) - CH / 2, w: cw },
      { key: 'secH', x: dims.secH.x1 - 10 - cw, y: secMid - CH / 2, w: cw },
      { key: 'priOd', x: X(-sh.rOut) - 12 - cw, y: priDimY - CH / 2, w: cw },
    ]),
    ...stack([
      { key: 'secD', x: X(sh.secR) + 26, y: secMid - CH / 2, w: cw },
      { key: 'stand', x: standX + 10, y: (priY + floor) / 2 - CH / 2, w: cw },
    ]),
  ].map((c) => ({ ...c, x: Math.max(0, Math.min(w - c.w, c.x)) }));
  // the leaders: the secondary's Ø out to its chip, the rings' chip down to them
  const secChip = chips.find((c) => c.key === 'secD')!, ringChip = chips.find((c) => c.key === 'rings')!;
  const leaders = [
    [X(sh.secR), secMid, secChip.x - 4, secMid],
    [ringChip.x + ringChip.w * 0.7, ringChip.y + CH, rings[0].x + 6, rings[Math.floor(rings.length / 2)].y],
  ];
  return { w, h, floor, base, sec, topHub, rings, pin, dims, ext, chips, leaders };
});

const ringFields = computed(() => [field('rings'), field('ringTube')].filter((f): f is FieldDef => !!f));
</script>

<template>
  <div ref="box" class="cdim">
    <svg :viewBox="`0 0 ${g.w} ${g.h}`" aria-hidden="true">
      <defs>
        <marker :id="`${uid}-arrow`" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path class="cdim__arrow" d="M0 0 L8 4 L0 8 z" />
        </marker>
      </defs>
      <line class="cdim__floor" x1="8" :x2="g.w - 8" :y1="g.floor" :y2="g.floor" />
      <!-- the base -->
      <rect class="cdim__box" :x="g.base.box.x" :y="g.base.box.y" :width="g.base.box.w" :height="g.base.box.h" />
      <rect class="cdim__dark" :x="g.base.box.x" :y="g.base.lid.y" :width="g.base.box.w" :height="g.base.lid.h" />
      <rect class="cdim__band" :x="g.base.box.x" :y="g.base.band.y" :width="g.base.box.w" :height="g.base.band.h" />
      <rect class="cdim__dark" :x="g.base.hub.x" :y="g.base.hub.y" :width="g.base.hub.w" :height="g.base.hub.h" />
      <rect class="cdim__dark" :x="g.base.disc.x" :y="g.base.disc.y" :width="g.base.disc.w" :height="g.base.disc.h" />
      <path v-for="(d, i) in g.base.arms" :key="`a${i}`" class="cdim__dark" :d="d" />
      <circle v-for="(x, i) in g.base.rail.x" :key="`r${i}`" class="cdim__alu" :cx="x" :cy="g.base.rail.y" :r="g.base.rail.r" />
      <circle v-for="(x, i) in g.base.turns" :key="`t${i}`" class="cdim__copper" :cx="x" :cy="g.base.priY" :r="g.base.turnR" />
      <!-- the secondary, the topload, the outlet tube -->
      <rect class="cdim__sec" :x="g.sec.x" :y="g.sec.y" :width="g.sec.w" :height="g.sec.h" />
      <rect class="cdim__dark" :x="g.topHub.x" :y="g.topHub.y" :width="g.topHub.w" :height="g.topHub.h" />
      <rect v-for="(r, i) in g.rings" :key="`g${i}`" class="cdim__ring" :x="r.x" :y="r.y" :width="r.w" :height="r.h" :rx="r.h / 2" />
      <line class="cdim__pin" :x1="g.pin.x1" :y1="g.pin.y1" :x2="g.pin.x2" :y2="g.pin.y2" :stroke-width="g.pin.w" />
      <!-- the sizes -->
      <line v-for="(e, i) in g.ext" :key="`e${i}`" class="cdim__ext" :x1="e[0]" :y1="e[1]" :x2="e[2]" :y2="e[3]" />
      <line v-for="(e, i) in g.leaders" :key="`l${i}`" class="cdim__ext" :x1="e[0]" :y1="e[1]" :x2="e[2]" :y2="e[3]" />
      <line v-for="(d, key) in g.dims" :key="key" class="cdim__dim" :x1="d.x1" :y1="d.y1" :x2="d.x2" :y2="d.y2"
        :marker-start="`url(#${uid}-arrow)`" :marker-end="`url(#${uid}-arrow)`" />
    </svg>

    <div v-for="c in g.chips" :key="c.key" class="cdim__chip" :class="{ 'is-pair': c.key === 'rings' }"
      :style="{ left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px` }">
      <template v-if="c.key === 'rings'">
        <coil-field v-for="f in ringFields" :key="f.key" :label="$t(`coils.dims.${f.key}`)" :unit="f.unit" :model-value="valueOf(f)"
          :factor="f.factor" :digits="f.digits" :optional="f.optional" :min="f.min" :max="f.max" :hint="hintOf(f.key)"
          @update:model-value="emit('set', f, $event)" />
      </template>
      <coil-field v-else-if="field(c.key)" :label="$t(`coils.dims.${c.key}`)" :unit="field(c.key)!.unit" :model-value="valueOf(field(c.key)!)"
        :factor="field(c.key)!.factor" :digits="field(c.key)!.digits" :optional="field(c.key)!.optional" :min="field(c.key)!.min"
        :max="field(c.key)!.max" :hint="hintOf(c.key)" @update:model-value="emit('set', field(c.key)!, $event)" />
    </div>
  </div>
</template>
