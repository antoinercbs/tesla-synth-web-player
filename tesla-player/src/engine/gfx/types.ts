import type { BoxKind, SceneBox } from '@/model/coils/scene-data';
import type { StageCoil } from '@/model/coils/staging';

export type { ArcState, StageCoil } from '@/model/coils/staging';

/** The palette's: the mats' lines, the handles' accent (the chosen tube's). */
export interface SceneColors { mat: string; handle?: string }

/** What a drag on the picture does while a scene is set: turn the view, move or turn a coil, set its tubes or its ring. */
export type SceneTool = 'view' | 'move' | 'rotate' | 'tubes';

/** What the Scènes tab hears while a scene is set in the picture (a thing's index among the scene's of its kind). */
export interface SceneEditing {
  /** A coil chosen (null: none), and which of its tubes. */
  pick(index: number | null, tube: number): void;
  /** A coil moved, turned, its tubes or its ring changed; done: the hand let go. */
  change(index: number, coil: StageCoil, done: boolean): void;
  /** A thing on the floor chosen. */
  pickBox(kind: BoxKind, index: number): void;
  /** A thing moved, turned or sized; done: the hand let go (the coils a table carries come by `change`). */
  changeBox(kind: BoxKind, index: number, box: SceneBox, done: boolean): void;
}
