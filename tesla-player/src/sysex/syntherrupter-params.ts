/**
 * Syntherrupter parameter catalogue (v1) — the **static hardware/device config**
 * the settings page reads/writes: each coil's physical operating envelope
 * (safety limits) + device-level system settings. Data only; the UI is generated
 * from this table and frames are built from `pn` via {@link buildCommand}.
 *
 * Source: MMMZZZZ/Syntherrupter wiki "Custom MIDI Commands" + observed device
 * replies. Values are exchanged as INTEGERS — a GET answers with the int variant
 * (PN_MSB has no float bit): ontimes/offtimes in µs, duty in 1/1000 (1000 = 100%)
 * → duty uses displayScale 0.1 to show a %. `displayScale` converts the firmware
 * unit to the shown value (display = device × displayScale; device = display ÷ scale).
 *
 * NOT here on purpose — these are *dynamic/performance* settings, not static
 * device config, and are handled per song by the player/editor (compileCoilConfig):
 *   channel→coil mapping (0x60), pan (0x62–0x64), LFO (0x67–0x69).
 * Also deferred: envelopes (0x300–0x303), simple-mode filters, lightsabers,
 * NRPN, and live telemetry (0x267/0x268).
 */

/** The Syntherrupter exposes 3 user accounts (0–2). */
export const USER_COUNT = 3;

export type ParamScope = 'coil' | 'system' | 'user';
export type ParamKind = 'number' | 'bool' | 'string';

export interface SynthParam {
  /** Full parameter number (base; float bit added via `isFloat`). */
  pn: number;
  /** Stable key → i18n label/hint (`sp.<key>` / `sp.<key>Hint`). */
  key: string;
  scope: ParamScope;
  kind: ParamKind;
  /** Sent/decoded as IEEE-754 float rather than integer. */
  isFloat?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** display = device × displayScale  (device = display ÷ displayScale). */
  displayScale?: number;
  /** Physical guardrail → require a confirm dialog before writing. */
  safety?: boolean;
  /** Extremely sensitive (can damage hardware) → require a DOUBLE confirmation. */
  critical?: boolean;
  /** Persisted in device EEPROM. */
  eeprom?: boolean;
  /** Info — never written. */
  readOnly?: boolean;
  /** Settable but the firmware has no read-back (e.g. user name/password) — show
   *  a "write-only" placeholder rather than an empty/ambiguous field. */
  writeOnly?: boolean;
  /** String params (name/password): max length (char[4] groups, up to 16). */
  maxChars?: number;
  /** Sensitive (password) → render masked. */
  secret?: boolean;
}

/** Per-coil static hardware envelope (TG = coil index). */
export const COIL_PARAMS: SynthParam[] = [
  { pn: 0x260, key: 'maxOntime', scope: 'coil', kind: 'number', unit: 'µs', min: 0, step: 1, safety: true, eeprom: true },
  { pn: 0x261, key: 'maxDuty', scope: 'coil', kind: 'number', unit: '%', min: 0, max: 100, step: 0.1, displayScale: 0.1, safety: true, eeprom: true },
  { pn: 0x262, key: 'minOntime', scope: 'coil', kind: 'number', unit: 'µs', min: 0, step: 1, eeprom: true },
  { pn: 0x263, key: 'minOfftime', scope: 'coil', kind: 'number', unit: 'µs', min: 0, step: 1, safety: true, eeprom: true },
  { pn: 0x264, key: 'maxVoices', scope: 'coil', kind: 'number', min: 0, max: 16, step: 1, eeprom: true },
  { pn: 0x265, key: 'outputInvert', scope: 'coil', kind: 'bool', safety: true, critical: true, eeprom: true },
];

/** Device / system parameters (TG unused → 0). */
export const SYSTEM_PARAMS: SynthParam[] = [
  { pn: 0x201, key: 'deviceId', scope: 'system', kind: 'number', min: 0, max: 126, step: 1, eeprom: true },
  // 0x223 bit 0 = background shutdown (safety auto-off). Not [EE] → resets on power-cycle.
  { pn: 0x223, key: 'backgroundShutdown', scope: 'system', kind: 'bool', safety: true },
  { pn: 0x266, key: 'bufferDuration', scope: 'system', kind: 'number', unit: 'µs', min: 1000, max: 100000, step: 100, eeprom: true },
];

/** Touchscreen / UI behaviour of the device's own display (0x22x range). */
export const UI_PARAMS: SynthParam[] = [
  { pn: 0x220, key: 'displayBrightness', scope: 'system', kind: 'number', unit: '%', min: 0, max: 100, step: 1, eeprom: true },
  { pn: 0x221, key: 'standby', scope: 'system', kind: 'number', unit: 's', min: 0, max: 3600, step: 1, eeprom: true },
  { pn: 0x222, key: 'buttonHold', scope: 'system', kind: 'number', unit: 'ms', min: 50, max: 9999, step: 1, eeprom: true },
];

/** Global read-only device info. */
export const SYSTEM_INFO: SynthParam[] = [
  { pn: 0x204, key: 'firmwareVersion', scope: 'system', kind: 'number', readOnly: true },
];

/**
 * Per-user accounts (TG_LSB = user index 0..2). Name/password are char[4]-chunked
 * strings (TG_MSB = char-group position) — written via `buildStringFrames`. The
 * three limits cap what a user may drive (within the coil's hardware envelope).
 */
export const USER_PARAMS: SynthParam[] = [
  { pn: 0x240, key: 'userName', scope: 'user', kind: 'string', maxChars: 16, eeprom: true, writeOnly: true },
  { pn: 0x241, key: 'userPassword', scope: 'user', kind: 'string', maxChars: 16, secret: true, eeprom: true, writeOnly: true },
  { pn: 0x242, key: 'userMaxOntime', scope: 'user', kind: 'number', unit: 'µs', min: 0, step: 1, eeprom: true },
  { pn: 0x243, key: 'userMaxDuty', scope: 'user', kind: 'number', unit: '%', min: 0, max: 100, step: 0.1, displayScale: 0.1, eeprom: true },
  { pn: 0x244, key: 'userMaxBps', scope: 'user', kind: 'number', unit: 'Hz', min: 0, step: 1, eeprom: true },
];

/** Action parameters (write-only commands triggered by buttons). */
export const ACTION_PN = {
  /** EEPROM update mode: write 1 to force-persist current settings. */
  EEPROM_UPDATE: 0x200,
  /** Reset/reboot — value must equal this magic key. */
  RESET: 0x202,
  RESET_MAGIC: 41153700,
} as const;

/** Everything read back during the page-open sweep. */
export const ALL_READABLE: SynthParam[] = [...COIL_PARAMS, ...SYSTEM_PARAMS, ...UI_PARAMS, ...SYSTEM_INFO];
