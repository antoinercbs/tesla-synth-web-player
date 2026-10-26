/**
 * A coil's own limits as the board holds them, each absent when it did not
 * answer. Not the profile's hardwareLimits: those are where the board's
 * protection trips, these are what the firmware holds the coil to.
 */
export interface CoilLimits {
  /** Max ontime (0x260), µs: caps every note after its volume, and every pulse at the output. */
  ontimeUs?: number;
  /** Max duty (0x261), a fraction: the notes sounding together share it. */
  duty?: number;
  /** Min ontime (0x262), µs: added to every pulse, within the max ontime. */
  minOntimeUs?: number;
  /** Max voices (0x264): past them, the coil's oldest notes go silent. */
  voices?: number;
  /** Min offtime (0x263), µs: the rest the output keeps between two pulses. The simulation leaves it out. */
  minOfftimeUs?: number;
}

/** The limits the simulation holds a coil to: all of them but the min offtime. */
export type SimLimits = Required<Omit<CoilLimits, 'minOfftimeUs'>>;

/** Where a coil's limits come from: the sheet of the coil wired there, the board now, its last reading on this machine, or the defaults. */
export type CoilLimitsSource = 'sheet' | 'board' | 'last' | 'default';

/** A coil's limits on the board: their parameters, what is taken without a board, where a reading is kept. */
export class DevCoilLimits {
  static readonly PN = { MAX_ONTIME: 0x260, MAX_DUTY: 0x261, MIN_ONTIME: 0x262, MIN_OFFTIME: 0x263, MAX_VOICES: 0x264 } as const;
  /**
   * What a coil is taken to hold when no board told. 120 µs: what a coil's OCD and
   * circuit (bus voltage, primary RLC) let it fire in practice, the club's coils
   * included. Not the firmware's factory values (10 µs, 5 %, 0 µs): 10 µs would
   * flatten every note.
   */
  static readonly DEFAULT: Readonly<SimLimits> = { ontimeUs: 120, duty: 0.1, minOntimeUs: 2, voices: 8 };

  /** Where a kind of board's last reading is kept. */
  static storageKey(boardId: string): string {
    return `coilLimits:${boardId}`;
  }
}
