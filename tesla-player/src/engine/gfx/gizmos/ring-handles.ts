import * as THREE from 'three';
import type { TubeSpec } from '@/model/coils/physics';
import type { GfxCoilBody } from '../coil/body';
import type { StageCoil } from '../types';
import { GfxGizmo, type HandleColors } from './gizmo';

const D2R = Math.PI / 180;

/** A coil's grounded ring: its edge between two points (its size), and above it (its height). */
export class GfxRingHandles extends GfxGizmo {
  constructor(colors: HandleColors, body: GfxCoilBody, sc: StageCoil, tubes: readonly TubeSpec[]) {
    super(colors);
    const ring = body.ring!, n = Math.max(1, ring.tips.length), a0 = sc.azimuth + ((tubes.find((t) => !t.center)?.az ?? 0) + 180 / n) * D2R;
    const edge = ring.center.clone().add(new THREE.Vector3(Math.cos(a0), 0, Math.sin(a0)).multiplyScalar(ring.R));
    this.knob(edge, colors.size, { kind: 'ringD' }, 7, 'cube');
    this.knob(edge.clone().addScaledVector(body.up, 0.13), colors.size, { kind: 'ringY' }, 6, 'arrow');
  }
}
