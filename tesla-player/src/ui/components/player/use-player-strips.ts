import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/app/stores/midi';
import type { CoilConfig, Song } from '@/model/domain';
import { MidFile, type MidiAnalysis } from '@/model/midi/analyze';
import { MidAutomation } from '@/model/midi/automation';
import { MidNote } from '@/model/midi/note';
import type { CoilLimits } from '@/model/devices/coil-limits';
import { DevHwLimits } from '@/model/devices/limits';
import { DevOutput } from '@/model/devices/output';
import type { DevSimulation } from '@/model/devices/simulation';
import { SimRunner, Superseded } from '@/engine/sim/run';
import { coilColor } from '@/ui/helpers/coil-colors';
import type { StripRow } from '@/ui/components/player/OutputStrips.vue';
import type { useLivePower } from './use-live-power';

export interface StripsInputs {
  song: Ref<Song | null>;
  analysis: Ref<MidiAnalysis | null>;
  isPlaying: Ref<boolean>;
  playheadMs: Ref<number>;
  power: ReturnType<typeof useLivePower>;
  /** Whether the strips show (the editor's bar has none): off, no simulation runs. */
  active: () => boolean;
}

// the skipped-notes light stays on a little, or a single note would only flicker it
const LED_HOLD_MS = 600;

/**
 * What the player's outputs show: what the board makes of the song
 * (model/devices/simulation, redone when the power or the coils' limits change),
 * each output's strip where the song is heard, the coils' notches on the
 * general Power and the outputs taken near the board's protection.
 */
export function usePlayerStrips(i: StripsInputs) {
  const midiStore = useMidiStore();
  const { t } = useI18n();
  const { song, analysis, power } = i;

  // the song's coils, ordered by coil index
  const legendCoils = computed(() => [...(song.value?.coils ?? [])].sort((a, b) => a.coilIndex - b.coilIndex));
  // the notes each coil plays: its lowest one tells where Power stops changing its bass
  const coilRanges = computed(() => {
    const notes = analysis.value?.notes ?? [];
    return new Map((song.value?.coils ?? []).map((c) => [c.coilIndex, MidFile.noteRange(notes, c.channelMask)]));
  });

  // in a worker (engine/sim): a long song takes a few hundred ms, which a fader moved while it
  // plays must not cost the page; a few times a second at most while one moves
  const sim = shallowRef<DevSimulation | null>(null);
  const runner = new SimRunner();
  let simTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSim(): void {
    if (simTimer || !i.active()) return;
    simTimer = setTimeout(() => {
      simTimer = null;
      const s = song.value, a = analysis.value;
      if (!s || !a?.notes.length) {
        sim.value = null;
        return;
      }
      const coils = s.coils ?? [];
      runner.run({
        analysis: a, coils, stereo: s.stereo, events: s.events ?? [], limits: midiStore.effectiveCoilLimits, specs: midiStore.coilSpecs,
        power: Object.fromEntries(coils.map((c) => [c.coilIndex, power.powerOf(c.coilIndex)])),
      }).then((r) => { sim.value = r; }, (err) => { if (!(err instanceof Superseded)) console.error('Simulation failed', err); });
    }, 120);
  }
  // what it depends on, small: the song and its analysis are replaced, not changed in place;
  // the coils' own powers are a record changed key by key
  watch([song, () => song.value && JSON.stringify([song.value.coils, song.value.events, song.value.stereo]), analysis,
    () => midiStore.effectiveCoilLimits, () => midiStore.coilSpecs, power.masterPower, () => JSON.stringify(power.coilPower), () => midiStore.wiring.join(','), i.active],
  scheduleSim, { immediate: true });
  onBeforeUnmount(() => {
    if (simTimer) clearTimeout(simTimer);
    runner.dispose();
  });
  const loadCoils = computed(() => legendCoils.value.map((c) => ({
    coilIndex: c.coilIndex, name: midiStore.coilName(c.coilIndex), limits: midiStore.coilLimit(c.coilIndex),
  })));

  /** The power past which a coil's lowest note fires its max ontime, whatever more it gets. */
  function notchOf(c: CoilConfig, limits: CoilLimits | null): number | null {
    const range = coilRanges.value.get(c.coilIndex);
    return range ? new DevOutput(c, limits).powerNotch(MidNote.hz(range.min)) : null;
  }
  const ledUntil = new Map<number, number>();
  const coilLabel = (o: number): string => midiStore.coilName(o) || `${t('label.coil')} ${o}`;
  // the outputs the live power (or the song itself) takes near the board's protection: their
  // longest pulse and their highest duty anywhere in the song
  const nearLimit = computed(() => {
    const hw = midiStore.deviceProfile.hardwareLimits;
    const warns = new Map<number, string>();
    if (!hw || midiStore.isSynthOutput || !sim.value) return warns;
    const limits = new DevHwLimits(hw);
    const peak = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, v), 0);
    for (const tr of sim.value.tracks) {
      if (!limits.ontimeNear(peak(tr.pulseUs)) && !limits.dutyNear(peak(tr.duty))) continue;
      warns.set(tr.coilIndex, t('player.nearLimit', { coils: String(tr.coilIndex), ontime: limits.label('ontime'), duty: limits.label('duty') }, 1));
    }
    return warns;
  });
  // each output on stage, or played by the song: its coil, its power, what it is sent and what it fires where the song is heard
  const strips = computed<StripRow[]>(() => {
    const s = sim.value;
    const ms = i.playheadMs.value;
    const step = s ? s.stepAt(ms) : 0;
    const now = performance.now();
    const rows: StripRow[] = [];
    for (let o = 0; o < midiStore.deviceProfile.coils; o++) {
      const c = song.value?.coils.find((x) => x.coilIndex === o) ?? null;
      const coil = midiStore.wiredCoil(o);
      if (!c && !coil) continue;
      const limits = midiStore.coilLimit(o);
      const tr = s?.tracks.find((x) => x.coilIndex === o) ?? null;
      // what it fires now: nothing while the song doesn't play (paused, stopped, ended)
      let live: StripRow['live'] = null;
      if (tr && i.isPlaying.value) {
        if (tr.skipped[step]) ledUntil.set(o, now + LED_HOLD_MS);
        live = {
          dutyAsked: tr.dutyAsked[step], duty: tr.duty[step], factor: tr.factor[step],
          pulseUs: tr.pulseUs[step], askedUs: tr.askedUs[step],
          skippedNow: now < (ledUntil.get(o) ?? 0), skippedSoFar: tr.cutsSoFar(ms),
        };
      } else if (tr) {
        live = { dutyAsked: 0, duty: 0, factor: 1, pulseUs: 0, askedUs: 0, skippedNow: false, skippedSoFar: tr.cutsSoFar(ms) };
      }
      rows.push({
        output: o, coil, name: coilLabel(o), color: coilColor(o), powerKey: power.powerKey(o), power: power.ownPower(o),
        received: Math.round(power.powerOf(o)), notch: c ? notchOf(c, limits) : null, inSong: !!c,
        sent: c ? new MidAutomation(song.value?.events ?? []).levelAt(c, ms, power.powerOf(o), power.powerOf(o)) : null,
        limits, live, warn: nearLimit.value.get(o) ?? '',
      });
    }
    return rows;
  });
  // the coils' notches on the general Power: their total notch over their own power
  const masterMarks = computed(() => legendCoils.value.flatMap((c) => {
    const limits = midiStore.coilLimit(c.coilIndex);
    const total = notchOf(c, limits);
    const own = power.ownPower(c.coilIndex);
    if (total == null || own <= 0) return [];
    const at = Math.round((total * 100) / own);
    return at < 200 ? [{ output: c.coilIndex, at, name: coilLabel(c.coilIndex), maxUs: limits?.ontimeUs ?? null }] : [];
  }));

  return { sim, loadCoils, strips, masterMarks };
}
