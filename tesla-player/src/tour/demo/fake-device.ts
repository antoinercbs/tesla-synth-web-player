import { markRaw } from 'vue';
import type { DeviceLink } from '@/serial/device-link';
import { buildCommand, decodeFrame, type DecodedFrame } from '@/sysex/syntherrupter';
import { BOARD_PN, EVENT_STATUS } from '@/sysex/board';

/**
 * The tour's Syntherrupter: a device link that answers the config page's reads
 * (SyntherrupterView) the way a three-coil device would, and drops whatever is
 * sent to it. demo-mode.ts puts it in place of the real link for the tour, so
 * Apply, Save to EEPROM or Reboot never reach real hardware. On a machine set
 * for a board that reports its status, it says all is well.
 */
const COILS = [0, 1, 2];
// armed, fibers powered, USB host, protection monitored
const STATUS_OK = 0x5e;
// device units, as the firmware reports them (duty in tenths of a percent)
const PER_COIL: Record<number, number[]> = {
  0x260: [220, 160, 300], // max ontime, µs
  0x261: [100, 80, 120], // max duty
  0x262: [2, 2, 3], // min ontime, µs
  0x263: [40, 40, 60], // min offtime, µs
  0x264: [8, 6, 8], // max voices
  0x265: [0, 0, 0], // output invert
  [BOARD_PN.TRIPS]: [0, 0, 0],
};
const PER_USER: Record<number, number[]> = {
  0x242: [50, 150, 400], // max ontime, µs
  0x243: [20, 50, 100], // max duty
  0x244: [200, 800, 2000], // max bps
};
const SYSTEM: Record<number, number> = {
  0x201: 0, // device id
  0x204: (4 << 24) | (2 << 16) | (2 << 8) | 255, // firmware v4.2.2
  0x220: 80, // display brightness, %
  0x221: 300, // standby, s
  0x222: 750, // button hold, ms
  0x223: 1, // background shutdown
  0x266: 20000, // buffer, µs
  [BOARD_PN.STATUS]: STATUS_OK,
};

// real frames through the page's own decoder; names and passwords have no
// read-back on the device, so none here either
function replies(pnFirst: number, target: number, pnLast: number): DecodedFrame[] {
  const out: DecodedFrame[] = [];
  for (let pn = pnFirst; pn <= pnLast; pn++) {
    for (const tg of target === 0x7f ? COILS : [target]) {
      const value = PER_COIL[pn]?.[tg] ?? PER_USER[pn]?.[tg] ?? (tg === 0 ? SYSTEM[pn] : undefined);
      if (value !== undefined) out.push(decodeFrame(buildCommand({ pn, target: tg, value })));
    }
  }
  return out;
}

const listeners = new Set<(f: DecodedFrame) => void>();

export const fakeDeviceLink: DeviceLink = markRaw({
  name: 'Syntherrupter (demo)',
  send: (data: number[]) => {
    const f = decodeFrame(data);
    if (f.pnFull !== BOARD_PN.EVENTS || !(f.valueInt & EVENT_STATUS)) return;
    const status = decodeFrame(buildCommand({ pn: BOARD_PN.STATUS, value: STATUS_OK }));
    setTimeout(() => { for (const l of listeners) l(status); }, 30);
  },
  onParam: (cb: (f: DecodedFrame) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  read: (pnFirst: number, target: number, pnLast = pnFirst) =>
    new Promise<DecodedFrame[]>((resolve) => setTimeout(() => resolve(replies(pnFirst, target, pnLast)), 80)),
});
