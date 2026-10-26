import type { DeviceDriver } from '@/model/devices/driver';
import type { DeviceProfile } from '@/model/devices/types';
import { DevCoilLimits, type SimLimits } from '@/model/devices/coil-limits';
import { ACTION_PN } from '@/model/sysex/syntherrupter-params';
import { DEVICE_BROADCAST, ENVELOPE_PN, MODE_BYTE, PAN_PN, PN } from '@/model/sysex/syntherrupter';
import { DevFrame } from '@/model/sysex/frame';
import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { MidStereo } from '@/model/midi/stereo';
import type { CoilConfig, CoilParam, PlaybackMode, SimpleCoil, SongStereo } from '@/model/domain';

/** The Syntherrupter's SysEx protocol (version 1), spoken by the Tiva firmware and its ESP32 port. */
export class DevSyntherrupterV1 implements DeviceDriver {
  constructor(readonly profile: DeviceProfile) {}

  /**
   * A song's per-coil configuration, in the order sent at playback start: an
   * enable frame (MIDI mode) then each coil's ontime, duty and channel map, as
   * the production command set does.
   */
  coilConfig(coils: CoilConfig[], mode: PlaybackMode = 'midi'): number[][] {
    const modeByte = MODE_BYTE[mode];
    const frames: number[][] = [];
    if (mode === 'midi') frames.push(this.enable(modeByte));
    for (const coil of coils) {
      frames.push(this.ontime(coil.coilIndex, coil.ontimeUs, modeByte));
      frames.push(this.duty(coil.coilIndex, coil.duty, modeByte));
      frames.push(this.channelMap(coil.coilIndex, coil.channelMask, modeByte));
    }
    return frames;
  }

  coilRouting(coils: CoilConfig[]): number[][] {
    return coils.map((c) => this.channelMap(c.coilIndex, c.channelMask, MODE_BYTE.midi));
  }

  /**
   * The coils' places for a song, and "no place" for every other output of the
   * board (all of them when `stereo` is null): it keeps the previous song's
   * otherwise. Then the channels' note pan mappings (NRPs) are reset, for the
   * same reason; stereoChannels() sets this song's afterwards. Position and
   * reach go as floats: the firmware never divides the integer reach (0x64) by
   * 127, so any value but 0 or 1 would be dropped.
   */
  stereo(stereo: SongStereo | null | undefined, coilCount: number): number[][] {
    const frames: number[][] = [];
    for (let coil = 0; coil < this.profile.coils; coil++) {
      const placed = stereo && coil < coilCount ? stereo.coils[coil] : undefined;
      frames.push(DevFrame.command({ pn: PAN_PN.CONFIG, target: coil, value: stereo?.blend === 'single' ? 0 : 1 }));
      frames.push(DevFrame.command({ pn: PAN_PN.POSITION, target: coil, value: placed ? placed.position : -1, isFloat: true }));
      if (placed) {
        frames.push(DevFrame.command({ pn: PAN_PN.REACH, target: coil, value: Math.max(MidStereo.MIN_REACH, placed.reach), isFloat: true }));
      }
    }
    frames.push(DevFrame.command({ pn: PAN_PN.RESET_NRPS, value: 0xffff }));
    return frames;
  }

  /**
   * Controller messages setting NRP 42 (note pan mapping) on the channels not
   * placed by the file's pan: CC 99/98 select the parameter, then on 42/1 and 42/2
   * CC 6 sets the upper end and CC 38 the lower one (MIDI.cpp); 42/0 takes the
   * mode on CC 38. The selection is parked on 127/127 afterwards, as the NRP
   * convention asks.
   */
  stereoChannels(stereo: SongStereo | null | undefined): number[][] {
    const out: number[][] = [];
    if (!stereo) return out;
    for (const [key, p] of Object.entries(stereo.channels)) {
      const ch = Number(key) & 0x0f;
      const cc = (n: number, v: number): number[] => [0xb0 | ch, n, v & 0x7f];
      const select = (lsb: number): number[][] => [cc(99, 42), cc(98, lsb)];
      if (p.source === 'omni') {
        out.push(...select(0), cc(38, MidStereo.OMNI_MODE));
      } else {
        const lowLeft = p.lowOn === 'left';
        out.push(
          ...select(0), cc(38, MidStereo.FOLLOW_MODE[p.follow]),
          ...select(1), cc(6, p.noteHigh), cc(38, p.noteLow),
          ...select(2), cc(6, lowLeft ? 127 : 0), cc(38, lowLeft ? 0 : 127),
        );
      }
      out.push(cc(99, 127), cc(98, 127));
    }
    return out;
  }

  /** One coil's ontime (µs, integer) or duty (fraction, IEEE-754 float), mid-song. */
  coilLevel(coilIndex: number, param: CoilParam, value: number, mode: number = MODE_BYTE.midi): number[] {
    return param === 'duty' ? this.duty(coilIndex, value, mode) : this.ontime(coilIndex, value, mode);
  }

  /**
   * The 32 frames that write one envelope, in the firmware's integer units
   * (amplitude and n-tau in 1/1000, duration in µs). Each frame rewrites one field
   * and keeps the step's others (MIDIProgram::setDataPoint), so order is free. The
   * firmware ignores a negative amplitude/duration, hence the clamps; it also
   * forces the release amplitude to 0 and |n-tau| < 0.1 up to 0.1 by itself.
   */
  envelope(program: number, steps: readonly EnvStep[], deviceId: number = DEVICE_BROADCAST): number[][] {
    const frames: number[][] = [];
    steps.forEach((s, step) => {
      const target = (step & 0x7f) | ((program & 0x7f) << 8);
      const cmd = (pn: number, value: number): number[] => DevFrame.command({ pn, target, value, deviceId });
      frames.push(cmd(ENVELOPE_PN.AMPLITUDE, Math.round(Math.max(0, s.amp) * 1000)));
      frames.push(cmd(ENVELOPE_PN.DURATION, Math.round(Math.max(0, s.durMs) * 1000)));
      frames.push(cmd(ENVELOPE_PN.NTAU, Math.round(s.ntau * 1000)));
      frames.push(cmd(ENVELOPE_PN.NEXT, s.next));
    });
    return frames;
  }

  /** The library envelopes among `programs` (the firmware owns the built-in ones). Programs 40-63 are wiped at every boot: sent before each song. */
  libraryEnvelopes(programs: Iterable<number>): number[][] {
    const frames: number[][] = [];
    for (const program of new Set(programs)) {
      const custom = SndEnvPrograms.custom(program);
      if (custom) frames.push(...this.envelope(program, custom.steps));
    }
    return frames;
  }

  /**
   * Simple mode: a constant tone per coil (ontime + duty + frequency), no MIDI
   * channels. The coils go FIRST, Simple mode is enabled last so it never fires
   * with stale/default parameters.
   */
  simpleStart(coils: SimpleCoil[]): number[][] {
    const m = MODE_BYTE.simple;
    const frames: number[][] = [];
    for (const coil of coils) {
      // BPS first: the firmware converts a Simple-mode duty into an ontime with
      // the frequency known at that moment. Sent before the BPS (first run after
      // boot: BPS 0), the Tiva firmware divides by zero and ends up at the coil's
      // max ontime.
      frames.push(this.bps(coil.coilIndex, coil.frequencyHz, m));
      frames.push(this.ontime(coil.coilIndex, coil.ontimeUs, m));
      frames.push(this.duty(coil.coilIndex, coil.duty, m));
    }
    frames.push(this.enable(m, true));
    return frames;
  }

  /**
   * Simple mode off. Defense-in-depth: each coil's ontime AND duty zeroed first
   * (a coil can't stay armed if the disable frame is lost), then Simple mode off.
   */
  simpleStop(coils: SimpleCoil[] = []): number[][] {
    const m = MODE_BYTE.simple;
    const frames: number[][] = [];
    for (const coil of coils) {
      frames.push(this.ontime(coil.coilIndex, 0, m));
      frames.push(this.duty(coil.coilIndex, 0, m));
    }
    frames.push(this.enable(m, false));
    return frames;
  }

  silence(): number[][] {
    return [this.enable(MODE_BYTE.midi, false), this.enable(MODE_BYTE.simple, false)];
  }

  // integers: the duty in ‰; kept in RAM until an EEPROM update (saveSettings)
  coilSettings(coil: number, l: SimLimits & { minOfftimeUs?: number }): number[][] {
    return [
      DevFrame.command({ pn: DevCoilLimits.PN.MAX_ONTIME, target: coil, value: Math.round(l.ontimeUs) }),
      DevFrame.command({ pn: DevCoilLimits.PN.MAX_DUTY, target: coil, value: Math.round(l.duty * 1000) }),
      DevFrame.command({ pn: DevCoilLimits.PN.MIN_ONTIME, target: coil, value: Math.round(l.minOntimeUs) }),
      DevFrame.command({ pn: DevCoilLimits.PN.MAX_VOICES, target: coil, value: Math.round(l.voices) }),
      ...(l.minOfftimeUs != null ? [DevFrame.command({ pn: DevCoilLimits.PN.MIN_OFFTIME, target: coil, value: Math.round(l.minOfftimeUs) })] : []),
    ];
  }

  saveSettings(): number[][] {
    return [DevFrame.command({ pn: ACTION_PN.EEPROM_UPDATE, value: 1 })];
  }

  /* -------------------------------------------------- the playback commands (default: MIDI mode, the production one) */

  enable(mode: number = MODE_BYTE.midi, enabled = true): number[] {
    return DevFrame.build({ pn: PN.ENABLE, coil: 0, mode, value: enabled ? 1 : 0 });
  }

  channelMap(coil: number, channelMask: number, mode: number = MODE_BYTE.midi): number[] {
    return DevFrame.build({ pn: PN.CHANNEL_MAP, coil, mode, value: channelMask & 0xffff });
  }

  ontime(coil: number, ontimeUs: number, mode: number = MODE_BYTE.midi): number[] {
    return DevFrame.build({ pn: PN.ONTIME, coil, mode, value: Math.round(ontimeUs) });
  }

  /** The duty as a float: the production encoding, so existing songs are reproduced exactly. */
  duty(coil: number, duty: number, mode: number = MODE_BYTE.midi): number[] {
    return DevFrame.build({ pn: PN.DUTY, coil, mode, value: duty, isFloat: true });
  }

  /** Firing frequency in Hz (integer, like Syfoh sends for whole-number values). */
  bps(coil: number, frequencyHz: number, mode: number = MODE_BYTE.simple): number[] {
    return DevFrame.build({ pn: PN.BPS, coil, mode, value: Math.round(frequencyHz) });
  }
}
