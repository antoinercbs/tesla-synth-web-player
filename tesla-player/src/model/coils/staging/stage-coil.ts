import type { CoilSpec } from '@/model/coils/spec';
import type { GroundRing, TubeSpec } from '../physics';

/** A coil as the 3D draws it: its sheet, where a scene puts it, its tubes and its ring. */
export interface StageCoil {
  spec: CoilSpec;
  /** Where it stands (m): x across the stage, z toward the audience. */
  x: number;
  z?: number;
  /** How it is turned (rad, 0: its front toward +x, π/2: toward the audience): its tubes' angles count from its front. */
  azimuth: number;
  /** Its outlet tubes; none given: the sheet's, at its front; empty: none, the crown fires. */
  tubes?: TubeSpec[];
  ring?: GroundRing | null;
  /** Hung head down from the ceiling. */
  hang?: boolean;
  /** The longest reach its arcs will have (m): the view is framed with them. */
  reach?: number;
  /** Its fibre cap's colour (CSS), worn by a band on its base; none: no band. */
  color?: string;
}

/** What a coil's arcs do now, as the physics says (the 3D draws them). */
export interface ArcState {
  /** Off: no arc (the coil silent). */
  on: boolean;
  /** How far the sparks go (m); each source's (its tubes in order, or its crown) when they differ. */
  reach: number;
  reaches?: number[];
  strike: 'air' | 'strike';
  /** Which source strikes; none: the one nearest the ground. */
  strikeFrom?: number;
  /** The bangs it fires a second; none: one a image. */
  bangHz?: number;
  /** Each bang's energy, from none to the coil's strongest (0..1); none: in between. */
  energy?: number;
  /** Its OCD trips (its bangs end on it, or strike): the box's red lamp. */
  ocd?: boolean;
}
