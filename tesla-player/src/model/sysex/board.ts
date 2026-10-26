export interface BoardStatus {
  /** A protection fault is latched: outputs cut, modes forced off. */
  latched: boolean;
  /** The firmware drives the fiber transmitters' supply on. */
  armed: boolean;
  /** The board can tell whether that supply is really on. */
  supplySensed: boolean;
  supplyOn: boolean;
  /** USB enumerated by a host. */
  usbHost: boolean;
  /** An output could not be set up and is disabled. */
  outputError: boolean;
  /** The board has protection inputs; without them, the latch never trips. */
  monitored: boolean;
  /** Coils whose protection tripped since the latch was set. */
  latchCoils: number[];
  /** Coils whose protection is cutting right now. */
  blockingCoils: number[];
}

/**
 * The one thing to tell, the most serious first. `stop`: the board's STOP
 * switch cuts the fibers' supply (a switch on the signal, not the emergency
 * stop, which acts on the coils' power).
 */
export type BoardState = 'latched' | 'outputError' | 'stop' | 'disarmed' | 'unmonitored' | 'ok';

/** The ESP32 board's status (its 0x1F00 word, decoded and kept as plain data). */
export class DevBoardStatus {
  private static coilsOf(nibble: number): number[] {
    return [0, 1, 2, 3].filter((c) => nibble & (1 << c));
  }

  constructor(readonly status: BoardStatus) {}

  static decode(value: number): BoardStatus {
    return {
      latched: (value & 0x01) !== 0,
      armed: (value & 0x02) !== 0,
      supplyOn: (value & 0x04) !== 0,
      supplySensed: (value & 0x08) !== 0,
      usbHost: (value & 0x10) !== 0,
      outputError: (value & 0x20) !== 0,
      monitored: (value & 0x40) !== 0,
      latchCoils: DevBoardStatus.coilsOf((value >>> 8) & 0xf),
      blockingCoils: DevBoardStatus.coilsOf((value >>> 16) & 0xf),
    };
  }

  get state(): BoardState {
    const s = this.status;
    if (s.latched) return 'latched';
    if (s.outputError) return 'outputError';
    if (s.armed && s.supplySensed && !s.supplyOn) return 'stop';
    if (!s.armed) return 'disarmed';
    if (!s.monitored) return 'unmonitored';
    return 'ok';
  }
}
