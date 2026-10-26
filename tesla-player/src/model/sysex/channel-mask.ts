import { MIDI_CHANNEL_COUNT } from '@/model/domain';

/** A 16-bit MIDI channel mask: bit i set, channel i on. */
export class DevChannelMask {
  constructor(readonly mask: number) {}

  static of(channels: readonly boolean[]): DevChannelMask {
    return new DevChannelMask(channels.reduce((mask, on, i) => (on ? mask | (1 << i) : mask), 0));
  }

  /** boolean[16], index i = channel i on. */
  get channels(): boolean[] {
    return Array.from({ length: MIDI_CHANNEL_COUNT }, (_, i) => (this.mask & (1 << i)) !== 0);
  }
}
