import { PN } from '@/model/sysex/syntherrupter';
import { ATTACK_MIN_S, COIL_SLOTS, holdAt } from './constants';
import type { SndPlace } from './place';
import type { SynthModel } from './sink';
import type { SndWaves } from './waves';

/** A coil's fixed (Simple mode) tone, as the device holds it: firing rate, ontime, duty. */
export interface SimpleParams {
  bps: number;
  ontime: number;
  duty: number;
}

interface SimpleTone {
  source: OscillatorNode;
  loud: GainNode;
  panner: StereoPannerNode;
  hz: number;
}

/** What the fixed tones need of the synth. */
export interface SimpleHost {
  readonly ctx: BaseAudioContext;
  readonly bus: AudioNode;
  readonly waves: SndWaves;
  readonly model: SynthModel;
  /** How loud coil c's fixed tone plays. */
  simpleLevel(coil: number, p: SimpleParams): number;
  placeOf(coil: number): SndPlace;
}

/**
 * Simple ("fixed") mode, as the driver's simpleStart / simpleStop drive it:
 * per-coil BPS, ontime, duty, then the global enable; a steady tone per coil
 * while it is enabled.
 */
export class SndSimple {
  private params: (SimpleParams | undefined)[] = [];
  private on = false;
  private readonly tones = new Map<number, SimpleTone>();

  constructor(private readonly host: SimpleHost) {}

  apply(pn: number, coil: number, valueInt: number, valueFloat: number, when: number): void {
    if (pn === PN.ENABLE) {
      this.on = valueInt === 1;
    } else {
      if (coil < 0 || coil >= COIL_SLOTS) return;
      const p = (this.params[coil] ??= { bps: 0, ontime: 0, duty: 0 });
      if (pn === PN.BPS) p.bps = valueInt;
      else if (pn === PN.ONTIME) p.ontime = valueInt;
      else if (pn === PN.DUTY) p.duty = valueFloat;
      else return;
      if (!this.on) return;
    }
    this.sync(when);
  }

  /** Off, its tones faded (Panic: the device would keep them until Simple mode is off); `forget`: its parameters too. */
  off(when: number, forget = false): void {
    this.on = false;
    this.sync(when);
    if (forget) this.params = [];
  }

  /** Start, retune or stop each coil's fixed tone to match what the device would now fire. */
  sync(when: number): void {
    const { ctx, bus, waves } = this.host;
    for (let c = 0; c < COIL_SLOTS; c++) {
      const p = this.params[c];
      // the ontime sent does not count: the duty sets the pulse
      const on = this.on && !!p && p.bps > 0 && p.duty > 0;
      const tone = this.tones.get(c);
      if (!on || !p) {
        if (tone) this.stop(c, tone, when);
        continue;
      }
      const level = Math.max(0.0001, this.host.simpleLevel(c, p));
      if (tone) {
        if (tone.hz !== p.bps) {
          tone.source.setPeriodicWave(waves.rate(this.host.model, p.bps));
          tone.source.frequency.setValueAtTime(p.bps, when);
          tone.hz = p.bps;
        }
        holdAt(tone.loud.gain, when);
        tone.loud.gain.linearRampToValueAtTime(level, when + 0.03);
        continue;
      }
      const source = ctx.createOscillator();
      source.setPeriodicWave(waves.rate(this.host.model, p.bps));
      source.frequency.value = p.bps;
      const loud = ctx.createGain();
      loud.gain.setValueAtTime(0.0001, when);
      loud.gain.linearRampToValueAtTime(level, when + ATTACK_MIN_S * 10);
      const panner = ctx.createStereoPanner();
      panner.pan.value = this.host.placeOf(c).stereo;
      source.connect(loud).connect(panner).connect(bus);
      source.start(when);
      this.tones.set(c, { source, loud, panner, hz: p.bps });
    }
  }

  private stop(coil: number, tone: SimpleTone, when: number): void {
    this.tones.delete(coil);
    try {
      holdAt(tone.loud.gain, when);
      tone.loud.gain.linearRampToValueAtTime(0.0001, when + 0.02);
      tone.source.stop(when + 0.06);
    } catch {
      /* already stopped */
    }
    setTimeout(() => {
      for (const node of [tone.source, tone.loud, tone.panner]) {
        try {
          node.disconnect();
        } catch {
          /* */
        }
      }
    }, Math.max(0, (when - this.host.ctx.currentTime) * 1000) + 120);
  }
}
