import axios from 'axios';
import { useMidiStore } from '@/app/stores/midi';

/** The coil on each output ('' free), kept in Tesla Player's settings: one wiring, the last used. */
export class CoilWiring {
  private saving = 0;

  /** `coil` on `output`, off any other output it was on. */
  static wire(wiring: readonly string[], output: number, coil: string): string[] {
    const next = wiring.map((u) => (u === coil ? '' : u));
    next[output] = coil;
    return next;
  }

  async save(wiring: readonly string[]): Promise<void> {
    const store = useMidiStore();
    // shown at once; the server's answer confirms it, unless another change went out since: an answer
    // to an older one would put its wiring back (and the songs on the coils it had)
    const mine = ++this.saving;
    store.setAppConfig({ ...store.appConfig, wiring: [...wiring] });
    const r = await axios.put('/api/settings', { wiring });
    if (mine === this.saving) store.setAppConfig(r.data);
  }
}

export const coilWiring = new CoilWiring();
