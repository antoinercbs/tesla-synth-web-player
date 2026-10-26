import type { TubeSpec } from '@/model/coils/physics';
import type { GfxCoilBody } from '../coil/body';
import { GfxGizmo, type HandleColors } from './gizmo';

/** Each tube's tip (the chosen one in the accent): around the toroid and out (or up, for an upright one); just past it, its tilt. */
export class GfxTubeHandles extends GfxGizmo {
  constructor(colors: HandleColors, body: GfxCoilBody, tubes: readonly TubeSpec[], chosen: number) {
    super(colors);
    body.tubes.forEach((t, j) => {
      this.knob(t.tip, j === chosen ? colors.chosen : colors.bright, { kind: 'tube', tube: j });
      if (!tubes[j]?.center) this.knob(t.tip.clone().addScaledVector(body.up, 0.1), colors.size, { kind: 'tilt', tube: j }, 6, 'arrow');
    });
  }
}
