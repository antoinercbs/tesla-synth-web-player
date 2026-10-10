/**
 * What the app knows of each kind of board it drives: its outputs, how it
 * shows itself on USB, what it offers beyond the protocol and how it behaves.
 * The boards are declared in profiles/, one file each.
 */

export type DeviceId = 'syntherrupter-tiva' | 'syntherrupter-esp32';

/** The SysEx dialect: boards speaking the same one share a driver (drivers/). */
export type DeviceProtocol = 'syntherrupter-v1';

export interface UsbId {
  vendorId: number;
  /** Absent: any product of the vendor. */
  productId?: number;
}

export interface DeviceProfile {
  id: DeviceId;
  /** A product name: shown as is, in every language. */
  label: string;
  protocol: DeviceProtocol;
  /** Outputs, coil indices 0..coils-1. A song may use more: those stay silent. */
  coils: number;
  /** How the board shows itself. One it does not match is the machine's chosen board. */
  detect: {
    /** Name of its own Web MIDI port. */
    midiName?: RegExp;
    /** USB ids of its serial port (Web Serial `getInfo()`). */
    usb?: readonly UsbId[];
  };
  features: {
    /** Status (0x1F00), trips (0x1F01), clearing the latch (0x1F02), status events (0x1F04). */
    boardStatus: boolean;
    /** Reboot into the ROM download mode (0x1F03) and flashing over the same cable. */
    firmwareUpdate: boolean;
    /** Settings of a Nextion touchscreen (0x220-0x226). */
    touchscreen: boolean;
    /** Accounts of the touchscreen login (0x240-0x244). */
    users: boolean;
    /** Output polarity (0x265). */
    outputInvert: boolean;
  };
  quirks: {
    /** A reboot (0x202) drops the USB device until the board is back. */
    rebootDropsUsb: boolean;
    /** Losing the USB host releases the notes and switches Simple mode off: resend them. */
    hostLossStopsModes: boolean;
    /** A forced save (0x200 = 1) pauses the outputs for a few ms. */
    forcedSaveStallsOutputs: boolean;
  };
  /** Where it keeps its settings: names the save button. */
  settingsMemory: 'eeprom' | 'flash';
  /** Typical cut-off of the board's own protection: for warnings, never a block. */
  hardwareLimits?: { ontimeUs: number; duty: number };
}
