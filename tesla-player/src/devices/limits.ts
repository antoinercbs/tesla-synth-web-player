import type { DeviceProfile } from './types';

// the board's thresholds are typical values, each channel measured at bring-up: warn a bit below
export const NEAR_LIMIT = 0.9;

type Limits = NonNullable<DeviceProfile['hardwareLimits']>;

/** Is an ontime (µs) near or past the board's protection threshold? */
export function ontimeNearLimit(hw: Limits | undefined, ontimeUs: number): boolean {
  return !!hw && Number.isFinite(ontimeUs) && ontimeUs >= hw.ontimeUs * NEAR_LIMIT;
}

/** Is a duty (a fraction, 0.05 = 5 %) near or past the board's protection threshold? */
export function dutyNearLimit(hw: Limits | undefined, duty: number): boolean {
  return !!hw && Number.isFinite(duty) && duty >= hw.duty * NEAR_LIMIT;
}

/** The threshold as the warnings show it: "210 µs" or "15 %". */
export function limitLabel(hw: Limits, param: 'ontime' | 'duty'): string {
  return param === 'ontime' ? `${hw.ontimeUs} µs` : `${Math.round(hw.duty * 1000) / 10} %`;
}
