import type { VolumeEvent } from './analyze';

/** CC7 × CC11 of each of the 16 channels (0..1) at any time of a song, 1 where its file sets neither. */
export class MidVolumes {
  // one lane per channel and controller, searched by time
  private readonly lanes = new Map<number, VolumeEvent[]>();

  constructor(events: readonly VolumeEvent[]) {
    for (const e of events) {
      const key = e.channel * 128 + e.controller;
      if (!this.lanes.has(key)) this.lanes.set(key, []);
      this.lanes.get(key)!.push(e);
    }
  }

  at(atMs: number): number[] {
    return Array.from({ length: 16 }, (_, ch) => (this.valueAt(ch, 7, atMs) / 127) * (this.valueAt(ch, 11, atMs) / 127));
  }

  private valueAt(channel: number, controller: number, atMs: number): number {
    const lane = this.lanes.get(channel * 128 + controller);
    if (!lane || lane[0].atMs > atMs) return 127;
    let lo = 0;
    let hi = lane.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lane[mid].atMs <= atMs) lo = mid;
      else hi = mid - 1;
    }
    return lane[lo].value;
  }
}
