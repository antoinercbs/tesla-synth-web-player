import { syntherrupterV1 } from '@/devices/drivers/syntherrupter-v1';
import type { DeviceProfile } from '@/devices/types';
import type { EnvStep } from '@/sysex/envelopes';
import type { CoilConfig, CoilParam, PlaybackMode, SimpleCoil, SongStereo } from '@/types/domain';

/**
 * What the app sends a board, as messages. Callers say what they want (a
 * song's coils, Simple mode on…) and never build a frame: a board speaking
 * another protocol then needs a driver of its own, not changes everywhere.
 * Pure: the caller sends the messages on the output it holds.
 */
export interface DeviceDriver {
  readonly profile: DeviceProfile;
  /** The playback mode on, then each coil's ontime, duty and channels. */
  coilConfig(coils: CoilConfig[], mode?: PlaybackMode): number[][];
  /** The song's coil places, or none: the board keeps the previous song's otherwise. */
  stereo(stereo: SongStereo | null | undefined, coilCount: number): number[][];
  /** Channel messages (not SysEx) placing the channels the file's pan does not. */
  stereoChannels(stereo: SongStereo | null | undefined): number[][];
  /** One coil's ontime (µs) or duty (fraction), mid-song. */
  coilLevel(coilIndex: number, param: CoilParam, value: number): number[];
  /** Writes `steps` into envelope slot `program`. */
  envelope(program: number, steps: readonly EnvStep[]): number[][];
  /** The library envelopes among `programs`; the board's own are left alone. */
  libraryEnvelopes(programs: Iterable<number>): number[][];
  /** Simple mode: a constant tone per coil. */
  simpleStart(coils: SimpleCoil[]): number[][];
  /** Simple mode off, after silencing `coils`. */
  simpleStop(coils?: SimpleCoil[]): number[][];
  /** Every playback mode off. */
  silence(): number[][];
}

export function driverFor(profile: DeviceProfile): DeviceDriver {
  switch (profile.protocol) {
    case 'syntherrupter-v1':
      return syntherrupterV1(profile);
  }
}
