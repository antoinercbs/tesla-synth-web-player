import type { Page } from '@playwright/test';

// served by Vite as it is: the page imports the very instance the app plays on
const SYNTH = '/src/engine/audio/synth/index.ts';

/** One message the built-in synth was sent. */
export interface Sent {
  kind: 'midi' | 'sysex' | 'off';
  bytes: number[];
}

/**
 * What the app sends to the built-in synth (the Coils output when no board is
 * plugged in), recorded in the page from `install()` on. The notes a song
 * plays are the proof it plays: the views only draw them.
 */
export class SynthTap {
  private constructor(private readonly page: Page) {}

  static async install(page: Page): Promise<SynthTap> {
    await page.evaluate(async (path) => {
      const { SndTeslaSynth } = await import(/* @vite-ignore */ path);
      const synth = SndTeslaSynth.shared();
      const log: { kind: string; bytes: number[] }[] = [];
      (window as unknown as { __sent: typeof log }).__sent = log;
      const send = synth.send.bind(synth);
      const sysex = synth.sendSysex.bind(synth);
      const off = synth.sendAllSoundOff.bind(synth);
      synth.send = (data: number[], opts?: unknown) => { log.push({ kind: 'midi', bytes: [...data] }); return send(data, opts); };
      synth.sendSysex = (maker: number | number[], data: number[]) => { log.push({ kind: 'sysex', bytes: [...data] }); return sysex(maker, data); };
      synth.sendAllSoundOff = () => { log.push({ kind: 'off', bytes: [] }); return off(); };
    }, SYNTH);
    return new SynthTap(page);
  }

  sent(): Promise<Sent[]> {
    return this.page.evaluate(() => (window as unknown as { __sent: Sent[] }).__sent);
  }

  /** Note-ons with a velocity, the notes struck. */
  async noteOns(): Promise<number> {
    return (await this.sent()).filter((m) => m.kind === 'midi' && (m.bytes[0] & 0xf0) === 0x90 && m.bytes[2] > 0).length;
  }

  async clear(): Promise<void> {
    await this.page.evaluate(() => { (window as unknown as { __sent: Sent[] }).__sent.length = 0; });
  }
}
