import { describe, it, expect } from 'vitest';
import { DevFirmwareVersion } from '@/model/firmware/version';

describe('firmware versions', () => {
  // the numbers of docs/APP_INTEGRATION.md of the firmware
  it('reads a version string the way the firmware encodes 0x204', () => {
    expect(DevFirmwareVersion.parse('1.0.0')).toBe(0x010000ff);
    expect(DevFirmwareVersion.parse('1.1.0-beta.2')).toBe(0x01010002);
    expect(DevFirmwareVersion.parse('v1.1.0')).toBe(0x010100ff);
  });

  it('puts a release after its betas, and after the version before', () => {
    expect(DevFirmwareVersion.parse('1.1.0')).toBeGreaterThan(DevFirmwareVersion.parse('1.1.0-beta.2'));
    expect(DevFirmwareVersion.parse('1.1.0-beta.2')).toBeGreaterThan(DevFirmwareVersion.parse('1.0.0'));
  });

  it('writes the board number back as text', () => {
    expect(new DevFirmwareVersion(0x010000ff).label).toBe('v1.0.0');
    expect(new DevFirmwareVersion(0x01010002).label).toBe('v1.1.0-beta.2');
    expect(new DevFirmwareVersion((4 << 24) | (2 << 16) | (2 << 8) | 255).label).toBe('v4.2.2');
  });

  it('compares with a board number whatever its sign', () => {
    // 0x204 of a main version 200 would read negative through a signed 32-bit value
    expect(DevFirmwareVersion.fromBoard(0xc80000ff | 0)).toBe(DevFirmwareVersion.parse('200.0.0'));
  });
});
