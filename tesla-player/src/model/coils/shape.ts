import type { CoilSpec } from './spec';

/** The CAD's primary: the sheet's od that its arms' cradles carry (r 80 to 171). */
const REF_OD = 336;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mm = (v: number) => v / 1000;

/**
 * A coil's shape from its sheet, in metres up from the floor and out from its
 * axis: what the 3D builds (engine/gfx/coil) and the sheet's side view draws,
 * so both are the same coil. The base follows the club's small coil's CAD
 * (plans A-01, A-02 box, M-01 primary base, M-02 disc, M-03 arms, M-17 lid),
 * scaled by the primary's diameter across, its heights fitted to the sheet's
 * stand; then the secondary on its foot, the topload on its hub (a torus, or
 * rings of tube on the outer half of the torus' envelope), the sheet's
 * outlet tube on its rim.
 */
export class PhyCoilShape {
  /** The CAD's scale across (by the primary's od) and up (fitted to the stand). */
  readonly k: number;
  readonly v: number;
  /** The primary's plane (the sheet's stand). */
  readonly priY: number;
  /** The spiral: its tube's radius, its pitch, its centre line's inner and outer radius, its turns. */
  readonly tubeR: number;
  readonly pitch: number;
  readonly rIn: number;
  readonly rOut: number;
  readonly turns: number;
  /** The base's hub (M-01): its body's, its flange's and its disc's radius; its body's top. */
  readonly hubR: number;
  readonly flR: number;
  readonly discR: number;
  readonly bodyTop: number;
  /** The arms' underside at the hub, the box's lid's top, the hub's disc top. */
  readonly armBot: number;
  readonly boxTop: number;
  readonly hubTop: number;
  /** Half the box's width; its lid's thickness, its band's (its fibre cap's colour, under the lid). */
  readonly half: number;
  readonly lidT: number;
  readonly bandH: number;
  /** The arms' hook (its outer edge), the strike rail in it: its radius, its tube's, its height. */
  readonly rE: number;
  readonly rRail: number;
  readonly railR: number;
  readonly railY: number;
  /** The secondary: radius, height, foot and top. */
  readonly secR: number;
  readonly secH: number;
  readonly secY0: number;
  readonly topY: number;
  /** The topload: outer diameter, thickness, centre's height; the hub that holds it (its radius, bottom and top). */
  readonly D: number;
  readonly d: number;
  readonly topCenterY: number;
  readonly topHubR: number;
  readonly topHubLo: number;
  readonly topHubHi: number;

  constructor(readonly spec: CoilSpec) {
    const k = spec.pri.od / REF_OD;
    // across, the CAD scaled by the primary; up, its 82 from lid to primary plane, squeezed so the box keeps 45 % of the stand
    const v = clamp((0.55 * spec.stand) / 82, 0.05, k);
    this.k = k;
    this.v = v;
    const priY = mm(spec.stand);
    this.priY = priY;

    // the spiral: M-03's tube Ø 9.5 at a 13 pitch, its inner turn clear of the hub
    const tubeD = clamp(9.5 * k, 5, 20);
    this.tubeR = mm(tubeD / 2);
    this.pitch = mm((tubeD * 13) / 9.5);
    this.secR = mm(spec.sec.d / 2);
    this.rOut = mm(spec.pri.od / 2);
    // M-01's body Ø 143 is the secondary's Ø 100 plus its foot's screws: a wider secondary widens it
    this.hubR = Math.max(this.mk(71.65), this.secR + this.mk(21.65));
    this.flR = this.hubR * (97.5 / 71.65);
    this.discR = this.hubR - this.mk(1.65);
    this.rIn = Math.min(Math.max(this.hubR + this.tubeR + this.mk(4), this.rOut * 0.47), this.rOut - this.pitch);
    this.turns = Math.max(1, (this.rOut - this.rIn) / this.pitch);

    // heights from M-01 and M-03: the arms on the hub's body 50 above the lid, the tube's centre 32 up an arm
    this.armBot = priY - this.mv(32);
    this.boxTop = this.armBot - this.mv(50);
    this.hubTop = this.armBot + this.mv(50.5);
    this.bodyTop = this.armBot + this.mv(35.5);
    this.half = Math.max(this.mk(153), this.flR + this.mk(12));
    this.lidT = Math.min(clamp(this.mk(18), 0.012, 0.03), this.boxTop * 0.15);
    this.bandH = clamp(this.mk(10), 0.006, 0.016);
    this.rE = this.rOut + this.mk(29);
    // the strike rail in the hooks (M-03's notch Ø 8 at r 194, 48 up an arm)
    this.rRail = this.rOut + this.mk(23);
    this.railR = clamp(this.mk(4), 0.0025, 0.01);
    this.railY = this.armBot + this.mv(48);

    this.secH = mm(spec.sec.h);
    this.secY0 = priY + 0.012;
    this.topY = this.secY0 + this.secH;
    this.D = mm(spec.top.D);
    this.d = mm(spec.top.d);
    this.topCenterY = this.topY + this.d / 2 + 0.01;
    // a hub on the form's top: rings ride on arms notched for them, a torus closes its hole with a disc bolted on it
    this.topHubR = Math.max(this.secR, 0.03);
    this.topHubLo = this.topY + 0.025;
    this.topHubHi = this.topCenterY + 0.025;
  }

  /** A CAD size across, or up (mm of the CAD), in metres at this coil's scale. */
  mk(x: number): number {
    return mm(x * this.k);
  }

  mv(x: number): number {
    return mm(x * this.v);
  }

  /** An arm's side (M-03, its cradles left out): out from the axis and up from the arms' underside, its outline. */
  get armSide(): [number, number][] {
    const r0 = this.hubR - this.mk(16.65), rB = this.rOut + this.mk(11), rE = this.rE, yB = this.mv(17.5), yH = this.mv(50);
    return [
      [r0, 0], [this.rIn, 0], [rB, yB], [rE, this.mv(37)], [rE, yH - this.mv(2)], [rE - this.mk(2), yH],
      [this.rOut + this.mk(17), yH], [this.rOut + this.mk(14), this.mv(35)], [r0, this.mv(35)],
    ];
  }

  /** Where the arms' underside curves up to the hook: the quadratic's control point. */
  get armCurve(): [number, number] {
    const rB = this.rOut + this.mk(11), yB = this.mv(17.5);
    return [this.rE, yB + ((this.rE - rB) * yB) / (rB - this.rIn)];
  }

  /** The topload's rings: each one's centre line radius and height, its tube's radius; none for a torus. */
  get rings(): { r: number; y: number; tubeR: number }[] {
    const rings = this.spec.top.rings;
    if (!rings || rings.n <= 1) return [];
    const tube = mm(rings.tube), n = rings.n, R = (this.D - this.d) / 2, rc = this.d / 2 - tube / 2;
    return Array.from({ length: n }, (_, i) => {
      const th = -Math.PI / 2 + (Math.PI * i) / (n - 1);
      return { r: R + rc * Math.cos(th), y: this.topCenterY + rc * Math.sin(th), tubeR: tube / 2 };
    });
  }

  /** A tube on the topload's rim at a tilt (degrees up from flat), len and Ø in mm: its base and its tip (the bevel's), out and up. */
  rimTube(len: number, tilt: number, diameter = this.spec.pin.d): { base: [number, number]; tip: [number, number]; radius: number } {
    const a = Math.max(mm(diameter) / 2, 0.002), t = (tilt * Math.PI) / 180, l = mm(len) + a * 4;
    const base: [number, number] = [this.D / 2 - 0.02, this.topCenterY];
    return { base, tip: [base[0] + Math.cos(t) * l, base[1] + Math.sin(t) * l], radius: a };
  }
}
