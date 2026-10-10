import type { DeviceDriver } from '@/devices/driver';
import type { DeviceProfile } from '@/devices/types';
import {
  MODE_BYTE,
  coilEventFrame,
  compileCoilConfig,
  compileCustomEnvelopes,
  compileEnvelope,
  compileSimpleConfig,
  compileSimpleStop,
  compileStereo,
  encodeEnable,
  stereoChannelMessages,
} from '@/sysex/syntherrupter';

/** The Syntherrupter's SysEx protocol (version 1), spoken by the Tiva firmware and its ESP32 port. */
export function syntherrupterV1(profile: DeviceProfile): DeviceDriver {
  return {
    profile,
    coilConfig: (coils, mode = 'midi') => compileCoilConfig(coils, mode),
    stereo: (stereo, coilCount) => compileStereo(stereo, coilCount, profile.coils),
    stereoChannels: (stereo) => stereoChannelMessages(stereo),
    coilLevel: (coilIndex, param, value) => coilEventFrame(coilIndex, param, value),
    envelope: (program, steps) => compileEnvelope(program, steps),
    libraryEnvelopes: (programs) => compileCustomEnvelopes(programs),
    simpleStart: (coils) => compileSimpleConfig(coils),
    simpleStop: (coils = []) => compileSimpleStop(coils),
    silence: () => [encodeEnable(MODE_BYTE.midi, false), encodeEnable(MODE_BYTE.simple, false)],
  };
}
