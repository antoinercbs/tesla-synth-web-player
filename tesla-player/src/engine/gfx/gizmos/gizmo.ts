import * as THREE from 'three';
import { disposeTree } from '../dispose';

/** What a handle does when the hand takes it. */
export type GripKind = 'move' | 'moveX' | 'moveZ' | 'turn' | 'aim' | 'tube' | 'tilt' | 'ringD' | 'ringY' | 'cageW' | 'cageD' | 'cageH';
export interface Grip { kind: GripKind; tube?: number }

/** The handles' colours: what moves or turns, the bright ones (a tip, a lit arrow, the notches), the ones that size, the chosen one. */
export interface HandleColors { grip: THREE.ColorRepresentation; bright: THREE.ColorRepresentation; size: THREE.ColorRepresentation; chosen: THREE.ColorRepresentation }

export type KnobShape = 'ball' | 'arrow' | 'cube';

// an up-and-down arrow, turned about its axis
const ARROW = [[0, -1.7], [0.85, -0.45], [0.32, -0.45], [0.32, 0.45], [0.85, 0.45], [0, 1.7]].map(([x, y]) => new THREE.Vector2(x, y));

/**
 * Handles on the picture, to set a scene with: drawn over everything (no
 * depth test) and kept as they are (no tone mapping), in colours none of the
 * fibre caps' (those name the outputs). Their shapes tell what they do: a
 * ball goes anywhere, an arrow up or down, a cube sizes. One with a `size`
 * keeps it on the screen (px). Built in the scene's frame.
 */
export abstract class GfxGizmo {
  readonly group = new THREE.Group();

  constructor(protected readonly colors: HandleColors) {}

  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group);
  }

  protected material(color: THREE.ColorRepresentation, opacity = 0.95): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity, toneMapped: false });
  }

  /** A piece of it: what the hand takes it for (none: only seen), its size on the screen, drawn over what is under it. */
  protected put(m: THREE.Mesh, grip: Grip | null, size?: number, order = 10): THREE.Mesh {
    m.userData = { ...(grip ? { grip } : {}), ...(size ? { size } : {}) };
    m.renderOrder = order;
    this.group.add(m);
    return m;
  }

  /** A knob at a point. */
  protected knob(p: THREE.Vector3, color: THREE.ColorRepresentation, grip: Grip, size = 9, shape: KnobShape = 'ball'): THREE.Mesh {
    const geo = shape === 'arrow' ? new THREE.LatheGeometry(ARROW, 12) : shape === 'cube' ? new THREE.BoxGeometry(1.5, 1.5, 1.5) : new THREE.SphereGeometry(1, 16, 12);
    const m = new THREE.Mesh(geo, this.material(color));
    m.position.copy(p);
    return this.put(m, grip, size);
  }
}
