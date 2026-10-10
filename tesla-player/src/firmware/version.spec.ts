import { describe, it, expect } from 'vitest';
import { boardVersion, formatVersion, versionNumber } from './version';

describe('firmware versions', () => {
  // the numbers of docs/APP_INTEGRATION.md of the firmware
  it('reads a version string the way the firmware encodes 0x204', () => {
    expect(versionNumber('1.0.0')).toBe(0x010000ff);
    expect(versionNumber('1.1.0-beta.2')).toBe(0x01010002);
    expect(versionNumber('v1.1.0')).toBe(0x010100ff);
  });

  it('puts a release after its betas, and after the version before', () => {
    expect(versionNumber('1.1.0')).toBeGreaterThan(versionNumber('1.1.0-beta.2'));
    expect(versionNumber('1.1.0-beta.2')).toBeGreaterThan(versionNumber('1.0.0'));
  });

  it('writes the board number back as text', () => {
    expect(formatVersion(0x010000ff)).toBe('v1.0.0');
    expect(formatVersion(0x01010002)).toBe('v1.1.0-beta.2');
    expect(formatVersion((4 << 24) | (2 << 16) | (2 << 8) | 255)).toBe('v4.2.2');
  });

  it('compares with a board number whatever its sign', () => {
    // 0x204 of a main version 200 would read negative through a signed 32-bit value
    expect(boardVersion(0xc80000ff | 0)).toBe(versionNumber('200.0.0'));
  });
});
