import { DevSyntherrupterV1 } from '@/model/devices/drivers/syntherrupter-v1';
import type { DeviceProfile } from '@/model/devices/types';
import type { EnvStep } from '@/model/sysex/envelopes';
import type { CoilConfig, CoilParam, PlaybackMode, SimpleCoil, SongStereo } from '@/model/domain';
import type { SimLimits } from '@/model/devices/coil-limits';

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
  /** Each coil's channels, mid-song: without the mode switched on again, which resets the controllers. */
  coilRouting(coils: CoilConfig[]): number[][];
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
  /** An output's own settings (max ontime, max duty, min ontime, voices, min offtime when given), not saved to its memory. */
  coilSettings(coilIndex: number, settings: SimLimits & { minOfftimeUs?: number }): number[][];
  /** Saves the board's current settings to its memory (EEPROM / flash). */
  saveSettings(): number[][];
}

/** The driver of each protocol. */
export class DevDrivers {
  static of(profile: DeviceProfile): DeviceDriver {
    switch (profile.protocol) {
      case 'syntherrupter-v1':
        return new DevSyntherrupterV1(profile);
    }
  }
}
