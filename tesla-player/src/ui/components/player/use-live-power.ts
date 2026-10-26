import { computed, reactive, ref, watch } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import { beginner } from '@/ui/helpers/ui-mode';

/**
 * The player's LIVE POWER (percent, 100 = as the song sets it, ontime and duty
 * together): the general Power multiplies each coil's own, set on its strip. A
 * coil's own follows it (swap two fibres, each keeps its power on its new output)
 * and stays from one song to the next: a coil turned down for the venue must not
 * come back at 100 %. What it changes, the caller sends (usePlayback's applyLive).
 */
export function useLivePower() {
  const midiStore = useMidiStore();
  const masterPower = ref(100);
  const coilPower = reactive<Record<string, number>>({});
  /** Where the power of the coil on an output is kept: its uuid, else (no inventory) the output's. */
  const powerKey = (o: number): string => midiStore.wiredCoil(o)?.uuid ?? `out:${o}`;
  const ownPower = (o: number): number => coilPower[powerKey(o)] ?? 100;
  // "≤ 100 %": the operator's lock against overdrive, for the whole show (persisted)
  const powerCapped = ref(localStorage.getItem('playerPowerCap') === '1');
  watch(powerCapped, (v) => localStorage.setItem('playerPowerCap', v ? '1' : '0'));
  // a beginner's power never passes 100 % (ui/helpers/ui-mode.ts)
  const powerMax = computed(() => (powerCapped.value || beginner.value ? 100 : 200));
  /** What the coil on output `o` gets: the general Power × its own, within the cap. */
  function powerOf(o: number): number {
    return Math.min(powerMax.value, (masterPower.value * ownPower(o)) / 100);
  }
  const powerBoost = computed(() => masterPower.value > 100); // the bar's readout: past "nominal"
  const masterDirty = computed(() => masterPower.value !== 100 || Object.values(coilPower).some((v) => v !== 100));

  /** A release near 100 % lands on it ("home"). */
  function snapHome(): void {
    if (Math.abs(masterPower.value - 100) <= 3) masterPower.value = 100;
  }
  /** The cap on or off; on, every power comes down under it. True when the powers changed. */
  function toggleCap(): boolean {
    powerCapped.value = !powerCapped.value;
    if (!powerCapped.value) return false;
    masterPower.value = Math.min(masterPower.value, 100);
    for (const k of Object.keys(coilPower)) coilPower[k] = Math.min(coilPower[k], 100);
    return true;
  }
  /** The keyboard's power step: the general Power, never past the cap. */
  function nudge(delta: number): void {
    masterPower.value = Math.max(0, Math.min(powerMax.value, masterPower.value + delta));
  }
  function reset(): void {
    masterPower.value = 100;
    for (const k of Object.keys(coilPower)) coilPower[k] = 100;
  }

  return { masterPower, coilPower, powerKey, ownPower, powerCapped, powerMax, powerOf, powerBoost, masterDirty, snapHome, toggleCap, nudge, reset };
}
