import { SYNTHERRUPTER_ESP32 } from '@/model/devices/profiles/syntherrupter-esp32';
import { SYNTHERRUPTER_TIVA } from '@/model/devices/profiles/syntherrupter-tiva';
import type { DeviceId, DeviceProfile, UsbId } from '@/model/devices/types';

/** What an output tells of the board behind it. */
export interface OutputIdentity {
  midiName?: string;
  usb?: UsbId;
}

/** The kinds of board the app knows, and which one an output is. */
export class DevProfiles {
  static readonly ALL: readonly DeviceProfile[] = [SYNTHERRUPTER_TIVA, SYNTHERRUPTER_ESP32];
  /** The board of a machine that never chose one: the only kind the app knew before. */
  static readonly DEFAULT_ID: DeviceId = SYNTHERRUPTER_TIVA.id;

  /** The profile of `id`, or the default one for an unknown or missing id. */
  static byId(id: string | null | undefined): DeviceProfile {
    return DevProfiles.ALL.find((p) => p.id === id) ?? SYNTHERRUPTER_TIVA;
  }

  /** The board an output shows itself as, or null when it does not say. */
  static detect(identity: OutputIdentity | null): DeviceProfile | null {
    if (!identity) return null;
    const { midiName, usb } = identity;
    const usbMatches = (rule: UsbId, id: UsbId): boolean =>
      rule.vendorId === id.vendorId && (rule.productId == null || rule.productId === id.productId);
    return (
      DevProfiles.ALL.find(
        (p) =>
          (midiName != null && !!p.detect.midiName?.test(midiName)) ||
          (usb != null && !!p.detect.usb?.some((rule) => usbMatches(rule, usb))),
      ) ?? null
    );
  }

  /** The board recognised on the output, else the one chosen for this machine. */
  static resolve(identity: OutputIdentity | null, chosenId: string | null | undefined): DeviceProfile {
    return DevProfiles.detect(identity) ?? DevProfiles.byId(chosenId);
  }
}
