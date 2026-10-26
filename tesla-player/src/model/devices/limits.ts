import type { DeviceProfile } from './types';

type Limits = NonNullable<DeviceProfile['hardwareLimits']>;

/** Where a board's protection trips (its profile's hardwareLimits; absent: unknown, nothing is near). */
export class DevHwLimits {
  // the board's thresholds are typical values, each channel measured at bring-up: warn a bit below
  private static readonly NEAR = 0.9;

  constructor(readonly hw: Limits | undefined) {}

  /** Is an ontime (µs) near or past the threshold? */
  ontimeNear(ontimeUs: number): boolean {
    return !!this.hw && Number.isFinite(ontimeUs) && ontimeUs >= this.hw.ontimeUs * DevHwLimits.NEAR;
  }

  /** Is a duty (a fraction, 0.05 = 5 %) near or past the threshold? */
  dutyNear(duty: number): boolean {
    return !!this.hw && Number.isFinite(duty) && duty >= this.hw.duty * DevHwLimits.NEAR;
  }

  /** The threshold as the warnings show it: "210 µs" or "15 %"; '' when unknown. */
  label(param: 'ontime' | 'duty'): string {
    if (!this.hw) return '';
    return param === 'ontime' ? `${this.hw.ontimeUs} µs` : `${Math.round(this.hw.duty * 1000) / 10} %`;
  }
}
