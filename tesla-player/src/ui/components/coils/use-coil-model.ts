import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChartSeries } from './CoilChart.vue';
import type { CoilSpec } from '@/model/coils/spec';
import type { CoilCalc } from '@/model/coils/sheet-calc';
import { PhyCoil, type ArcCorner } from '@/model/coils/physics';
import { SheetCalcRunner, Superseded } from '@/engine/sim/run';

// the charts' curves in one colour for every coil: their zones and marks say what happens
const CURVE = 'var(--text)';
const DASH: Record<ArcCorner, string | undefined> = { bas: '7 4', milieu: undefined, haut: '2 3' };

/**
 * What the model makes of a sheet at a note (PhySheetCalc) and the two
 * charts, for the sheet and the page that details its calculations. Worked
 * out a beat after the sheet stops changing, off the page's thread.
 * `ready`: false while the sheet holds a value the model can't take (a field being typed).
 */
export function useCoilModel(spec: () => CoilSpec, noteHz: Ref<number>, ready: () => boolean = () => true) {
  const { t, locale } = useI18n();
  const calc = shallowRef<CoilCalc | null>(null);
  const model = computed(() => new PhyCoil(spec()).tank());

  const runner = new SheetCalcRunner();
  function compute(): void {
    runner.run(spec(), noteHz.value).then((c) => { calc.value = c; }, (err) => {
      if (!(err instanceof Superseded)) console.error('Coil model failed', err);
    });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch([() => JSON.stringify(spec()), noteHz], () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (ready()) compute(); }, 160);
  }, { immediate: true });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    runner.dispose();
  });

  const fr = (v: number, d = 0) => v.toLocaleString(locale.value, { maximumFractionDigits: d, minimumFractionDigits: d });
  const cornerLabel = (c: ArcCorner) => t(`coils.corner.${c}`);
  const mid = computed(() => calc.value?.runs.find((r) => r.corner === 'milieu'));
  // from its max ontime on, the board sends no more: a strike past it never happens
  const strikeAt = computed(() => {
    const c = calc.value;
    return c && Number.isFinite(c.strikeFrom) && c.strikeFrom < spec().board.ontime ? c.strikeFrom : null;
  });
  // the OCD tripping in the air, before the arcs strike: with them, the strike's zone says it
  const ocdInAir = computed(() => {
    const c = calc.value;
    if (!c?.useful) return null;
    const strike = strikeAt.value;
    return strike == null || c.useful < strike - 2 ? c.useful : null;
  });

  const currentChart = computed(() => {
    const c = calc.value;
    if (!c) return null;
    const m = model.value, s = spec();
    const tMax = Math.max(c.T, ...c.runs.map((r) => r.o.pts[r.o.pts.length - 1]?.[0] ?? 0)) * 1.03;
    const yMax = Math.max(m.worst, ...c.runs.map((r) => r.o.Ipk)) * 1.1;
    const series: ChartSeries[] = c.runs.map((r) => ({
      id: r.corner, label: cornerLabel(r.corner), color: CURVE, dash: DASH[r.corner], main: r.corner === 'milieu',
      pts: r.o.pts.map((p) => [p[0], p[1]] as [number, number]),
    }));
    return {
      series, x: [0, tMax] as [number, number], y: [0, yMax] as [number, number],
      hlines: [
        { at: m.worst, color: 'var(--amber)', label: t('coils.chart.worst', { a: fr(m.worst) }) },
        { at: s.ocd, color: 'var(--danger)', label: t('coils.chart.ocd', { a: fr(s.ocd) }) },
      ],
      vlines: [{ at: c.T, color: 'var(--text-mute)', label: t('coils.chart.pulseEnd', { us: fr(c.T) }) }],
    };
  });

  const arcChart = computed(() => {
    const c = calc.value;
    if (!c) return null;
    const s = spec();
    const xMax = s.board.ontime * 1.2;
    const lMax = Math.max(0.2, ...c.sweep.flatMap((w) => w.pts.map((p) => p.l))) * 100 * 1.12;
    const cross = (s.board.duty / noteHz.value) * 1e6;
    const ocd = ocdInAir.value;
    const on = s.board.ontime;
    const strike = strikeAt.value;
    return {
      series: c.sweep.map((w) => ({
        id: w.corner, label: cornerLabel(w.corner), color: CURVE, dash: DASH[w.corner], main: w.corner === 'milieu',
        pts: w.pts.map((p) => [p.on, p.l * 100] as [number, number]),
      })),
      x: [0, xMax] as [number, number], y: [0, lMax] as [number, number],
      // what happens, the same colours as the list's bars and the song editor's chart
      zones: [
        { from: 0, to: c.arcFrom, kind: 'short' as const, label: t('coils.chart.zoneShort') },
        ...(strike != null ? [{ from: strike, to: on, kind: 'strike' as const, label: t('coils.chart.zoneStrike', { us: fr(strike) }) }] : []),
        { from: on, to: xMax, kind: 'past' as const, label: t('coils.chart.zonePast') },
      ],
      hlines: [{ at: c.strikeLen * 100, color: 'var(--bang-strike)', dash: '2 3', label: t('coils.chart.mat', { m: fr(new PhyCoil(s).tipHeight, 2) }) }],
      vlines: [
        ...(cross < xMax ? [{ at: cross, color: 'var(--amber)', label: t('coils.chart.dutyMax'), lock: true }] : []),
        ...(ocd != null ? [{ at: ocd, color: 'var(--bang-ocd)', label: t('coils.chart.ocdFrom', { us: fr(ocd) }), key: t('coils.chart.keyOcd') }] : []),
        { at: on, color: 'var(--amber)', label: `${t('coils.chart.boardMax')} ${on} µs`, dash: '0', lock: true },
      ],
    };
  });

  return { calc, model, mid, strikeAt, ocdInAir, currentChart, arcChart };
}
