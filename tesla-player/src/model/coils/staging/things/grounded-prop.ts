import type { SceneBox } from '../../scene-data';
import { PhyProp } from './prop';
import type { Nearest, P3 } from './types';

/** Something grounded on the floor, as the arcs see it: its nearest point to one, points of its surface for the field's charges. */
export abstract class PhyGroundedProp<B extends SceneBox = SceneBox> extends PhyProp<B> {
  abstract nearest(p: P3): Nearest;

  abstract samples(): P3[];
}
