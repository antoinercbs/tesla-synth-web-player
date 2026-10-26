import { DevFrame } from '@/model/sysex/frame';

/**
 * The board commands of the ESP32 port of the Syntherrupter (0x1F00-0x1F04,
 * docs/APP_INTEGRATION.md of its repository): status, protection trips,
 * clearing the protection latch, and the status events it sends on its own.
 */
export class DevBoardCommands {
  static readonly PN = {
    STATUS: 0x1f00,
    TRIPS: 0x1f01,
    CLEAR_LATCH: 0x1f02,
    DOWNLOAD_MODE: 0x1f03,
    EVENTS: 0x1f04,
  } as const;
  /** Bit of 0x1F04: the board sends its status (a 0x1F00 frame) each time it changes. */
  static readonly EVENT_STATUS = 1;
  /** "CLR!": any other value is ignored, so that no stray frame re-arms a coil. */
  private static readonly CLEAR_LATCH_MAGIC = 0x434c5221;
  /** "BOOT": the board switches its outputs off and reboots into the ROM download mode. */
  private static readonly DOWNLOAD_MODE_MAGIC = 0x424f4f54;

  /** Its status sent on each change, or no more. */
  static statusEvents(on: boolean): number[] {
    return DevFrame.command({ pn: DevBoardCommands.PN.EVENTS, value: on ? DevBoardCommands.EVENT_STATUS : 0 });
  }

  static clearLatch(): number[] {
    return DevFrame.command({ pn: DevBoardCommands.PN.CLEAR_LATCH, value: DevBoardCommands.CLEAR_LATCH_MAGIC });
  }

  static downloadMode(): number[] {
    return DevFrame.command({ pn: DevBoardCommands.PN.DOWNLOAD_MODE, value: DevBoardCommands.DOWNLOAD_MODE_MAGIC });
  }
}
