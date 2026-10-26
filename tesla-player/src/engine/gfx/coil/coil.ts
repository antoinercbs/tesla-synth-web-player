import * as THREE from 'three';
import { PhyCoil, type StrikeTarget } from '@/model/coils/physics';
import { PhyCoilPlacement, type PhySceneThings } from '@/model/coils/staging';
import { GfxArcField } from '../arcs/field';
import { GFX_PALETTE } from '../palette';
import type { GfxShared } from '../shared';
import type { ArcState, SceneColors, StageCoil } from '../types';
import { GfxCoilBody } from './body';
import { GfxDischarge } from './discharge';
import { GfxGroundMat } from './ground-mat';
import { GfxReachRing } from './reach-ring';
import { disposeTree } from '../dispose';

/** What a coil needs of the scene it stands in. */
export interface GfxCoilHost {
  readonly shared: GfxShared;
  readonly colors: SceneColors;
  /** The scene's things on the floor, now. */
  readonly things: PhySceneThings;
  /** Where a hung coil's base is (m). */
  readonly ceiling: number;
  /** The size of a screen pixel at a point (m). */
  pixelAt(p: THREE.Vector3): number;
  /** How many bangs an image holds at most, now. */
  bangsCap(): number;
  /** Each coil's reach drawn around its tip (the coil sheet's). */
  readonly reachRing: boolean;
}

export interface GfxCoilOptions {
  /** One of a stage's: its mat smaller. */
  many: boolean;
  state: ArcState;
  /** Its field worked out: not while a hand drags it. */
  withField: boolean;
}

/**
 * A coil on the stage: its body, its ground mat when it stands on the floor,
 * its field and its arcs, lit by them (a light that follows them, a flash
 * where they strike, a glow on each firing tip) and by its box's lamps.
 */
export class GfxCoil {
  /** All of it, in the scene's frame (left where it is: its parts are placed themselves). */
  readonly group = new THREE.Group();
  readonly body: GfxCoilBody;
  readonly mat: GfxGroundMat | null;
  /** Its field, worked out when it is placed; null while a hand drags it. */
  readonly field: GfxArcField | null;
  /** What each source's strikes land on (the physics': the nearest grounded thing). */
  readonly targets: StrikeTarget[];
  state: ArcState;
  private readonly discharge: GfxDischarge;
  /** Each tube's tip while it fires: a soft white glow, and the faint violet corona around it (sprites: they face the camera). */
  private readonly glows: { glow: THREE.Sprite; corona: THREE.Sprite }[];
  private readonly arcLight: THREE.PointLight;
  private readonly hitLight: THREE.PointLight;
  private ring: GfxReachRing | null = null;
  /** The signal's and the OCD's lamps' halos: seen from across the hall, as a lit lamp is. */
  private readonly halos: { signal: THREE.Sprite; ocd: THREE.Sprite };

  constructor(readonly sc: StageCoil, private readonly host: GfxCoilHost, o: GfxCoilOptions) {
    this.state = o.state;
    const things = host.things, y0 = sc.hang ? 0 : things.topUnder(sc.x, sc.z ?? 0);
    this.body = new GfxCoilBody(sc, host.ceiling, y0);
    this.group.add(this.body.group);
    // a standing coil's local ground mat under its tips; on a table, the floor far under it
    this.mat = !this.body.hung && !y0 ? new GfxGroundMat(this.body, o.many, host.colors.mat, host.shared.matCell) : null;
    if (this.mat) this.group.add(this.mat.group);
    this.discharge = new GfxDischarge(this, host);
    this.glows = this.body.tubes.map((t) => {
      const glow = new THREE.Sprite(host.shared.tip(GFX_PALETTE.spark.tip, 0.9)), corona = new THREE.Sprite(host.shared.tip(GFX_PALETTE.spark.corona, 0.3));
      for (const sp of [glow, corona]) {
        sp.position.copy(t.tip);
        sp.visible = false;
        this.group.add(sp);
      }
      return { glow, corona };
    });
    const halo = (lamp: THREE.Mesh, color: number) => {
      // on the lens's face, its size a few lenses'
      const r = (lamp.geometry as THREE.CylinderGeometry).parameters.radiusTop, sp = new THREE.Sprite(host.shared.tip(color, 1));
      sp.position.set(r * 0.5, 0, 0);
      sp.scale.setScalar(r * 9);
      sp.visible = false;
      lamp.add(sp);
      return sp;
    };
    this.halos = { signal: halo(this.body.leds.signal, GFX_PALETTE.lamp.signal), ocd: halo(this.body.leds.ocd, GFX_PALETTE.lamp.ocd) };
    this.arcLight = new THREE.PointLight(GFX_PALETTE.spark.arcLight, 0, 0, 2);
    this.hitLight = new THREE.PointLight(GFX_PALETTE.spark.hitLight, 0, 2.5 * (this.body.big ? 1.8 : 1), 2);
    this.group.add(this.arcLight, this.hitLight);
    const phy = new PhyCoil(sc.spec), tubes = sc.tubes ?? GfxCoilBody.sheetTubes(sc.spec);
    const placed = new PhyCoilPlacement(phy, { x: sc.x, z: sc.z ?? 0, azimuth: sc.azimuth, hang: sc.hang, y: y0 }, host.ceiling);
    this.targets = phy.targets(tubes, { ring: sc.ring, ...placed.around(things) });
    this.field = o.withField ? this.fieldOf(Math.max(sc.reach ?? 0, o.state.reach, 0.5)) : null;
  }

  /** Where its arcs leave first: for the light and the pixel's size. */
  get firstTip(): THREE.Vector3 {
    return this.body.tubes[0]?.tip ?? this.body.top;
  }

  /** Whether a strike is drawn on it now. */
  get striking(): boolean {
    return this.discharge.striking;
  }

  /** This image's channels, each a path (the faint leaks and streamers left out). */
  get arcPaths(): readonly (readonly THREE.Vector3[])[] {
    return this.discharge.drawn;
  }

  /** The scene's counter-point whose tip is nearest a point: its tip and its rod's back; null: none. */
  counterNear(p: THREE.Vector3): { tip: THREE.Vector3; back: THREE.Vector3 } | null {
    const ends = this.host.things.nearestCounter([p.x, p.y, p.z])?.ends;
    return ends ? { tip: new THREE.Vector3(...ends.tip), back: new THREE.Vector3(...ends.back) } : null;
  }

  /** Its arcs for this image, and their light. */
  draw(): void {
    const bangs = this.discharge.draw(), st = this.state, b = this.body;
    // each tip: its glow and its corona, a few pixels at least, flickering from image to image
    const on = st.on && st.reach > 0 && !!this.field, k = b.big ? 1.8 : 1, from = this.firstTip, px = this.host.pixelAt(from);
    // the arcs' light: from the middle of their fan, as bright as they are long and many, flickering.
    // Dimmed to 0, never hidden: a light shown or hidden recompiles every material's shader
    const reach = st.reach, out = b.tubes[0]?.axis ?? b.up;
    this.arcLight.position.copy(from).addScaledVector(out, reach * 0.45).add(new THREE.Vector3(0, -reach * 0.1, 0));
    this.arcLight.intensity = on ? (0.15 + 0.3 * reach) * (0.7 + 0.6 * Math.random()) * bangs ** 0.2 : 0;
    const hit = this.discharge.hit;
    if (hit) this.hitLight.position.copy(hit).add(new THREE.Vector3(0, 0.12 * k, 0));
    this.hitLight.intensity = hit ? 0.8 * k * (0.75 + 0.5 * Math.random()) : 0;
    if (this.host.reachRing && !this.ring) {
      this.ring = new GfxReachRing(this.host.shared);
      this.group.add(this.ring.sprite);
    }
    this.ring?.place(from, reach, this.host.reachRing);
    for (const { glow, corona } of this.glows) {
      glow.visible = corona.visible = on;
      if (!on) continue;
      glow.scale.setScalar(Math.max(0.03 * k, 7 * px) * (0.85 + 0.3 * Math.random()));
      glow.material.opacity = 0.75 + 0.25 * Math.random();
      corona.scale.setScalar(Math.max(0.11 * k, 22 * px) * (0.8 + 0.4 * Math.random()));
      corona.material.opacity = 0.18 + 0.17 * Math.random();
    }
  }

  /** The box's lamps: powered always; blue while it plays, red while its OCD trips, those two with a halo. */
  light(): void {
    const l = this.body.leds, st = this.state;
    const lit = (m: THREE.Mesh, on: boolean, k: number) => { (m.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? k : 0; };
    const signal = st.on, ocd = st.on && !!st.ocd;
    lit(l.power, true, 1.3);
    lit(l.signal, signal, 2.4);
    lit(l.ocd, ocd, 2.4);
    this.halos.signal.visible = signal;
    this.halos.ocd.visible = ocd;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.discharge.dispose();
    for (const { glow, corona } of this.glows) for (const sp of [glow, corona]) sp.material.dispose();
    for (const sp of [this.halos.signal, this.halos.ocd]) sp.material.dispose();
    for (const l of [this.arcLight, this.hitLight]) l.dispose();
    this.ring?.dispose();
    disposeTree(this.body.group);
    this.mat?.dispose();
  }

  private fieldOf(reach: number): GfxArcField {
    const b = this.body;
    return new GfxArcField({
      tubes: b.tubes, top: b.top, ringR: b.ringR, topR: b.topR, up: b.up, matY: this.mat?.y ?? 0, ring: b.ring, counter: this.counterNear(b.top), mesh: this.host.things.mesh,
    }, reach);
  }
}
