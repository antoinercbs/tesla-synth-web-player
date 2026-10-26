import { describe, it, expect } from 'vitest';
import { DevBoardCommands } from '@/model/sysex/board-commands';
import { DevBoardStatus } from '@/model/sysex/board';
import { DevFrame } from '@/model/sysex/frame';

// frames and values from docs/APP_INTEGRATION.md of the firmware
describe('the ESP32 board commands', () => {
  it('builds the frames of the integration guide', () => {
    expect(DevFrame.hex(DevBoardCommands.clearLatch())).toBe('f0 00 26 05 01 7f 02 1f 00 00 21 24 31 1a 04 f7');
    expect(DevFrame.hex(DevBoardCommands.downloadMode())).toBe('f0 00 26 05 01 7f 03 1f 00 00 54 1e 3d 12 04 f7');
    expect(DevFrame.hex(DevBoardCommands.statusEvents(true))).toBe('f0 00 26 05 01 7f 04 1f 00 00 01 00 00 00 00 f7');
    expect(DevFrame.hex(DevBoardCommands.statusEvents(false))).toBe('f0 00 26 05 01 7f 04 1f 00 00 00 00 00 00 00 f7');
  });

  it('reads the normal status: armed, fibers powered, monitored', () => {
    const s = DevBoardStatus.decode(0x5e);
    expect(s).toMatchObject({ latched: false, armed: true, supplyOn: true, supplySensed: true, usbHost: true, monitored: true });
    expect(new DevBoardStatus(s).state).toBe('ok');
  });

  it('names the coils that tripped and the ones still cutting', () => {
    const s = DevBoardStatus.decode(0x01 | 0x48 | (0b0010 << 8) | (0b1010 << 16));
    expect(s.latchCoils).toEqual([1]);
    expect(s.blockingCoils).toEqual([1, 3]);
    expect(new DevBoardStatus(s).state).toBe('latched');
  });

  it('tells the STOP switch from a board that cannot sense the fibers', () => {
    // armed, supply sensed but off
    expect(new DevBoardStatus(DevBoardStatus.decode(0x02 | 0x08 | 0x40)).state).toBe('stop');
    // armed, no supply sensing: nothing to say about the switch
    expect(new DevBoardStatus(DevBoardStatus.decode(0x02 | 0x40)).state).toBe('ok');
  });

  it('never says a board without protection inputs is protected', () => {
    expect(new DevBoardStatus(DevBoardStatus.decode(0x02 | 0x04 | 0x08)).state).toBe('unmonitored');
  });

  it('puts the latch before anything else', () => {
    expect(new DevBoardStatus(DevBoardStatus.decode(0x01 | 0x20)).state).toBe('latched');
    expect(new DevBoardStatus(DevBoardStatus.decode(0x20 | 0x02 | 0x40)).state).toBe('outputError');
    expect(new DevBoardStatus(DevBoardStatus.decode(0x40)).state).toBe('disarmed');
  });
});
