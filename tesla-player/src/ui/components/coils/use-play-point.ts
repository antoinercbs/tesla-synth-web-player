import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue';
import { PhyCoil, TORTUOSITY, type ArcCorner, type PhyTank } from '@/model/coils/physics';
import type { CoilSpec } from '@/model/coils/spec';
import type { CoilCalc } from '@/model/coils/sheet-calc';

/** What a stretch of ontimes does at the note: no arc, arcs in the air, the OCD cuts, they strike the mat, the board sends no more. */
export type RulerZoneKind = 'short' | 'air' | 'ocd' | 'strike' | 'past';
export interface RulerZone {
  from: number;
  to: number;
  kind: RulerZoneKind;
  /** A strike that trips the OCD as it lands. */
  withOcd?: boolean;
}
/** The ontime ruler at the note: its scale (µs), its zones, the arc's reach (m) along it and the model's spread around it. */
export interface RulerData {
  top: number;
  zones: RulerZone[];
  line: [number, number][];
  band: [number, number, number][];
  yMax: number;
  /** The reach the mat stops (m), the tip's height above it (m). */
  mat: { reach: number; tip: number };
  /** The board's max ontime just short of the mat or of the OCD (µs); null: it is short of them already. */
  propose: number | null;
}
/** A note's power into the arcs at the play point's ontime (W); `cap`: what the max duty leaves it, when less than the board's max (µs). */
export interface NoteBar {
  f: number;
  watts: number;
  cap: number | null;
  capped: boolean;
}

function niceCeil(v: number): number {
  const mag = 10 ** Math.floor(Math.log10(v || 1));
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * mag >= v) ?? 10) * mag;
}

/**
 * The sheet's play point, a note and an ontime that the 3D, the ontime ruler
 * and the notes' bars all show: the ruler's zones and curves from the model's
 * sweep at the note (useCoilModel), the point's reach and each note's power
 * from one bang each, worked out as the point moves.
 */
export function usePlayPoint(spec: () => CoilSpec, model: ComputedRef<PhyTank>, calc: Ref<CoilCalc | null>, noteHz: Ref<number>,
  ontime: Ref<number>, notes: readonly number[]) {
  const coil = computed(() => new PhyCoil(spec()));
  const bangAt = (on: number, f: number) => coil.value.run({ ontimeUs: on, f, strikes: true }, model.value);

  const reach = computed(() => bangAt(ontime.value, noteHz.value).l / TORTUOSITY);

  // a bang a note: a few times a second while the ontime moves, where it lands once let go
  const barsOntime = ref(ontime.value);
  let barsTimer: ReturnType<typeof setTimeout> | null = null;
  watch(ontime, () => {
    barsTimer ??= setTimeout(() => {
      barsTimer = null;
      barsOntime.value = ontime.value;
    }, 100);
  });
  onBeforeUnmount(() => { if (barsTimer) clearTimeout(barsTimer); });
  const bars = computed<NoteBar[]>(() => notes.map((f) => {
    const s = spec(), cap = (s.board.duty / f) * 1e6, on = barsOntime.value;
    return { f, watts: bangAt(on, f).eArc * f, cap: cap < s.board.ontime ? cap : null, capped: on > cap };
  }));

  const ruler = computed<RulerData | null>(() => {
    const c = calc.value;
    if (!c) return null;
    const s = spec(), max = s.board.ontime;
    const curve = (corner: ArcCorner) => c.sweep.find((w) => w.corner === corner)?.pts ?? [];
    const mid = curve('milieu'), lo = curve('bas'), hi = curve('haut');
    const top = mid[mid.length - 1]?.on ?? max * 1.2;
    const limit = Math.min(max, (s.board.duty / noteHz.value) * 1e6);
    const strike = Number.isFinite(c.strikeFrom) ? c.strikeFrom : Infinity;
    // the OCD in the air, before any strike: with one, the strike's zone says it
    const ocd = c.useful != null && c.useful < strike - 2 ? c.useful : Infinity;
    const zones: RulerZone[] = [];
    const add = (from: number, to: number, kind: RulerZoneKind, withOcd?: boolean) => {
      const a = Math.max(0, from), b = Math.min(to, top);
      if (b - a > 0.2) zones.push({ from: a, to: b, kind, withOcd });
    };
    add(0, Math.min(c.arcFrom, limit), 'short');
    add(c.arcFrom, Math.min(ocd, strike, limit), 'air');
    add(ocd, Math.min(strike, limit), 'ocd');
    add(strike, limit, 'strike', c.useful != null && c.useful <= strike + 3);
    add(limit, top, 'past');
    const line = mid.map((p) => [p.on, p.l / TORTUOSITY] as [number, number]);
    // the spread while the middle arc is in the air: past its strike the zone says what happens
    const band = mid.filter((p) => p.on <= strike).map((p) => {
      const i = mid.indexOf(p), a = (lo[i]?.l ?? p.l) / TORTUOSITY, b = (hi[i]?.l ?? p.l) / TORTUOSITY;
      return [p.on, Math.min(a, b), Math.max(a, b)] as [number, number, number];
    });
    const tip = coil.value.tipHeight;
    const yMax = niceCeil(Math.max(tip, ...line.map((p) => p[1]), ...band.map((p) => p[2])) * 1.1);
    const edge = Math.min(ocd, strike);
    return {
      top, zones, line, band, yMax, mat: { reach: c.strikeLen / TORTUOSITY, tip },
      propose: edge + 1 < max ? Math.max(1, Math.floor(edge) - 1) : null,
    };
  });

  return { reach, bars, ruler };
}
