import { SYNTHERRUPTER_ESP32 } from '@/devices/profiles/syntherrupter-esp32';
import { SYNTHERRUPTER_TIVA } from '@/devices/profiles/syntherrupter-tiva';
import type { DeviceId, DeviceProfile, UsbId } from '@/devices/types';

export const DEVICE_PROFILES: readonly DeviceProfile[] = [SYNTHERRUPTER_TIVA, SYNTHERRUPTER_ESP32];

/** The board of a machine that never chose one: the only kind the app knew before. */
export const DEFAULT_DEVICE_ID: DeviceId = SYNTHERRUPTER_TIVA.id;

/** The profile of `id`, or the default one for an unknown or missing id. */
export function profileById(id: string | null | undefined): DeviceProfile {
  return DEVICE_PROFILES.find((p) => p.id === id) ?? SYNTHERRUPTER_TIVA;
}

/** What an output tells of the board behind it. */
export interface OutputIdentity {
  midiName?: string;
  usb?: UsbId;
}

function usbMatches(rule: UsbId, id: UsbId): boolean {
  return rule.vendorId === id.vendorId && (rule.productId == null || rule.productId === id.productId);
}

/** The board an output shows itself as, or null when it does not say. */
export function detectProfile(identity: OutputIdentity | null): DeviceProfile | null {
  if (!identity) return null;
  const { midiName, usb } = identity;
  return (
    DEVICE_PROFILES.find(
      (p) =>
        (midiName != null && !!p.detect.midiName?.test(midiName)) ||
        (usb != null && !!p.detect.usb?.some((rule) => usbMatches(rule, usb))),
    ) ?? null
  );
}

/** The board recognised on the output, else the one chosen for this machine. */
export function resolveProfile(identity: OutputIdentity | null, chosenId: string | null | undefined): DeviceProfile {
  return detectProfile(identity) ?? profileById(chosenId);
}
