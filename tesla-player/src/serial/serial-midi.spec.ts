import { describe, it, expect } from 'vitest';
import { SerialMidiOutput } from './serial-midi';
import { buildCommand } from '@/sysex/syntherrupter';

/** A fake SerialPort backed by in-memory streams, for loopback testing. */
function mockPort() {
  let inbound!: ReadableStreamDefaultController<Uint8Array>;
  const written: number[][] = [];
  const port = {
    async open() {},
    readable: new ReadableStream<Uint8Array>({ start(c) { inbound = c; } }),
    writable: new WritableStream<Uint8Array>({ write(chunk) { written.push([...chunk]); } }),
    async close() {},
  };
  return {
    port: port as unknown as SerialPort,
    written,
    inject(bytes: number[]) { inbound.enqueue(Uint8Array.from(bytes)); },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SerialMidiOutput (loopback over a mock serial port)', () => {
  it('sendSysex writes a full F0..F7 frame to the port', async () => {
    const m = mockPort();
    const out = await SerialMidiOutput.open(m.port, 'mock', () => {});
    out.sendSysex([0x00, 0x26, 0x05], [0x01, 0x7f, 0x21, 0x00, 0x00, 0x00, 0x28, 0, 0, 0, 0]);
    await flush();
    expect(m.written.length).toBe(1);
    const f = m.written[0];
    expect(f[0]).toBe(0xf0);
    expect(f[f.length - 1]).toBe(0xf7);
    expect(f.slice(1, 4)).toEqual([0x00, 0x26, 0x05]);
    await out.close();
  });

  it('read() sends a GET and resolves with the device reply it decodes', async () => {
    const m = mockPort();
    const out = await SerialMidiOutput.open(m.port, 'mock', () => {});
    const pending = out.read(0x260, 1, 0x260, 30); // 30ms window
    await flush();
    expect(m.written.length).toBe(1); // the GET went out
    // device answers with a 0x260 command for coil 1, value 10µs (float)
    m.inject(buildCommand({ pn: 0x260, target: 1, value: 10, isFloat: true }));
    const frames = await pending;
    expect(frames.length).toBe(1);
    expect(frames[0].pnFull).toBe(0x260);
    expect(frames[0].target).toBe(1);
    expect(frames[0].valueFloat).toBeCloseTo(10, 3);
    await out.close();
  });

  it('ignores inbound frames from other manufacturers', async () => {
    const m = mockPort();
    const seen: number[] = [];
    const out = await SerialMidiOutput.open(m.port, 'mock', () => {});
    out.onParam((d) => seen.push(d.pnFull));
    m.inject([0xf0, 0x00, 0x11, 0x22, 0x01, 0x7f, 0x60, 0x00, 0x00, 0x00, 0x00, 0xf7]); // foreign mfr
    m.inject(buildCommand({ pn: 0x261, target: 0, value: 0.05, isFloat: true })); // ours
    await flush();
    expect(seen).toEqual([0x261]);
    await out.close();
  });
});
