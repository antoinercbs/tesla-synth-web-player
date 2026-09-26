import { describe, it, expect } from 'vitest';
import { WebMidiLink, type RawOutput, type SysexInput } from './webmidi-link';
import { buildCommand, buildRead } from '@/sysex/syntherrupter';

type Listener = (e: { message: { rawData: Uint8Array } }) => void;

/** A fake webmidi.js input/output pair of one device (e.g. the ESP32 USB-MIDI port). */
function mockDevice(name = 'Syntherrupter ESP32') {
  const listeners = new Set<Listener>();
  const sent: number[][] = [];
  const input = {
    name,
    addListener: (type: string, cb: Listener) => { if (type === 'sysex') listeners.add(cb); },
    removeListener: (type: string, cb: Listener) => { if (type === 'sysex') listeners.delete(cb); },
  } as unknown as SysexInput;
  const output = { name, send: (data: number[]) => { sent.push([...data]); } } as unknown as RawOutput;
  return {
    input,
    output,
    sent,
    listeners,
    reply(bytes: number[]) { for (const l of listeners) l({ message: { rawData: Uint8Array.from(bytes) } }); },
  };
}

describe('WebMidiLink (config read-back over Web MIDI)', () => {
  it('pairs an output with the input of the same device, or gives null', () => {
    const d = mockDevice();
    const other = mockDevice('USB MIDI Interface');
    expect(WebMidiLink.pair(d.output, [other.input, d.input])).not.toBeNull();
    expect(WebMidiLink.pair(d.output, [other.input])).toBeNull();
  });

  it('read() sends a GET on the output and collects the replies of the input', async () => {
    const d = mockDevice();
    const link = WebMidiLink.pair(d.output, [d.input])!;
    const pending = link.read(0x260, 0x7f, 0x260, 30);
    expect(d.sent).toEqual([buildRead(0x260, 0x7f)]);
    d.reply(buildCommand({ pn: 0x260, target: 0, value: 100 }));
    d.reply(buildCommand({ pn: 0x260, target: 1, value: 120 }));
    d.reply([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]); // not ours (GM system on)
    const frames = await pending;
    expect(frames.map((f) => [f.pnFull, f.target, f.valueInt])).toEqual([
      [0x260, 0, 100],
      [0x260, 1, 120],
    ]);
  });

  it('dispose() stops listening', () => {
    const d = mockDevice();
    const link = WebMidiLink.pair(d.output, [d.input])!;
    expect(d.listeners.size).toBe(1);
    link.dispose();
    expect(d.listeners.size).toBe(0);
  });
});
