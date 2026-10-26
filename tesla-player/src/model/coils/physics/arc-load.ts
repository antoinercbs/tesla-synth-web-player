export type ArcCorner = 'bas' | 'milieu' | 'haut';
export const ARC_CORNERS: ArcCorner[] = ['bas', 'milieu', 'haut'];

/** The bounds of the discharge physics: growth speed of a hot channel (m/s), capacitance per metre (F/m), gradient (V/m). */
export const ARC_BAND: Record<ArcCorner, { vGrow: number; cArc: number; eArc: number }> = {
  bas: { vGrow: 1.0e4, cArc: 3.3e-12, eArc: 2.5e5 },
  milieu: { vGrow: 1.5e4, cArc: 5.0e-12, eArc: 1.8e5 },
  haut: { vGrow: 2.0e4, cArc: 6.6e-12, eArc: 1.2e5 },
};

/** Where an arc leaves: its breakout (V), and the length that reaches the ground (m; null: none in reach). */
export interface ArcSource { vb: number; strikeLen: number | null }

/**
 * What the arcs cost a bang: the discharge physics at one of its corners,
 * where they leave (one arc, or one per outlet point: they share the top,
 * their loads add up, so the more there are, the shorter each), the
 * channel's resistance, the copper's Q, the hot core's cooling, a struck
 * channel's resistance and how long it stays conductive.
 */
export class PhyArcLoad {
  readonly vGrow: number;
  readonly cArc: number;
  readonly eArc: number;
  /** Channel resistance per metre (Ω/m), copper Q, the hot core's cooling time (s). */
  readonly rLin = 1.2e5;
  readonly qCu = 250;
  readonly tauC = 1e-3;
  /** A struck channel's resistance per metre and how long it stays conductive (s). */
  readonly rStrike = 2e4;
  readonly tauStrike = 10e-3;

  /** vb: the first arc's breakout (V); strikeLen: its length to the ground (m); arcs: several, in place of that one. */
  constructor(readonly corner: ArcCorner, readonly vb: number, readonly strikeLen: number | null = null, private readonly arcs?: readonly ArcSource[]) {
    const band = ARC_BAND[corner];
    this.vGrow = band.vGrow;
    this.cArc = band.cArc;
    this.eArc = band.eArc;
  }

  /** Its arcs: one per source. */
  get sources(): readonly ArcSource[] {
    return this.arcs ?? [{ vb: this.vb, strikeLen: this.strikeLen }];
  }
}
