import type * as THREE from 'three';

/** An image every 40 ms holds the bangs of 20 of them (the eye's share of an image, GfxDischarge). */
const IMAGE_MS = 40;
const ARC_BUDGET_MS = 6, FRAME_BUDGET_MS = 34;
/** Past 1.5 the pixels cost a high-density screen more than the eye gets back. */
export const PIXEL_RATIO_CAP = 1.5;

/**
 * The player's MIDI and sound share this thread, and the picture gives way
 * first: the arcs' work and the frames are timed, and over budget an image
 * holds fewer bangs and comes less often (thin: 0 to 3 steps), then the frame
 * draws fewer pixels; back up when there is room again.
 */
export class GfxBudget {
  private thin = 0;
  private arcCost = 0;
  private frameGap = 16;
  private lastFrame = 0;
  private lastShift = 0;
  private readonly fullRatio = Math.min(PIXEL_RATIO_CAP, window.devicePixelRatio || 1);

  /** resize: the view sized again, after its pixel ratio changed. */
  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly resize: () => void) {}

  /** A frame drawn at that time (ms); null: the view is out of sight. */
  frame(now: number | null): void {
    if (now == null) {
      this.lastFrame = 0;
      return;
    }
    if (this.lastFrame) this.frameGap = this.frameGap * 0.9 + (now - this.lastFrame) * 0.1;
    this.lastFrame = now;
  }

  /** How long an image of the arcs lasts (ms); still: the reduced motion's. */
  imageMs(still: boolean): number {
    return still ? 600 : IMAGE_MS * (1 + this.thin * 0.5);
  }

  /** The bangs an image holds at most: a coil alone up to 6, a stage shares a dozen. */
  bangsCap(coils: number): number {
    return Math.max(1, Math.floor((coils === 1 ? 6 : Math.max(2, Math.floor(12 / coils))) / 2 ** this.thin));
  }

  /** An image's arcs took that long (ms). */
  arcsTook(ms: number): void {
    this.arcCost = this.arcCost * 0.8 + ms * 0.2;
  }

  /** A step at most a second; the pixels go last and come back first. */
  adapt(now: number): void {
    if (now - this.lastShift <= 1000) return;
    const over = this.arcCost > ARC_BUDGET_MS || this.frameGap > FRAME_BUDGET_MS, room = this.arcCost < ARC_BUDGET_MS / 3 && this.frameGap < 20;
    const low = this.renderer.getPixelRatio() < this.fullRatio;
    if (over && this.thin < 3) this.thin++;
    else if (over && !low && this.fullRatio > 1) this.pixels(1);
    else if (room && low) this.pixels(this.fullRatio);
    else if (room && this.thin > 0) this.thin--;
    else return;
    this.lastShift = now;
  }

  private pixels(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    this.resize();
  }
}
