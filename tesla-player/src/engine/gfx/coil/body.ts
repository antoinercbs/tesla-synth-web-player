import * as THREE from 'three';
import type { CoilSpec } from '@/model/coils/spec';
import { PhyCoil, PhyRingShape, type TubeSpec } from '@/model/coils/physics';
import { PhyCoilShape } from '@/model/coils/shape';
import { css, GFX_PALETTE } from '../palette';
import type { StageCoil } from '../types';
import { GfxCoilBase } from './base';
import { earthCable } from './cable';

/**
 * A coil in 3D, drawn from its sheet at true scale and posed as a scene puts
 * it: the flat spiral primary on its arms with its tap's clamp, the
 * varnished secondary, the topload (a torus, or rings of tube on arms) and
 * its outlet tubes (on the rim at their angles, or one upright at the
 * centre), a band on the base in its fibre cap's colour, the grounded ring if
 * it has one; standing on the floor (or a table), or hung head down with its
 * base at the ceiling. Built in its own frame (its front along +x), then placed: what the
 * arcs need comes out in the scene's frame.
 */

const D2R = Math.PI / 180;

export class GfxCoilBody {
  readonly group: THREE.Group;
  readonly big: boolean;
  readonly hung: boolean;
  /** Its tubes, in the scene's frame: tip, axis (unit, out), base on the topload, length. */
  readonly tubes: { tip: THREE.Vector3; axis: THREE.Vector3; base: THREE.Vector3; len: number }[];
  /** The topload: its centre, its axis (from the base through it: down when hung), its ring's radius and its outer one. */
  readonly top: THREE.Vector3;
  readonly up: THREE.Vector3;
  readonly ringR: number;
  readonly topR: number;
  /** Its grounded ring: centre, tube's centre line and radius, its points' tips and their axes (toward the topload). */
  readonly ring: { center: THREE.Vector3; R: number; a: number; tips: THREE.Vector3[]; dirs: THREE.Vector3[] } | null;
  /** Where its base stands (m): the floor, a table's top, the ceiling. */
  readonly baseY: number;
  /** Its highest and lowest points (m), how far it spreads around its axis (its ring included), and its tubes' reach out. */
  readonly height: number;
  readonly low: number;
  readonly outer: number;
  readonly width: number;
  /** The lamps on its box: powered, signal, OCD. */
  readonly leds: { power: THREE.Mesh; signal: THREE.Mesh; ocd: THREE.Mesh };
  /** Its body, for the pointer (the ring left out). */
  readonly box: THREE.Box3;

  /** The sheet's tube, at its front: what a coil has when no scene says otherwise. */
  static sheetTubes(spec: CoilSpec): TubeSpec[] {
    return [{ az: 0, len: spec.pin.h, tilt: spec.pin.tilt }];
  }

  /** Posed as `sc` says: under a ceiling at that height (hung), or on what its base stands on (y0). */
  constructor(sc: StageCoil, ceiling: number, y0 = 0) {
    const { spec } = sc;
    const g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    const hung = !!sc.hang;
    // turned over, a coil's angles would read mirrored from above: hung, they are mirrored first
    const side = hung ? -1 : 1;
    const tubes = sc.tubes ?? GfxCoilBody.sheetTubes(spec);
    const az0 = side * (tubes.find((t) => !t.center)?.az ?? 0) * D2R;
    const copper = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.copper, metalness: 0.75, roughness: 0.35 });
    const alu = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.aluminium, metalness: 0.45, roughness: 0.3 });
    const mm = (v: number) => v / 1000;
    // the layout, the sheet's side view's too (model/coils/shape.ts)
    const sh = new PhyCoilShape(spec);

    // the base: its box, the primary on its arms, the tap (GfxCoilBase)
    const base = new GfxCoilBase(spec, { color: sc.color, copper, alu });
    body.add(base.group);
    const big = spec.pri.od > 500;

    // the secondary: its form and its winding (a texture of turns)
    const { secR, secH, secY0 } = sh;
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 512;
    const cx = cv.getContext('2d');
    if (cx) {
      cx.fillStyle = css(GFX_PALETTE.winding.base);
      cx.fillRect(0, 0, 64, 512);
      for (let y = 0; y < 512; y += 4) {
        cx.fillStyle = css(y % 8 ? GFX_PALETTE.winding.light : GFX_PALETTE.winding.dark);
        cx.fillRect(0, y, 64, 2);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, Math.max(2, spec.sec.h / 30));
    tex.colorSpace = THREE.SRGBColorSpace;
    // its turns in relief under a coat of varnish
    const sec = new THREE.Mesh(new THREE.CylinderGeometry(secR, secR, secH, 48, 1, true), new THREE.MeshPhysicalMaterial({
      map: tex, bumpMap: tex, bumpScale: 1.2, metalness: 0.55, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.12,
    }));
    sec.position.y = secY0 + secH / 2;
    body.add(sec);
    const form = new THREE.Mesh(new THREE.CylinderGeometry(secR * 0.96, secR * 0.96, secH + 0.06, 48), new THREE.MeshStandardMaterial({ color: GFX_PALETTE.plastic.form, roughness: 0.8 }));
    form.position.y = secY0 + secH / 2;
    body.add(form);

    // the topload: rings of tube on the outer half of the torus' envelope, or the torus
    const { D, d, topCenterY } = sh;
    // what holds it: a hub on the form's top; rings ride on radial arms notched for them (Ampère's: 5 of
    // MDF, 18 mm, on a hub Ø 100), a torus closes its hole with a disc bolted on the hub
    const hubR = sh.topHubR, hubLo = sh.topHubLo, hubHi = sh.topHubHi;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubHi - hubLo, 32), new THREE.MeshStandardMaterial({ color: GFX_PALETTE.plastic.hub, roughness: 0.6 }));
    hub.position.y = (hubLo + hubHi) / 2;
    body.add(hub);
    if (spec.top.rings && spec.top.rings.n > 1) {
      const tube = mm(spec.top.rings.tube), n = spec.top.rings.n;
      const R = (D - d) / 2, rc = d / 2 - tube / 2;
      for (let i = 0; i < n; i++) {
        const th = -Math.PI / 2 + (Math.PI * i) / (n - 1);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R + rc * Math.cos(th), tube / 2, 12, 120), alu);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = topCenterY + rc * Math.sin(th);
        body.add(ring);
      }
      // an arm's side: low at the hub, its outer edge round along the rings' inner faces
      const inner = rc - tube / 2, h0 = Math.min(0.025, inner * 0.5), mid = (hubR + R) / 2;
      const shape = new THREE.Shape();
      shape.moveTo(hubR, -h0);
      shape.quadraticCurveTo(mid, -h0 * 0.6, R, -inner);
      shape.absarc(R, 0, inner, -Math.PI / 2, Math.PI / 2, false);
      shape.quadraticCurveTo(mid, h0 * 0.6, hubR, h0);
      shape.closePath();
      const thick = Math.min(0.03, Math.max(0.012, D * 0.0385));
      const sideGeo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -thick / 2);
      // painted black, as the hub and the base's printed parts
      const mdf = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.plastic.printed, roughness: 0.7 });
      for (let i = 0; i < 5; i++) {
        const arm = new THREE.Mesh(sideGeo, mdf);
        arm.rotation.y = -(az0 + ((i + 0.5) / 5) * Math.PI * 2);
        arm.position.y = topCenterY;
        body.add(arm);
      }
    } else {
      const tor = new THREE.Mesh(new THREE.TorusGeometry((D - d) / 2, d / 2, 32, 96), alu);
      tor.rotation.x = Math.PI / 2;
      tor.position.y = topCenterY;
      body.add(tor);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 - d * 0.7, D / 2 - d * 0.7, 0.008, 64), alu);
      disc.position.y = topCenterY;
      body.add(disc);
    }

    // the outlet tubes, cut in a bevel: on the rim at their angles, tilted; or upright on the hub
    const up = new THREE.Vector3(0, 1, 0), radius = (t: TubeSpec) => Math.max(mm(t.d ?? spec.pin.d) / 2, 0.002);
    const local = tubes.map((t) => {
      const h = mm(t.len), a = radius(t);
      let axis: THREE.Vector3, base: THREE.Vector3;
      if (t.center) {
        axis = up.clone();
        base = new THREE.Vector3(0, hubHi, 0);
      } else {
        const th = side * t.az * D2R, tilt = t.tilt * D2R, flat = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
        axis = flat.clone().multiplyScalar(Math.cos(tilt)).setY(Math.sin(tilt));
        base = flat.clone().multiplyScalar(D / 2 - 0.02).setY(topCenterY);
      }
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(a, a, h, 16), alu);
      rod.quaternion.setFromUnitVectors(up, axis);
      rod.position.copy(base).addScaledVector(axis, h / 2);
      const bevel = new THREE.Mesh(new THREE.ConeGeometry(a, a * 4, 16), alu);
      bevel.quaternion.setFromUnitVectors(up, axis);
      bevel.position.copy(base).addScaledVector(axis, h + a * 2);
      body.add(rod, bevel);
      return { tip: base.clone().addScaledVector(axis, h + a * 4), axis, base, len: h + a * 4 };
    });

    // the grounded ring, its points turned toward the topload (one in line with the first tube), its cable to the base
    const rg = sc.ring ? new PhyRingShape(new PhyCoil(spec), sc.ring) : null;
    let ringLocal: { center: THREE.Vector3; R: number; a: number; tips: THREE.Vector3[]; dirs: THREE.Vector3[] } | null = null;
    if (rg) {
      const ringY = topCenterY + rg.y;
      const torus = new THREE.Mesh(new THREE.TorusGeometry(rg.R, rg.a, 12, 160), alu);
      torus.rotation.x = Math.PI / 2;
      torus.position.y = ringY;
      body.add(torus);
      const tips: THREE.Vector3[] = [], dirs: THREE.Vector3[] = [];
      if (rg.points) {
        const { root, tip: end, n } = rg.points, len = Math.hypot(end.r - root.r, end.y - root.y), pr = 0.005;
        const rodGeo = new THREE.CylinderGeometry(pr, pr, len, 10), bevelGeo = new THREE.ConeGeometry(pr, pr * 3, 10);
        for (let k = 0; k < n; k++) {
          const th = az0 + (k / n) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
          const from = new THREE.Vector3(root.r * c, topCenterY + root.y, root.r * sn), to = new THREE.Vector3(end.r * c, topCenterY + end.y, end.r * sn);
          const dir = to.clone().sub(from).normalize();
          const rod = new THREE.Mesh(rodGeo, alu);
          rod.quaternion.setFromUnitVectors(up, dir);
          rod.position.copy(from).lerp(to, 0.5);
          const cut = new THREE.Mesh(bevelGeo, alu);
          cut.quaternion.setFromUnitVectors(up, dir);
          cut.position.copy(to).addScaledVector(dir, pr * 1.5);
          body.add(rod, cut);
          tips.push(to.clone().addScaledVector(dir, pr * 3));
          dirs.push(dir);
        }
      }
      ringLocal = { center: new THREE.Vector3(0, ringY, 0), R: rg.R, a: rg.a, tips, dirs };
      // behind the coil; hung, the cable climbs to the base at the ceiling the same way
      const back = new THREE.Vector3(-Math.cos(az0 + 0.35), 0, -Math.sin(az0 + 0.35)), footR = base.footAt(az0 + 0.35 + Math.PI);
      body.add(earthCable([
        back.clone().multiplyScalar(rg.R).setY(ringY - rg.a),
        back.clone().multiplyScalar(rg.R * 0.99).setY(ringY * 0.5),
        back.clone().multiplyScalar(rg.R * 0.96).setY(0.012),
        back.clone().multiplyScalar(footR + 0.06).setY(0.008),
        back.clone().multiplyScalar(footR + 0.002).setY(0.03),
      ]));
    }
    // standing on the floor: the ground mat's cable, from the base to a clamp on the mesh
    if (!hung && !y0) {
      const matSide = new THREE.Vector3(-Math.cos(az0 - 0.4), 0, -Math.sin(az0 - 0.4)), footR = base.footAt(az0 - 0.4 + Math.PI);
      body.add(earthCable([
        matSide.clone().multiplyScalar(footR + 0.002).setY(0.03),
        matSide.clone().multiplyScalar(footR + 0.06).setY(0.01),
        matSide.clone().multiplyScalar(footR + 0.2).setY(0.008),
      ]));
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.02), new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.zinc, metalness: 0.8, roughness: 0.4 }));
      clamp.position.copy(matSide).multiplyScalar(footR + 0.21).setY(0.01);
      clamp.rotation.y = -Math.atan2(matSide.z, matSide.x);
      body.add(clamp);
    }

    // posed: where, turned, standing or hung head down with its base at the ceiling
    g.position.set(sc.x, hung ? ceiling : y0, sc.z ?? 0);
    g.rotation.y = -sc.azimuth;
    if (hung) body.rotation.x = Math.PI;
    g.updateMatrixWorld(true);
    const M = body.matrixWorld;
    const at = (v: THREE.Vector3) => v.clone().applyMatrix4(M), dir = (v: THREE.Vector3) => v.clone().transformDirection(M);
    const placed = local.map((t) => ({ tip: at(t.tip), axis: dir(t.axis), base: at(t.base), len: t.len }));
    const ring = ringLocal ? { center: at(ringLocal.center), R: ringLocal.R, a: ringLocal.a, tips: ringLocal.tips.map(at), dirs: ringLocal.dirs.map(dir) } : null;
    const top = at(new THREE.Vector3(0, topCenterY, 0));
    const ends = [at(new THREE.Vector3(0, 0, 0)), top.clone().add(new THREE.Vector3(0, hung ? -d / 2 : d / 2, 0)), ...placed.map((t) => t.tip), ...(ring ? [ring.center] : [])];
    const reachOut = placed.reduce((m, t) => Math.max(m, Math.hypot(t.tip.x - sc.x, t.tip.z - (sc.z ?? 0))), D / 2);
    const bodyR = Math.max(D / 2, base.outerR) + 0.05, ys = [at(new THREE.Vector3(0, 0, 0)).y, top.y + (hung ? -1 : 1) * d * 0.3];
    this.group = g;
    this.big = big;
    this.hung = hung;
    this.baseY = hung ? ceiling : y0;
    this.leds = base.leds;
    this.tubes = placed;
    this.top = top;
    this.up = dir(up);
    this.ringR = (D - d) / 2;
    this.topR = D / 2;
    this.ring = ring;
    this.height = Math.max(...ends.map((p) => p.y));
    this.low = Math.min(...ends.map((p) => p.y));
    this.outer = Math.max(reachOut, ring ? ring.R + ring.a : 0);
    this.width = reachOut;
    this.box = new THREE.Box3(new THREE.Vector3(sc.x - bodyR, Math.min(...ys), (sc.z ?? 0) - bodyR), new THREE.Vector3(sc.x + bodyR, Math.max(...ys), (sc.z ?? 0) + bodyR));
  }
}
