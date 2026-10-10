import type { DeviceProfile } from '@/devices/types';

/**
 * The club's ESP32-S3 port of the Syntherrupter. Its differences with the
 * Tiva are listed in docs/APP_INTEGRATION.md of the firmware's repository.
 */
export const SYNTHERRUPTER_ESP32: DeviceProfile = {
  id: 'syntherrupter-esp32',
  label: 'Syntherrupter ESP32',
  protocol: 'syntherrupter-v1',
  coils: 4,
  detect: {
    // the exact port name depends on the OS
    midiName: /syntherrupter/i,
    // test product id of firmware 1.0.0, may change in a later release
    usb: [{ vendorId: 0x303a, productId: 0x4009 }],
  },
  features: {
    boardStatus: true,
    firmwareUpdate: true,
    touchscreen: false,
    users: false,
    outputInvert: false,
  },
  quirks: {
    rebootDropsUsb: true,
    hostLossStopsModes: true,
    forcedSaveStallsOutputs: true,
  },
  settingsMemory: 'flash',
  hardwareLimits: { ontimeUs: 210, duty: 0.15 },
};
