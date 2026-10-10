import { describe, it, expect } from 'vitest';
import { DEFAULT_DEVICE_ID, DEVICE_PROFILES, detectProfile, profileById, resolveProfile } from './registry';
import { driverFor } from './driver';

describe('recognising the board behind an output', () => {
  it('knows the ESP32 by its USB-MIDI port, whatever the OS calls it', () => {
    for (const name of ['Syntherrupter ESP32', 'MIDIIN2 (Syntherrupter ESP32)', 'syntherrupter esp32 MIDI 1']) {
      expect(detectProfile({ midiName: name })?.id).toBe('syntherrupter-esp32');
    }
  });

  it('knows the ESP32 by the USB ids of its serial port, not the ROM it reboots into', () => {
    expect(detectProfile({ usb: { vendorId: 0x303a, productId: 0x4009 } })?.id).toBe('syntherrupter-esp32');
    // the download mode's USB-Serial-JTAG device: flashing, not playing
    expect(detectProfile({ usb: { vendorId: 0x303a, productId: 0x1001 } })).toBeNull();
  });

  it('knows the Tiva by the LaunchPad debug probe its serial port goes through', () => {
    expect(detectProfile({ usb: { vendorId: 0x1cbe, productId: 0x00fd } })?.id).toBe('syntherrupter-tiva');
    // even on a machine set for the ESP32
    expect(resolveProfile({ usb: { vendorId: 0x1cbe, productId: 0x00fd } }, 'syntherrupter-esp32').id).toBe('syntherrupter-tiva');
  });

  it('says nothing of a plain interface, an unknown port or the built-in synth', () => {
    expect(detectProfile({ midiName: 'UM-ONE' })).toBeNull();
    expect(detectProfile({ usb: { vendorId: 0x0483, productId: 0x5740 } })).toBeNull();
    expect(detectProfile({})).toBeNull();
    expect(detectProfile(null)).toBeNull();
  });

  it('falls back on the board chosen for the machine, a recognised one coming first', () => {
    expect(resolveProfile({ midiName: 'UM-ONE' }, 'syntherrupter-esp32').id).toBe('syntherrupter-esp32');
    expect(resolveProfile(null, 'syntherrupter-tiva').id).toBe('syntherrupter-tiva');
    expect(resolveProfile({ midiName: 'Syntherrupter ESP32' }, 'syntherrupter-tiva').id).toBe('syntherrupter-esp32');
  });

  it('takes the default board for an id it does not know', () => {
    expect(profileById('nonsense').id).toBe(DEFAULT_DEVICE_ID);
    expect(profileById(null).id).toBe(DEFAULT_DEVICE_ID);
  });
});

describe('the declared boards', () => {
  it('have distinct ids, outputs and a driver each', () => {
    expect(new Set(DEVICE_PROFILES.map((p) => p.id)).size).toBe(DEVICE_PROFILES.length);
    for (const p of DEVICE_PROFILES) {
      expect(p.coils).toBeGreaterThan(0);
      expect(driverFor(p).profile).toBe(p);
    }
  });

  it('match the boards: 6 outputs on the Tiva, 4 on the ESP32 port', () => {
    expect(profileById('syntherrupter-tiva').coils).toBe(6);
    expect(profileById('syntherrupter-esp32').coils).toBe(4);
  });
});
