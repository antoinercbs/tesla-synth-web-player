import { afterEach, describe, it, expect } from 'vitest';
import { DevDrivers } from '@/model/devices/driver';
import { SYNTHERRUPTER_ESP32 } from './profiles/syntherrupter-esp32';
import { SYNTHERRUPTER_TIVA } from './profiles/syntherrupter-tiva';
import { MODE_BYTE, PAN_PN, PN } from '@/model/sysex/syntherrupter';
import { SndEnvPrograms } from '@/model/sysex/envelopes';
import type { CoilConfig, SimpleCoil, SongStereo } from '@/model/domain';
import { DevFrame } from '@/model/sysex/frame';
import { DevSyntherrupterV1 } from '@/model/devices/drivers/syntherrupter-v1';

// the protocol's encoders, on the board they were written for
const v1 = new DevSyntherrupterV1(SYNTHERRUPTER_TIVA);

const coils: CoilConfig[] = [
  { coilIndex: 0, channelMask: 0b0011, ontimeUs: 45, duty: 0.04, program: null },
  { coilIndex: 1, channelMask: 0b0100, ontimeUs: 80, duty: 0.07, program: 3 },
];
const simple: SimpleCoil[] = [
  { coilIndex: 0, ontimeUs: 30, duty: 0.02, frequencyHz: 120 },
  { coilIndex: 2, ontimeUs: 50, duty: 0.05, frequencyHz: 60 },
];
const stereo: SongStereo = {
  blend: 'fade',
  coils: [{ position: 0.2, reach: 0.4 }, { position: 0.8, reach: 0.4 }],
  channels: { 1: { source: 'omni' } },
};

afterEach(() => SndEnvPrograms.setCustom([]));

describe('the Syntherrupter v1 driver', () => {
  // the frames the app has always sent: the Tiva must not see a single byte change
  it('sends the Tiva exactly what the protocol module builds', () => {
    const d = DevDrivers.of(SYNTHERRUPTER_TIVA);
    SndEnvPrograms.setCustom([{ id: 1, program: 21, name: 'Pulse', steps: SndEnvPrograms.steps(1) }]);
    expect(d.coilConfig(coils, 'midi')).toEqual(v1.coilConfig(coils, 'midi'));
    expect(d.coilConfig(coils)).toEqual(v1.coilConfig(coils, 'midi'));
    // the channel maps of the full setup, the MIDI mode's switch left out
    expect(d.coilRouting(coils)).toEqual(v1.coilConfig(coils, 'midi').filter((_, i) => i > 0 && i % 3 === 0));
    expect(d.stereo(stereo, 2)).toEqual(v1.stereo(stereo, 2));
    expect(d.stereo(null, 0)).toEqual(v1.stereo(null, 0));
    expect(d.stereoChannels(stereo)).toEqual(v1.stereoChannels(stereo));
    expect(d.coilLevel(1, 'duty', 0.05)).toEqual(v1.coilLevel(1, 'duty', 0.05));
    expect(d.coilLevel(0, 'ontime', 60)).toEqual(v1.coilLevel(0, 'ontime', 60));
    expect(d.envelope(45, SndEnvPrograms.steps(2))).toEqual(v1.envelope(45, SndEnvPrograms.steps(2)));
    expect(d.libraryEnvelopes([1, 21])).toEqual(v1.libraryEnvelopes([1, 21]));
    expect(d.simpleStart(simple)).toEqual(v1.simpleStart(simple));
    expect(d.simpleStop(simple)).toEqual(v1.simpleStop(simple));
    expect(d.simpleStop()).toEqual(v1.simpleStop());
  });

  it('switches both playback modes off to silence the board', () => {
    const frames = DevDrivers.of(SYNTHERRUPTER_TIVA).silence().map((f) => DevFrame.decode(f));
    expect(frames.map((f) => [f.pnFull, f.mode, f.valueInt])).toEqual([
      [PN.ENABLE, MODE_BYTE.midi, 0],
      [PN.ENABLE, MODE_BYTE.simple, 0],
    ]);
  });

  it('undoes the places of the outputs the board has, and no more', () => {
    const positions = (outputs: ReturnType<typeof DevDrivers.of>) =>
      outputs.stereo(null, 0).map((f) => DevFrame.decode(f)).filter((f) => f.pnFull === PAN_PN.POSITION);
    expect(positions(DevDrivers.of(SYNTHERRUPTER_TIVA))).toHaveLength(6);
    expect(positions(DevDrivers.of(SYNTHERRUPTER_ESP32)).map((f) => f.target)).toEqual([0, 1, 2, 3]);
  });
});
