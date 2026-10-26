import * as THREE from 'three';
import type { BoxKind, SceneBox, SceneCage, SceneCounter, SceneKnight, SceneTable } from '@/model/coils/scene-data';
import { PhySceneThings, type ThingsData } from '@/model/coils/staging';
import type { GfxShared } from '../shared';
import { GfxCage } from './cage';
import { GfxCounter } from './counter';
import { GfxKnight } from './knight';
import type { GfxProp } from './prop';
import { GfxTable } from './table';

/** Picked: a thing's kind, its index among its kind's, where the ray met it. */
export interface PropHit { kind: BoxKind; i: number; at: THREE.Vector3 }

/** Tried in this order: on a tie, the first. */
const PICK_ORDER: readonly BoxKind[] = ['cage', 'table', 'counter', 'knight'];

/** A scene's things on the floor, drawn: a view per thing, by kind, kept with the boxes they stand for. */
export class GfxProps {
  readonly group = new THREE.Group();
  private views: Record<BoxKind, GfxProp[]> = { table: [], cage: [], counter: [], knight: [] };
  /** The physics' view of them, as they are now. */
  private phy = new PhySceneThings();

  constructor(private readonly shared: GfxShared) {}

  /** Their boxes, as stored. */
  get data(): Required<ThingsData> {
    const boxes = <B extends SceneBox>(kind: BoxKind) => this.views[kind].map((v) => v.box as B);
    return { tables: boxes<SceneTable>('table'), cages: boxes<SceneCage>('cage'), counters: boxes<SceneCounter>('counter'), knights: boxes<SceneKnight>('knight') };
  }

  /** What the physics sees of them. */
  get things(): PhySceneThings {
    return this.phy;
  }

  count(kind: BoxKind): number {
    return this.views[kind].length;
  }

  box(kind: BoxKind, i: number): SceneBox | undefined {
    return this.views[kind][i]?.box;
  }

  /** All of them anew. */
  set(data: ThingsData): void {
    for (const v of Object.values(this.views).flat()) v.dispose();
    this.views = {
      table: (data.tables ?? []).map((b) => this.make('table', { ...b })),
      cage: (data.cages ?? []).map((b) => this.make('cage', { ...b })),
      counter: (data.counters ?? []).map((b) => this.make('counter', { ...b })),
      knight: (data.knights ?? []).map((b) => this.make('knight', { ...b })),
    };
    this.phy = new PhySceneThings(this.data);
  }

  /** One of them moved, turned or sized: drawn again. */
  put(kind: BoxKind, i: number, box: SceneBox): void {
    this.views[kind][i]?.dispose();
    this.views[kind][i] = this.make(kind, box);
    this.phy = new PhySceneThings(this.data);
  }

  /** The thing a ray meets first, nearer than `than` (m from `eye`); null: none. */
  pick(ray: THREE.Ray, eye: THREE.Vector3, than = Infinity): PropHit | null {
    let best: PropHit | null = null, bestD = than;
    for (const kind of PICK_ORDER) {
      this.views[kind].forEach((v, i) => {
        const at = v.hit(ray), d = at ? at.distanceTo(eye) : Infinity;
        if (at && d < bestD) {
          bestD = d;
          best = { kind, i, at };
        }
      });
    }
    return best;
  }

  /** Whether something on the floor moves (the knights dance): the picture is drawn on. */
  get animated(): boolean {
    return this.views.knight.length > 0;
  }

  /** Their poses at a moment (s). */
  animate(t: number): void {
    for (const v of this.views.knight) v.animate?.(t);
  }

  dispose(): void {
    for (const v of Object.values(this.views).flat()) v.dispose();
    this.group.removeFromParent();
  }

  private make(kind: BoxKind, box: SceneBox): GfxProp {
    const v = kind === 'cage' ? new GfxCage(box, this.shared.cageCell) : kind === 'table' ? new GfxTable(box)
      : kind === 'counter' ? new GfxCounter(box) : new GfxKnight(box);
    this.group.add(v.group);
    return v;
  }
}
