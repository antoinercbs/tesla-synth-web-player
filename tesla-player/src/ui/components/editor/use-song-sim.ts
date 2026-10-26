import { onBeforeUnmount, shallowRef, watch, type WatchSource } from 'vue';
import type { DevSimulation, SimWire } from '@/model/devices/simulation';
import { SimRunner, Superseded } from '@/engine/sim/run';

/**
 * What the board makes of the song as it is edited (model/devices/simulation),
 * in a worker (engine/sim): run again once `sources` have stayed put a moment,
 * so a burst of keystrokes in a field runs it once. `sources` say what it
 * depends on, small (the editor passes keys of its draft): no deep watch walks
 * the song's notes. `input` null: nothing to simulate (no notes).
 */
export function useSongSim(input: () => SimWire | null, sources: WatchSource[]) {
  const sim = shallowRef<DevSimulation | null>(null);
  const runner = new SimRunner();
  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const i = input();
      if (!i) {
        sim.value = null;
        return;
      }
      runner.run(i).then((r) => { sim.value = r; }, (err) => { if (!(err instanceof Superseded)) console.error('Simulation failed', err); });
    }, 150);
  }
  watch(sources, schedule, { immediate: true });
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    runner.dispose();
  });
  return sim;
}
