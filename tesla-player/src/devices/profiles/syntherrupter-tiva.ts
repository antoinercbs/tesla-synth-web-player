import type { DeviceProfile } from '@/devices/types';

/** Max Zuidberg's Syntherrupter, upstream firmware on a Tiva LaunchPad. */
export const SYNTHERRUPTER_TIVA: DeviceProfile = {
  id: 'syntherrupter-tiva',
  label: 'Syntherrupter (Tiva)',
  protocol: 'syntherrupter-v1',
  coils: 6,
  // its serial port is the LaunchPad's debug probe (TI ICDI, the same on every
  // LaunchPad); a MIDI interface does not tell what is wired behind it
  detect: { usb: [{ vendorId: 0x1cbe, productId: 0x00fd }] },
  features: {
    boardStatus: false,
    firmwareUpdate: false,
    touchscreen: true,
    users: true,
    // the ESP32 port's notes say upstream ignores 0x265 too: kept until checked on a Tiva
    outputInvert: true,
  },
  quirks: {
    rebootDropsUsb: false,
    hostLossStopsModes: false,
    forcedSaveStallsOutputs: false,
  },
  settingsMemory: 'eeprom',
};
