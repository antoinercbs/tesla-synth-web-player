import * as THREE from 'three';
import type { SceneKnight } from '@/model/coils/scene-data';
import { css, GFX_PALETTE } from '../palette';
import { armsAt, BEAT_S, mix, smooth } from './macarena';
import { GfxProp } from './prop';

/** Rows of rings, as the suit's aluminium rings lie: the mail's look, tiled. */
function mailTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  if (g) {
    g.fillStyle = css(GFX_PALETTE.knight.mailGap);
    g.fillRect(0, 0, 64, 64);
    g.lineWidth = 3;
    for (let row = 0; row < 5; row++) {
      for (let col = -1; col < 5; col++) {
        const x = col * 16 + (row % 2) * 8, y = row * 16;
        g.strokeStyle = css(GFX_PALETTE.knight.mailRing);
        g.beginPath();
        g.ellipse(x + 8, y, 6.5, 5, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A Faraday knight for the 3D scenes: someone in a mail suit of aluminium
 * rings (hauberk to mid-thigh, sleeves to the wrist, gloves, chausses: no
 * skin bare, as a suit that takes a strike must be), a bascinet down to the
 * neck with its pointed "pig-face" visor and its brass bands, a black belt,
 * blue canvas shoes; grounded, the arcs may land on them (PhyFaradayKnight).
 * They dance the Macarena: its sixteen counts at its record's tempo, a pose
 * on each count, the hips on the last four and a quarter turn with the jump.
 * Built in their own frame (facing +z, feet at 0), `h` tall.
 */
export class GfxKnight extends GfxProp<SceneKnight> {
  readonly kind = 'knight';
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[];
  private readonly arms: { shoulder: THREE.Group; elbow: THREE.Group; side: number }[];

  constructor(k: SceneKnight) {
    super(k);
    const s = k.h / 1.8, root = this.group, body = this.body;
    root.add(body);
    const tex = mailTexture();
    // rings of about a centimetre, as the suit's: the tiles' counts below are per 4 cm rings, hence the factor
    const mailOf = (rx: number, ry: number) => {
      const map = tex.clone();
      map.repeat.set(rx * 2.5, ry * 2.5);
      map.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ color: GFX_PALETTE.knight.mail, map, metalness: 0.8, roughness: 0.45 });
    };
    const steel = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.polished, metalness: 0.95, roughness: 0.18 });
    const brass = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.brass, metalness: 0.9, roughness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.knight.belt, roughness: 0.5 });
    const canvas = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.knight.canvas, roughness: 0.85 });
    const sole = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.knight.sole, roughness: 0.7 });
    const cyl = (rTop: number, rBot: number, len: number, mat: THREE.Material, seg = 14) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop * s, rBot * s, len * s, seg), mat);
      m.position.y = (-len * s) / 2;
      return m;
    };

    // the legs, from the hips: thigh, knee, shin, a canvas shoe
    const hips = this.hips;
    hips.position.y = 0.92 * s;
    body.add(hips);
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1 * s, 0, 0);
      hip.add(cyl(0.085, 0.07, 0.44, mailOf(3, 4)));
      const knee = new THREE.Group();
      knee.position.y = -0.44 * s;
      knee.add(cyl(0.068, 0.07, 0.42, mailOf(3, 4)));
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.27 * s), canvas);
      shoe.position.set(0, -0.42 * s - 0.035 * s, 0.05 * s);
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.105 * s, 0.025 * s, 0.28 * s), sole);
      sl.position.set(0, -0.42 * s - 0.07 * s, 0.05 * s);
      knee.add(shoe, sl);
      hip.add(knee);
      hips.add(hip);
      return { hip, knee };
    });

    // the hauberk: a skirt flaring over the thighs, the trunk, the belt
    const chest = this.chest;
    chest.position.y = 0.92 * s;
    body.add(chest);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.25 * s, 0.32 * s, 18, 1, true), mailOf(8, 2));
    skirt.position.y = -0.12 * s;
    (skirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.21 * s, 0.18 * s, 0.56 * s, 18), mailOf(8, 4));
    trunk.position.y = 0.28 * s;
    trunk.scale.z = 0.72;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.185 * s, 0.185 * s, 0.04 * s, 18), black);
    belt.position.y = 0.04 * s;
    belt.scale.z = 0.75;
    chest.add(skirt, trunk, belt);

    // the arms, from the shoulders: the sleeve all the way down, widening to the wrist; a glove of mail, its thumb apart
    const glove = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.knight.glove, map: tex.clone(), metalness: 0.85, roughness: 0.4 });
    glove.map!.repeat.set(2.5, 2.5);
    glove.map!.needsUpdate = true;
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24 * s, 0.53 * s, 0);
      shoulder.add(cyl(0.068, 0.064, 0.3, mailOf(3, 3)));
      const elbow = new THREE.Group();
      elbow.position.y = -0.3 * s;
      const sleeve = cyl(0.064, 0.082, 0.24, mailOf(3, 3), 14);
      (sleeve.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      elbow.add(sleeve);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085 * s, 0.11 * s, 0.045 * s), glove);
      palm.position.y = -0.3 * s;
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.025 * s, 0.06 * s, 0.03 * s), glove);
      thumb.position.set(-side * 0.05 * s, -0.27 * s, 0.015 * s);
      thumb.rotation.z = side * 0.35;
      const wrist = cyl(0.05, 0.05, 0.05, glove, 12);
      wrist.position.y = -0.235 * s;
      elbow.add(palm, thumb, wrist);
      shoulder.add(elbow);
      chest.add(shoulder);
      return { shoulder, elbow, side };
    });

    // the head: a coif of mail under a bascinet down to the neck, its skull rising to a point, its visor pushed out
    // to a ridge down its middle ("pig face") with two eye slits and breaths on its lower right, brass bands at the
    // brow and round its bottom edge
    const head = new THREE.Group();
    head.position.y = 0.6 * s;
    chest.add(head);
    const coif = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.17 * s, 0.1 * s, 16), mailOf(5, 1.5));
    coif.position.y = 0.03 * s;
    const prof = [[0.118, 0], [0.124, 0.05], [0.126, 0.12], [0.12, 0.2], [0.104, 0.27], [0.078, 0.33], [0.045, 0.375], [0.012, 0.4], [0.001, 0.405]];
    const skull = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * s, y * s)), 40), steel);
    skull.scale.z = 1.08;
    skull.position.y = 0.06 * s;
    const neckBand = new THREE.Mesh(new THREE.TorusGeometry(0.12 * s, 0.008 * s, 6, 40), brass);
    neckBand.rotation.x = Math.PI / 2;
    neckBand.scale.y = 1.08;
    neckBand.position.y = 0.065 * s;
    head.add(coif, skull, neckBand);

    // the visor: the front of a sphere round the face, drawn out toward its middle line
    const vR = 0.134 * s, vY = 0.17 * s, th0 = 0.36 * Math.PI, thL = 0.5 * Math.PI;
    const outOf = (x: number) => 1 + 0.6 * (1 - Math.min(1, Math.abs(x) / vR)) ** 2;
    const visorAt = (phi: number, theta: number, lift = 0): THREE.Vector3 => {
      const x = -(vR + lift) * Math.cos(phi) * Math.sin(theta), y = (vR + lift) * Math.cos(theta), z = (vR + lift) * Math.sin(phi) * Math.sin(theta);
      return new THREE.Vector3(x, vY + y, z * outOf(x));
    };
    const visorGeo = new THREE.SphereGeometry(vR, 40, 20, 0, Math.PI, th0, thL);
    const pos = visorGeo.attributes.position;
    for (let n = 0; n < pos.count; n++) pos.setZ(n, pos.getZ(n) * outOf(pos.getX(n)));
    visorGeo.computeVertexNormals();
    const visor = new THREE.Mesh(visorGeo, steel);
    visor.position.y = vY;
    head.add(visor);
    // its brass bands along its top and bottom edges
    for (const theta of [th0, th0 + thL]) {
      const pts = Array.from({ length: 25 }, (_, n) => visorAt((n / 24) * Math.PI, theta, 0.003 * s));
      head.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.007 * s, 6, false), brass));
    }
    // two eye slits under the brow, the breaths on the wearer's lower right
    const hole = (phi: number, theta: number, geo: THREE.BufferGeometry) => {
      const at = visorAt(phi, theta, 0.002 * s), m = new THREE.Mesh(geo, black);
      m.position.copy(at);
      m.lookAt(at.clone().add(new THREE.Vector3(at.x, 0, at.z).normalize()));
      head.add(m);
    };
    const slit = new THREE.PlaneGeometry(0.05 * s, 0.008 * s);
    for (const phi of [0.36 * Math.PI, 0.64 * Math.PI]) hole(phi, th0 + 0.09 * Math.PI, slit);
    const breath = new THREE.CircleGeometry(0.004 * s, 8);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) hole((0.26 + a * 0.05) * Math.PI, th0 + (0.3 + b * 0.05) * Math.PI, breath);
    this.animate(0);
  }

  /** Their pose at a moment (s from any start). */
  override animate(t: number): void {
    const s = this.box.h / 1.8;
      const beats = t / BEAT_S, cycle = Math.floor(beats / 16), count = Math.floor(beats) % 16, f = beats - Math.floor(beats);
      const [r1, l1] = armsAt(count), [r0, l0] = armsAt(count - 1 < 0 ? 15 : count - 1);
      const k1 = smooth(Math.min(1, f * 2));
      const pose = [mix(r0, r1, k1), mix(l0, l1, k1)];
      this.arms.forEach((a, i) => {
        const p = pose[i];
        // the arm hangs along −y: a flexion turns it forward (−x turn), a swing out turns it away from the body
        a.shoulder.rotation.set(-p.flex, 0, a.side * p.out, 'YXZ');
        a.elbow.rotation.set(-p.elbow, p.palm, 0, 'XYZ');
      });
      // the hips on counts 12-15, a jump and a quarter turn on the last
      const sway = count >= 12 ? Math.sin((beats - Math.floor(beats / 16) * 16 - 12) * Math.PI * 2) * 0.12 : 0;
      this.hips.rotation.z = sway;
      this.chest.rotation.z = -sway * 0.5;
      this.body.position.x = sway * 0.12 * s;
      const jump = count === 15 ? Math.sin(Math.min(1, f * 1.4) * Math.PI) : 0;
      this.body.position.y = jump * 0.12 * s;
      for (const l of this.legs) l.knee.rotation.x = jump * 0.6;
      const turns = cycle + (count === 15 ? smooth(Math.min(1, f * 1.4)) : 0);
      this.body.rotation.y = -turns * (Math.PI / 2);
  }
}
