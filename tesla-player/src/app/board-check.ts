import { reactive, watch } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import { PhySpec } from '@/model/coils/spec';
import type { BoardSettings } from '@/model/coils/spec';
import { readCoilLimits } from '@/engine/devices/coil-limits';
import type { TeslaCoil } from '@/model/coils/inventory';

export type SettingKey = keyof BoardSettings;
const KEYS: SettingKey[] = ['ontimeUs', 'duty', 'minOntimeUs', 'minOfftimeUs', 'voices'];

export interface BoardDiff {
  output: number;
  coil: TeslaCoil;
  /** What differs: the board's value (null: unknown, no read-back) and the sheet's. */
  rows: { key: SettingKey; board: number | null; sheet: number }[];
}

const same = (key: SettingKey, a: number, b: number): boolean => (key === 'duty' ? Math.abs(a - b) < 0.0006 : Math.round(a) === Math.round(b));

/**
 * Each output of the board should hold the Syntherrupter settings of the coil
 * wired to it (its sheet: max ontime, max duty, min ontime, min offtime,
 * voices). When the board says otherwise (read back on every link), or can't
 * say (an output with no read-back) after the wiring or a sheet changed, the
 * app proposes to write them: for now only, or saved to the board's EEPROM.
 * It never writes them unasked.
 */
export class BoardCheck {
  diffs: BoardDiff[] = [];
  /** The board reads its settings back: the differences are known, not supposed. */
  readable = false;
  busy = false;
  /** The differences set aside ("Ignorer"), until they change. */
  dismissed = '';
  // written to an output that can't read back, this session: proposed again only when they change
  private readonly writtenBlind = new Map<string, string>();

  /** What tells a set of differences from another. */
  static key(diffs: readonly BoardDiff[]): string {
    return JSON.stringify(diffs.map((d) => [d.output, d.coil.uuid, d.rows]));
  }

  /** Follows the output, the link, the board's reading and the wired coils' sheets for as long as the app runs. */
  start(): void {
    const store = useMidiStore();
    const sheets = (): string => JSON.stringify(Array.from({ length: store.deviceProfile.coils }, (_, o) => {
      const coil = store.wiredCoil(o);
      return coil ? new PhySpec(PhySpec.resolve(coil.spec)).boardSettings : null;
    }));
    watch(() => [store.midiOutput, store.deviceLink, store.coilLimits, sheets()] as const, () => this.compute(), { immediate: true, deep: true });
  }

  /** Writes the sheets' settings to the outputs that differ; `eeprom`: saved on the board too. */
  async apply(eeprom: boolean): Promise<void> {
    const store = useMidiStore();
    const out = store.midiOutput;
    if (!out || this.busy) return;
    this.busy = true;
    try {
      const driver = store.driver;
      for (const d of this.diffs) {
        const sheet = new PhySpec(PhySpec.resolve(d.coil.spec)).boardSettings;
        for (const frame of driver.coilSettings(d.output, sheet)) store.sendSysex(frame);
        this.writtenBlind.set(`${out.id}:${d.output}`, JSON.stringify(sheet));
      }
      if (eeprom) for (const frame of driver.saveSettings()) store.sendSysex(frame);
      // read back: what the board holds now ends the proposal, or keeps it
      const link = store.deviceLink;
      if (link) store.setCoilLimits(await readCoilLimits(link));
      this.compute();
    } finally {
      this.busy = false;
    }
  }

  dismiss(): void {
    this.dismissed = BoardCheck.key(this.diffs);
  }

  private compute(): void {
    const store = useMidiStore();
    const out = store.midiOutput;
    const diffs: BoardDiff[] = [];
    const readable = !!store.deviceLink && store.coilLimits.length > 0;
    // a board linked but not read yet: wait for its reading rather than guess
    const reading = !!store.deviceLink && !store.coilLimits.length;
    if (out && !store.isSynthOutput && !reading) {
      for (let o = 0; o < store.deviceProfile.coils; o++) {
        const coil = store.wiredCoil(o);
        if (!coil) continue;
        const sheet = new PhySpec(PhySpec.resolve(coil.spec)).boardSettings;
        const board = readable ? store.coilLimits[o] ?? {} : null;
        if (!board && this.writtenBlind.get(`${out.id}:${o}`) === JSON.stringify(sheet)) continue;
        const rows = KEYS.filter((k) => sheet[k] != null)
          .map((k) => ({ key: k, board: board ? board[k] ?? null : null, sheet: sheet[k]! }))
          .filter((r) => r.board == null || !same(r.key, r.board, r.sheet));
        if (rows.length) diffs.push({ output: o, coil, rows });
      }
    }
    this.diffs = diffs;
    this.readable = readable;
  }
}

/** The app's one check, reactive: the prompt and the output strips show it. */
export const boardCheck = reactive(new BoardCheck());
