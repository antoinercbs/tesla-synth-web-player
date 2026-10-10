import { afterEach, describe, it, expect } from 'vitest';
import { driverFor } from './driver';
import { SYNTHERRUPTER_ESP32 } from './profiles/syntherrupter-esp32';
import { SYNTHERRUPTER_TIVA } from './profiles/syntherrupter-tiva';
import {
  MODE_BYTE,
  PAN_PN,
  PN,
  coilEventFrame,
  compileCoilConfig,
  compileCustomEnvelopes,
  compileEnvelope,
  compileSimpleConfig,
  compileSimpleStop,
  compileStereo,
  decodeFrame,
  stereoChannelMessages,
} from '@/sysex/syntherrupter';
import { programSteps, setCustomEnvelopes } from '@/sysex/envelopes';
import type { CoilConfig, SimpleCoil, SongStereo } from '@/types/domain';

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

afterEach(() => setCustomEnvelopes([]));

describe('the Syntherrupter v1 driver', () => {
  // the frames the app has always sent: the Tiva must not see a single byte change
  it('sends the Tiva exactly what the protocol module builds', () => {
    const d = driverFor(SYNTHERRUPTER_TIVA);
    setCustomEnvelopes([{ id: 1, program: 21, name: 'Pulse', steps: programSteps(1) }]);
    expect(d.coilConfig(coils, 'midi')).toEqual(compileCoilConfig(coils, 'midi'));
    expect(d.coilConfig(coils)).toEqual(compileCoilConfig(coils, 'midi'));
    expect(d.stereo(stereo, 2)).toEqual(compileStereo(stereo, 2));
    expect(d.stereo(null, 0)).toEqual(compileStereo(null, 0));
    expect(d.stereoChannels(stereo)).toEqual(stereoChannelMessages(stereo));
    expect(d.coilLevel(1, 'duty', 0.05)).toEqual(coilEventFrame(1, 'duty', 0.05));
    expect(d.coilLevel(0, 'ontime', 60)).toEqual(coilEventFrame(0, 'ontime', 60));
    expect(d.envelope(45, programSteps(2))).toEqual(compileEnvelope(45, programSteps(2)));
    expect(d.libraryEnvelopes([1, 21])).toEqual(compileCustomEnvelopes([1, 21]));
    expect(d.simpleStart(simple)).toEqual(compileSimpleConfig(simple));
    expect(d.simpleStop(simple)).toEqual(compileSimpleStop(simple));
    expect(d.simpleStop()).toEqual(compileSimpleStop());
  });

  it('switches both playback modes off to silence the board', () => {
    const frames = driverFor(SYNTHERRUPTER_TIVA).silence().map((f) => decodeFrame(f));
    expect(frames.map((f) => [f.pnFull, f.mode, f.valueInt])).toEqual([
      [PN.ENABLE, MODE_BYTE.midi, 0],
      [PN.ENABLE, MODE_BYTE.simple, 0],
    ]);
  });

  it('undoes the places of the outputs the board has, and no more', () => {
    const positions = (outputs: ReturnType<typeof driverFor>) =>
      outputs.stereo(null, 0).map((f) => decodeFrame(f)).filter((f) => f.pnFull === PAN_PN.POSITION);
    expect(positions(driverFor(SYNTHERRUPTER_TIVA))).toHaveLength(6);
    expect(positions(driverFor(SYNTHERRUPTER_ESP32)).map((f) => f.target)).toEqual([0, 1, 2, 3]);
  });
});
