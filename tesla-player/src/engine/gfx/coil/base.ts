import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PRIMARY_TUNE } from '@/model/coils/physics';
import { PhyCoilShape } from '@/model/coils/shape';
import type { CoilSpec } from '@/model/coils/spec';
import { GFX_PALETTE } from '../palette';

/**
 * A coil's base in 3D, from its sheet: a square box (its electronics), a hub on its lid, eight arms
 * on the hub carrying the flat spiral primary, the tap's clamp with its lead down into the lid, a
 * strike rail in the arms' hooks, and a band in its fibre cap's colour under the lid. Drawn after the
 * small club coil's CAD (plans A-01, A-02 box, M-01 primary base, M-02 disc, M-03 arms, M-17 lid),
 * scaled by the primary's diameter, its heights fitted to the sheet's stand. In the coil's own frame:
 * +y up from the floor, its front along +x, the box's faces across ±x and ±z, an arm toward each face
 * and each corner (M-03's arm 1 is on the box's x axis).
 */

export interface BaseOptions {
  /** Its fibre cap's colour (CSS), worn by a band under the lid; none: no band. */
  color?: string;
  /** Shared with the rest of the coil; else its own. */
  copper?: THREE.Material;
  alu?: THREE.Material;
  /** The primary's inductance at the tap in use (H): where the clamp sits. Else the sheet's. */
  L1?: number;
}

const TAU = Math.PI * 2;
/** Its arms: eight, a lead can only go down between two. */
const ARMS = 8;
/** The spiral's inner end and its lead, down beside the hub (M-17's hole Ø 12 is at −109°). */
const INNER_AZ = -112.5 * (Math.PI / 180);
/** Where the strike rail is open: a closed rail would be a shorted turn around the primary. */
const RAIL_GAP_AZ = 157.5 * (Math.PI / 180);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pieces as one mesh, one draw call; the pieces are dropped. */
function merged(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  // an extrusion has no index: all go without when one does
  const flat = parts.some((p) => !p.index) ? parts.map((p) => (p.index ? p.toNonIndexed() : p)) : parts;
  const geo = mergeGeometries(flat);
  if (!geo) throw new Error('base: pieces of different attributes');
  for (const p of new Set([...parts, ...flat])) p.dispose();
  return new THREE.Mesh(geo, material);
}

export class GfxCoilBase {
  readonly group: THREE.Group;
  /** The primary's plane (the sheet's stand) and the box's lid (m from the floor). */
  readonly priY: number;
  readonly boxTop: number;
  /** The hub's disc top (m), a ring around the secondary's foot. */
  readonly hubTop: number;
  /** Half the box's width, its corners' distance from the axis, and how far the base reaches (corners, arms, rail) (m). */
  readonly half: number;
  readonly corner: number;
  readonly outerR: number;
  /** The spiral: its centre line's inner and outer radius, its tube's radius (m), its turns. */
  readonly rIn: number;
  readonly rOut: number;
  readonly tubeR: number;
  readonly turns: number;
  /** The clamp on the tube, and its turns from the inner end. */
  readonly tap: THREE.Vector3;
  readonly tapTurns: number;
  /** The lamps on its front face: powered (always on), a musical signal received, the OCD tripped. */
  readonly leds: { power: THREE.Mesh; signal: THREE.Mesh; ocd: THREE.Mesh };

  constructor(spec: CoilSpec, opts: BaseOptions = {}) {
    // the layout, the sheet's side view's too (model/coils/shape.ts): the spiral, the hub, the arms' and the box's heights
    const sh = new PhyCoilShape(spec);
    const mk = (x: number) => sh.mk(x), mv = (x: number) => sh.mv(x);
    const { priY, tubeR, pitch, rOut, hubR, flR, discR, rIn, turns, armBot, boxTop, hubTop, half, lidT } = sh;
    const W = half * 2;
    this.half = half;

    const copper = opts.copper ?? new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.copper, metalness: 0.75, roughness: 0.35 });
    const alu = opts.alu ?? new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.aluminium, metalness: 0.45, roughness: 0.3 });
    // printed in black thermoplastic (no conductive filler: they stand in the primary's field), the lid painted alike
    const black = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.plastic.printed, roughness: 0.7 });
    const plexi = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.plastic.plexi, metalness: 0.15, roughness: 0.28 });
    const group = new THREE.Group();

    // the box: frame of 30 × 30 profiles, plexiglas faces just inside its edges, a bottom plate, the lid (A-02, M-17, M-26)
    const plateT = Math.min(clamp(mk(3), 0.002, 0.005), boxTop * 0.05);
    const s = Math.min(clamp(mk(30), 0.015, 0.04), half * 0.3), hb = Math.max(0.001, boxTop - lidT - plateT), yMid = plateT + hb / 2;
    const o = half - s / 2, span = Math.max(0.001, W - 2 * s);
    const bar = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
    const frame: THREE.BufferGeometry[] = [bar(W - mk(6), plateT, W - mk(6), 0, plateT / 2, 0)];
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) frame.push(bar(s, hb, s, a * o, yMid, b * o));
    for (const y of [plateT + s / 2, boxTop - lidT - s / 2]) {
      for (const a of [1, -1]) frame.push(bar(span, s, s, 0, y, a * o), bar(s, s, span, a * o, y, 0));
    }
    group.add(new THREE.Mesh(bar(W - 0.003, hb, W - 0.003, 0, yMid, 0), plexi));
    // which output it is on, seen from the hall: a band under the lid, round the four faces (at the ceiling's side when hung)
    if (opts.color) {
      const cap = new THREE.Color(opts.color), bandH = sh.bandH, y = boxTop - lidT - bandH / 2, t = 0.003;
      const band = [bar(W + t, bandH, t, 0, y, half), bar(W + t, bandH, t, 0, y, -half), bar(t, bandH, W + t, half, y, 0), bar(t, bandH, W + t, -half, y, 0)];
      group.add(merged(band, new THREE.MeshStandardMaterial({ color: cap, emissive: cap, emissiveIntensity: 0.55, roughness: 0.4 })));
    }

    // the hub (M-01): flange screwed on the lid, body, and the disc (M-02) clamping the arms; its collar hides in the secondary
    const flT = Math.max(0.002, mv(4)), bodyTop = sh.bodyTop;
    const dark: THREE.BufferGeometry[] = [
      bar(W, lidT, W, 0, boxTop - lidT / 2, 0),
      new THREE.CylinderGeometry(flR, flR, flT, 48).translate(0, boxTop + flT / 2, 0),
      new THREE.CylinderGeometry(hubR, hubR, bodyTop - boxTop, 40).translate(0, (boxTop + bodyTop) / 2, 0),
      new THREE.CylinderGeometry(discR, discR, mv(15), 40).translate(0, bodyTop + mv(7.5), 0),
    ];
    // an arm (M-03, its cradles left out): rooted in the hub, its underside rising outward, a hook at its end for the rail
    const r0 = hubR - mk(16.65), rB = rOut + mk(11), rE = sh.rE, yB = mv(17.5), yH = mv(50);
    const side = new THREE.Shape();
    side.moveTo(r0, 0);
    side.lineTo(rIn, 0);
    side.lineTo(rB, yB);
    side.quadraticCurveTo(rE, yB + ((rE - rB) * yB) / (rB - rIn), rE, mv(37));
    side.lineTo(rE, yH - mv(2));
    side.lineTo(rE - mk(2), yH);
    side.lineTo(rOut + mk(17), yH);
    side.lineTo(rOut + mk(14), mv(35));
    side.lineTo(r0, mv(35));
    side.closePath();
    const armT = clamp(mk(10), 0.006, 0.02);
    const arm = new THREE.ExtrudeGeometry(side, { depth: armT, bevelEnabled: false, curveSegments: 6 }).translate(0, armBot, -armT / 2);
    for (let i = 0; i < ARMS; i++) dark.push(arm.clone().rotateY((-i * TAU) / ARMS));
    arm.dispose();

    // the spiral, from its inner end outward
    const at = (t: number, y = priY) => {
      const th = INNER_AZ + t * TAU, r = rIn + pitch * t;
      return new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th));
    };
    const n = Math.ceil(turns * 48), pts = Array.from({ length: n + 1 }, (_, i) => at((i / n) * turns));
    const inner = pts[0];
    const leadIn = priY - (boxTop + flT / 2);
    const cu: THREE.BufferGeometry[] = [
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tubeR, 8, false),
      new THREE.SphereGeometry(tubeR, 8, 6).translate(inner.x, inner.y, inner.z),
      new THREE.SphereGeometry(tubeR, 8, 6).translate(pts[n].x, pts[n].y, pts[n].z),
      new THREE.CylinderGeometry(tubeR, tubeR, leadIn, 8).translate(inner.x, priY - leadIn / 2, inner.z),
    ];

    // the tap: where Wheeler's flat spiral (Proc. IRE 16, 1928: L µH = a²N² / (8a + 11c), a its mean radius, c its
    // width, in inches) reaches L1, leads left out; snapped to eighths of a turn so its lead goes down between two arms
    const L1 = opts.L1 ?? spec.L1 ?? 1 / ((TAU * spec.f2 * PRIMARY_TUNE) ** 2 * spec.c1);
    const wheeler = (t: number) => {
      const a = (rIn + (pitch * t) / 2) / 0.0254, c = (pitch * t) / 0.0254;
      return ((a * a * t * t) / (8 * a + 11 * c)) * 1e-6;
    };
    let lo = 0, hi = turns;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (wheeler(mid) < L1) lo = mid;
      else hi = mid;
    }
    const tapTurns = Math.min(Math.floor(turns * ARMS) / ARMS, Math.max(1 / ARMS, Math.round(lo * ARMS) / ARMS));
    const tap = at(tapTurns), thTap = INNER_AZ + tapTurns * TAU, rTap = rIn + pitch * tapTurns;
    cu.push(new THREE.BoxGeometry(tubeR * 2.6, tubeR * 2.8, tubeR * 3.6).rotateY(-thTap).translate(tap.x, priY - tubeR * 0.5, tap.z));
    // its lead into the lid, drawn in when the clamp is out over the box's edge (M-17's hole Ø 14 is at r 140)
    const land = Math.max(flR, Math.min(rTap, this.footAt(thTap) - mk(15)));
    const toward = (r: number, y: number) => new THREE.Vector3(r * Math.cos(thTap), y, r * Math.sin(thTap));
    dark.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      toward(rTap, priY - tubeR * 1.9),
      toward(rTap + (land - rTap) * 0.3, (priY + boxTop) / 2),
      toward(land, boxTop + Math.min(0.02, (priY - boxTop) * 0.2)),
      toward(land, boxTop - lidT * 0.3),
    ]), 24, tubeR * 0.9, 6, false));

    // the strike rail in the hooks (M-03's notch Ø 8 at r 194, 48 up an arm), open between two arms
    const { rRail, railR } = sh, gap = Math.max(0.05, mk(25) / rRail);
    frame.push(new THREE.TorusGeometry(rRail, railR, 6, 120, TAU - gap).rotateX(Math.PI / 2).rotateY(-gap / 2 - RAIL_GAP_AZ).translate(0, sh.railY, 0));

    group.add(merged(frame, alu), merged(dark, black), merged(cu, copper));

    // three lamps in the middle of its front face (toward +x): a lens each, lit by the engine (GfxCoil)
    const ledR = clamp(mk(15), 0.01, 0.024), ledGap = Math.min(ledR * 2.8, hb / 3.2), ledY = yMid;
    const lens = new THREE.CylinderGeometry(ledR, ledR, ledR * 0.8, 16).rotateZ(Math.PI / 2);
    const lamp = (color: number, k: number) => {
      // kept out of the tone mapping: lit, a lamp keeps its colour instead of going white
      const m = new THREE.Mesh(lens.clone(), new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.25), roughness: 0.3, emissive: color, emissiveIntensity: 0, toneMapped: false,
      }));
      // one above the other: red on top, blue, green at the bottom
      m.position.set(half + ledR * 0.4, ledY + (k - 1) * ledGap, 0);
      group.add(m);
      return m;
    };
    const leds = { power: lamp(GFX_PALETTE.lamp.power, 0), signal: lamp(GFX_PALETTE.lamp.signal, 1), ocd: lamp(GFX_PALETTE.lamp.ocd, 2) };
    lens.dispose();


    this.group = group;
    this.priY = priY;
    this.boxTop = boxTop;
    this.hubTop = hubTop;
    this.corner = half * Math.SQRT2;
    this.outerR = Math.max(this.corner, rE, rRail + railR);
    this.rIn = rIn;
    this.rOut = rOut;
    this.tubeR = tubeR;
    this.turns = turns;
    this.tap = tap;
    this.tapTurns = tapTurns;
    this.leds = leds;
  }

  /** From the axis to the box's side along an azimuth (rad, in its frame), where a cable meets it (m). */
  footAt(th: number): number {
    return this.half / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));
  }
}
