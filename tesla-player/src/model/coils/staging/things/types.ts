import type { SceneCage, SceneCounter, SceneKnight, SceneTable } from '../../scene-data';

/** A point in the scene's frame (m), y up. */
export type P3 = [number, number, number];

/** The nearest point of something to a point, the way from it to the point (unit), how far (m). */
export interface Nearest { at: P3; normal: P3; gap: number }

/** A scene's things on the floor, as stored (model/coils/scene-data.ts). */
export interface ThingsData {
  cages?: readonly SceneCage[];
  tables?: readonly SceneTable[];
  counters?: readonly SceneCounter[];
  knights?: readonly SceneKnight[];
}
