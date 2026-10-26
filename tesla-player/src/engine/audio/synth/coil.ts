import type { CoilDrive } from '@/model/devices/output';
import { SndTimeline } from './timeline';

/** A coil as the board holds it, once it was sent something: the channels it plays, its ontime and duty along the clock. */
export class SndCoil {
  mask = 0;
  readonly ontime = new SndTimeline(0);
  readonly duty = new SndTimeline(0);

  plays(ch: number): boolean {
    return (this.mask & (1 << ch)) !== 0;
  }

  drive(t: number): CoilDrive {
    return { ontimeUs: this.ontime.at(t), duty: this.duty.at(t) };
  }

  prune(past: number): void {
    this.ontime.prune(past);
    this.duty.prune(past);
  }
}
