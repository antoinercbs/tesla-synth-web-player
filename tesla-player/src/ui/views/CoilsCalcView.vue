<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useMidiStore } from '@/app/stores/midi';
import { useScrolled } from '@/ui/helpers/use-scrolled';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import MathTex from '@/ui/components/ui/MathTex.vue';
import CoilChart from '@/ui/components/coils/CoilChart.vue';
import { useCoilModel } from '@/ui/components/coils/use-coil-model';
import { PhySpec, type CoilSpec } from '@/model/coils/spec';
import { CALC_SOURCES, type SourceId } from '@/model/coils/calc-sources';
import { coilColor, UNPLUGGED_COLOR } from '@/ui/helpers/coil-colors';
import { PhySummary } from '@/model/coils/summary';
import { PhyResponse } from '@/model/coils/response';
import { SndBang } from '@/model/coils/sound';
import {
  AIR_DENSITY, ARC_BAND, ARC_CORNERS, BEVEL_POINT, PRIMARY_TUNE, STEADY_BANGS, STRIKE_HOLD, TORTUOSITY, Z_SEC,
  AIR, PhyArcLoad, PhyCoil,
} from '@/model/coils/physics';
import { MIN_PULSE_US } from '@/model/devices/output';

/**
 * How the coils' figures are worked out: the model's chain from the sheet to
 * the bang, the arc, the strike and the held note, each quantity as its
 * formula, then the same with the coil's numbers, then its value. Every value
 * comes from the model's own code (model/coils/physics/ and co.), so the page
 * can't tell another story.
 */
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const midiStore = useMidiStore();
const headScrolled = useScrolled();

/* ------------------------------------------------------------ the coil, the note */
// the coil of /coils/:id/calculs, in the colour of the fibre it is on
const coil = computed(() => midiStore.coilList.find((c) => String(c.id) === String(route.params.id)) ?? null);
const color = computed(() => {
  const out = coil.value ? midiStore.outputOf(coil.value.uuid) : -1;
  return out >= 0 ? coilColor(out) : UNPLUGGED_COLOR;
});
// the model runs before the inventory comes: on the small coil, not shown
const PLACEHOLDER = PhySpec.preset('petite');
const coilSpec = computed(() => (coil.value ? PhySpec.resolve(coil.value.spec) : PLACEHOLDER));

const NOTES = [55, 110, 220, 440, 880];
const noteOptions = NOTES.map((f) => ({ value: f, label: `${f} Hz` }));
const noteHz = ref(NOTES.includes(Number(route.query.hz)) ? Number(route.query.hz) : 220);
watch(noteHz, (hz) => void router.replace({ query: { ...route.query, hz: String(hz) } }));

const spec = (): CoilSpec => coilSpec.value;
const { calc, model, mid, strikeAt, ocdInAir, currentChart, arcChart } = useCoilModel(spec, noteHz);

/* ------------------------------------------------------------ numbers set in TeX */
const fr = (v: number, d = 0) => v.toLocaleString(locale.value, { maximumFractionDigits: d, minimumFractionDigits: d });
// the reader's decimals: the comma kept tight, a thin space between thousands
// the decimal comma first: the thin space it writes for the thousands has one of its own
const texNum = (s: string) => s.replace(/,/g, '{,}').replace(/[\u202f\u00a0 ]/g, '\\,');
/** A number with fixed decimals. */
const N = (v: number, d = 0) => texNum(fr(v, d));
/** A constant as it is written. */
const K = (v: number) => texNum(v.toLocaleString(locale.value, { maximumFractionDigits: 4 }));
const PREFIXES: [number, string][] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
/**
 * A quantity under its unit's prefix, 3 significant digits (22,1 pF, 133 kHz);
 * more for a value typed on the sheet, which keeps its digits, no trailing zeros.
 */
function Q(v: number, unit: string, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const [f, p] = PREFIXES.find(([f]) => Math.abs(v) >= f * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  const x = v / f, d = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(x) || 1)));
  const num = digits > 3 ? x.toLocaleString(locale.value, { maximumFractionDigits: d }) : fr(x, d);
  return `${texNum(num)}\\,${unit === 'Ω' ? `\\text{${p}}\\Omega` : `\\text{${p}${unit}}`}`;
}
const tx = (s: string) => `\\text{${s.replace(/([%&#_{}$])/g, '\\$1')}}`;
/** A word of the formulas, in the reader's language. */
const w = (k: string) => tx(t(`coils.calc.tex.${k}`));
/** The value the line ends on: the styles mark it. */
const res = (x: string) => `\\htmlClass{calc-res}{${x}}`;

/* ------------------------------------------------------------ the steps */
interface Row {
  /** Its anchor when the sheet's figure of that name links to it (#eq-<id>). */
  id?: string;
  name: string;
  /** TeX of this file: never a name someone typed. */
  tex: string;
  /** A value typed on the sheet. */
  sheet?: boolean;
  note?: string;
  /** Where its formula or its constants come from. */
  src?: SourceId[];
}
interface Step { id: string; rows: Row[] }

const steps = computed<Step[]>(() => {
  const s = spec(), m = model.value, c = calc.value, o = mid.value?.o, hz = noteHz.value;
  const r = (k: string) => t(`coils.calc.r.${k}`), note = (k: string, p?: Record<string, unknown>) => t(`coils.calc.n.${k}`, p ?? {});
  const sub = (k: string) => tx(t(`coils.calc.sub.${k}`));
  const cTop = m.C2 - m.cPin, M = m.k * Math.sqrt(m.L1 * m.L2);
  const arc = new PhyArcLoad('milieu', c?.breakout.mid ?? 0);
  const H = new PhyCoil(s).tipHeight, fAlone = 1 / (2 * Math.PI * Math.sqrt(m.L1 * (1 - m.k ** 2) * m.C1));
  const back = 1 / (arc.tauStrike * Math.log(1 / STRIKE_HOLD));
  const ecLo = AIR.peek(BEVEL_POINT[0]), ecHi = AIR.peek(BEVEL_POINT[1]);
  const kvcm = (e: number) => `${N(e / 1e5)}\\,\\text{kV/cm}`;
  // what tipHeight adds for the mounting, between the parts the sheet gives
  const mountMm = Math.round((H - (s.stand + s.sec.h + s.top.d / 2 + s.pin.h * Math.sin((s.pin.tilt * Math.PI) / 180)) / 1000) * 1e4) / 10;
  const lnPin = Math.log((2 * s.pin.h) / (s.pin.d / 2));
  const W = (m.L1 * s.ocd ** 2) / (2 * m.r);
  const T = c?.T ?? 0, l = o?.l ?? 0, sl = c?.strikeLen ?? 0;
  const m2 = (v: number) => `${N(v, 2)}\\,\\text{m}`, usT = (v: number) => `${N(v)}\\,\\text{µs}`;
  const sum = PhySummary.of(s);
  const loudest = Math.max(sum.powerW, ...midiStore.coilList.map((x) => PhySummary.of(PhySpec.resolve(x.spec)).powerW));
  const levelDb = 10 * Math.log10(Math.max(1e-6, sum.powerW) / Math.max(1e-6, loudest));
  const pBridge = `P_{${sub('bridge')}}`, pChan = `P_{${sub('channel')}}`, ground = sub('ground');
  return [
    {
      id: 'circuit', rows: [
        { name: r('f2'), src: ['javatc'], sheet: true, tex: `f_2 = ${res(Q(s.f2, 'Hz', 4))}` },
        s.C2 != null
          ? { name: r('cTop'), src: ['javatc'], sheet: true, tex: `C_T = ${res(Q(cTop, 'F', 4))}` }
          : {
            name: r('cTop'), src: ['kaizer'], note: note('kaizer'),
            tex: String.raw`C_T = \dfrac{1}{2\pi f_2 \cdot ${K(Z_SEC / 1e3)}\,\text{k}\Omega} = \dfrac{1}{2\pi \cdot ${Q(s.f2, 'Hz', 4)} \cdot ${K(Z_SEC / 1e3)}\,\text{k}\Omega} = ${res(Q(cTop, 'F'))}`,
          },
        {
          name: r('cTube'), src: ['wire', 'model'], note: note('tube', { h: fr(s.pin.h), d: fr(s.pin.d, 1) }),
          tex: String.raw`C_\text{tube} = ${K(0.7)} \cdot \dfrac{2\pi\varepsilon_0\, h}{\ln(2h/a)} = ${K(0.7)} \cdot \dfrac{2\pi \cdot ${K(8.854)}\,\text{pF/m} \cdot ${m2(s.pin.h / 1000)}}{${N(lnPin, 2)}} = ${res(Q(m.cPin, 'F'))}`,
        },
        { name: r('c2'), tex: String.raw`C_2 = C_T + C_\text{tube} = ${Q(cTop, 'F')} + ${Q(m.cPin, 'F')} = ${res(Q(m.C2, 'F'))}` },
        { name: r('l2'), tex: String.raw`L_2 = \dfrac{1}{(2\pi f_2)^2\, C_T} = \dfrac{1}{(2\pi \cdot ${Q(s.f2, 'Hz', 4)})^2 \cdot ${Q(cTop, 'F')}} = ${res(Q(m.L2, 'H'))}` },
        { name: r('c1'), sheet: true, tex: `C_1 = ${res(Q(m.C1, 'F', 4))}` },
        s.L1 != null
          ? { name: r('l1'), src: ['javatc'], sheet: true, tex: `L_1 = ${res(Q(m.L1, 'H', 4))}` }
          : {
            name: r('l1'), src: ['detune', 'ampere'], note: note('tune', { pct: fr((1 - PRIMARY_TUNE) * 100, 1) }),
            tex: String.raw`L_1 = \dfrac{1}{(2\pi \cdot ${K(PRIMARY_TUNE)}\, f_2)^2\, C_1} = \dfrac{1}{(2\pi \cdot ${K(PRIMARY_TUNE)} \cdot ${Q(s.f2, 'Hz', 4)})^2 \cdot ${Q(m.C1, 'F', 4)}} = ${res(Q(m.L1, 'H'))}`,
          },
        { name: r('k'), src: ['javatc'], sheet: true, tex: `k = ${res(K(m.k))}` },
        { name: r('m'), tex: String.raw`M = k\sqrt{L_1 L_2} = ${K(m.k)} \cdot \sqrt{${Q(m.L1, 'H')} \cdot ${Q(m.L2, 'H')}} = ${res(Q(M, 'H'))}` },
        {
          id: 'fl', name: r('modes'), src: ['ud27'], note: note('modes'),
          tex: String.raw`\begin{aligned} &\left(\dfrac{1}{C_1} - \omega^2 L_1\right)\left(\dfrac{1}{C_2} - \omega^2 L_2\right) = \omega^4 M^2,\quad \omega = 2\pi f \\ &\Rightarrow\; f_- = ${res(Q(m.fl, 'Hz'))},\quad f_+ = ${res(Q(m.fh, 'Hz'))} \end{aligned}`,
        },
        { name: r('share'), note: note('share'), tex: String.raw`r = \dfrac{W_1}{W_1 + W_2} = ${res(N(m.r, 2))}` },
      ],
    },
    {
      id: 'bridge', rows: [
        {
          name: r('vd'), note: t(`coils.bridge.${s.bridge}`),
          tex: s.bridge === 'full'
            ? String.raw`V = V_\text{bus} = ${res(Q(m.Vd, 'V'))}`
            : String.raw`V = \dfrac{V_\text{bus}}{2} = \dfrac{${Q(s.vbus, 'V')}}{2} = ${res(Q(m.Vd, 'V'))}`,
        },
        { name: r('z0'), src: ['ampere'], tex: String.raw`Z_0 = \sqrt{\dfrac{L_1}{C_1}} = \sqrt{\dfrac{${Q(m.L1, 'H')}}{${Q(m.C1, 'F')}}} = ${res(Q(m.Z0, 'Ω'))}` },
        {
          name: r('w'), note: note('atOcd'),
          tex: String.raw`W = \dfrac{L_1\, I^2}{2r} = \dfrac{${Q(m.L1, 'H')} \cdot (${Q(s.ocd, 'A', 4)})^2}{2 \cdot ${N(m.r, 2)}} = ${res(Q(W, 'J'))}`,
        },
        {
          name: r('pDrive'), note: note('atOcd'),
          tex: String.raw`${pBridge} = \dfrac{2}{\pi}\, V\, I = \dfrac{2}{\pi} \cdot ${Q(m.Vd, 'V')} \cdot ${Q(s.ocd, 'A', 4)} = ${res(Q((2 / Math.PI) * m.Vd * s.ocd, 'W'))}`,
        },
        {
          name: r('dI'), src: ['ud27', 'ampere'],
          tex: String.raw`\Delta I = \dfrac{2\, V\, r}{2\pi f_-\, L_1} = \dfrac{2 \cdot ${Q(m.Vd, 'V')} \cdot ${N(m.r, 2)}}{2\pi \cdot ${Q(m.fl, 'Hz')} \cdot ${Q(m.L1, 'H')}} = ${res(Q(m.dI, 'A'))}`,
        },
        { name: r('ocd'), src: ['ud27'], sheet: true, note: note('ocd'), tex: String.raw`I_\text{OCD} = ${res(Q(s.ocd, 'A', 4))}` },
        {
          name: r('worst'), src: ['ud27', 'ampere'], note: note('worst'),
          tex: String.raw`\hat I = I_\text{OCD} + 2 \cdot \dfrac{2V}{Z_0} = ${Q(s.ocd, 'A', 4)} + 2 \cdot \dfrac{2 \cdot ${Q(m.Vd, 'V')}}{${Q(m.Z0, 'Ω')}} = ${res(Q(m.worst, 'A'))}`,
        },
        {
          name: r('vMmc'), src: ['ud27', 'ampere'],
          tex: String.raw`V_{C_1} = \dfrac{\hat I}{2\pi f_-\, C_1} = \dfrac{${Q(m.worst, 'A')}}{2\pi \cdot ${Q(m.fl, 'Hz')} \cdot ${Q(m.C1, 'F')}} = ${res(Q(m.vMmc(m.worst), 'V'))}`,
        },
      ],
    },
    {
      id: 'onset', rows: [
        { name: r('delta'), src: ['peek'], note: note('delta'), tex: String.raw`\delta = ${res(K(AIR_DENSITY))}` },
        { name: r('rho'), src: ['model'], note: note('rho'), tex: String.raw`\rho = ${res(String.raw`${K(BEVEL_POINT[0] * 1e3)} \;\dots\; ${K(BEVEL_POINT[1] * 1e3)}\,\text{mm}`)}` },
        {
          name: r('peek'), src: ['peek'], note: note('peek'),
          tex: String.raw`E_c = ${K(27.2)}\,\delta\left(1 + \dfrac{${K(0.54)}}{\sqrt{\delta\,\rho}}\right)\text{kV/cm} = ${res(String.raw`${kvcm(ecLo)} \;\dots\; ${kvcm(ecHi)}`)}`,
        },
        {
          name: r('v0'), src: ['wire'], note: c ? note('v0', { v: `${fr(c.breakout.mid / 1e3)} kV` }) : '',
          tex: String.raw`V_0 = E_c\,\rho\,\ln\dfrac{2h}{a},\quad \ln\dfrac{2 \cdot ${N(s.pin.h)}}{${K(s.pin.d / 2)}} = ${N(lnPin, 2)} \;\Rightarrow\; V_0 = ${res(c ? String.raw`${Q(c.breakout.lo, 'V')} \;\dots\; ${Q(c.breakout.hi, 'V')}` : '')}`,
        },
        {
          id: 'top', name: r('vTop'), note: note('vTop'),
          tex: String.raw`V = \sqrt{\dfrac{2\,(1 - r)\, W}{C_2 + C_\text{arc}}},\quad \max V = ${res(o ? Q(o.vMax, 'V') : '')}`,
        },
      ],
    },
    {
      id: 'arc', rows: [
        { name: r('lEq'), src: ['leader'], tex: String.raw`\ell^* = \dfrac{V - V_0}{E_\text{arc}}` },
        { name: r('grow'), src: ['leader'], note: note('corner'), tex: String.raw`\dfrac{d\ell}{dt} \le v = ${res(`${N(arc.vGrow / 1e4, 1)}\\,\\text{cm/µs}`)}` },
        {
          name: r('cArc'), src: ['fritz'], note: note('atEnd'),
          tex: String.raw`C_\text{arc} = c'\,\ell = ${N(arc.cArc * 1e12, 1)}\,\text{pF/m} \cdot ${m2(l)} = ${res(Q(arc.cArc * l, 'F'))}`,
        },
        { name: r('pull'), note: note('pull'), tex: String.raw`f_-\big(C_2 + C_\text{arc}\big) = ${res(o ? Q(o.fMin, 'Hz') : '')}` },
        { name: r('zone'), src: ['manley'], note: note('zone'), tex: String.raw`P_\text{zone} = 4\, f\, C_\text{arc}\, V_0\,(V - V_0)` },
        {
          name: r('chan'), src: ['fritz'], note: note('chan'),
          tex: String.raw`\begin{aligned} ${pChan} &= \dfrac{1}{2}\,(V - V_0)^2\,\dfrac{R}{R^2 + X^2} \\ R &= ${N(arc.rLin / 1e3)}\,\text{k}\Omega/\text{m} \cdot \ell,\quad X = \dfrac{1}{2\pi f\, C_\text{arc}} \end{aligned}`,
        },
        { name: r('cu'), src: ['model'], tex: String.raw`P_\text{Cu} = \dfrac{2\pi f\, W}{Q},\quad Q = ${N(arc.qCu)}` },
        {
          name: r('step'), note: note('step'),
          tex: String.raw`\Delta W = \big(\pm ${pBridge} - P_\text{zone} - ${pChan} - P_\text{Cu}\big)\,\Delta t,\quad \Delta t = \dfrac{1}{16 f}`,
        },
        { id: 'arc', name: r('l'), src: ['calib'], note: note('atNote', { us: fr(T), hz }), tex: String.raw`\ell = ${res(m2(l))}` },
        {
          id: 'energy', name: r('eArc'), src: ['lenz'], note: o ? note('eArc', { e: `${fr(o.eIn, 2)} J` }) : '',
          tex: String.raw`W_\text{arc} = \int \big(P_\text{zone} + ${pChan}\big)\,dt = ${res(o ? Q(o.eArc, 'J') : '')}`,
        },
      ],
    },
    {
      id: 'strike', rows: [
        {
          name: r('tip'),
          tex: String.raw`\begin{aligned} H &= ${w('stand')} + ${K(mountMm)}\,\text{mm} + ${w('secondary')} + \dfrac{${w('toroid')}}{2} + ${w('tube')} \cdot \sin(${w('tilt')}) \\ &= ${N(s.stand)} + ${K(mountMm)} + ${N(s.sec.h)} + \dfrac{${N(s.top.d)}}{2} + ${N(s.pin.h)} \cdot \sin ${N(s.pin.tilt)}^\circ\ \text{mm} = ${res(m2(H))} \end{aligned}`,
        },
        {
          name: r('lGround'), src: ['model'], note: note('lGround'),
          tex: String.raw`\ell_{${ground}} = ${K(TORTUOSITY)}\, H = ${K(TORTUOSITY)} \cdot ${m2(H)} = ${res(m2(sl))}`,
        },
        { name: r('dump'), note: note('dump'), tex: String.raw`W_2 = (1 - r)\, W` },
        {
          name: r('alone'), note: note('alone'),
          tex: String.raw`f_{${ground}} = \dfrac{1}{2\pi\sqrt{L_1\,(1 - k^2)\,C_1}} = \dfrac{1}{2\pi\sqrt{${Q(m.L1, 'H')} \cdot (1 - ${K(m.k)}^2) \cdot ${Q(m.C1, 'F')}}} = ${res(Q(fAlone, 'Hz'))}`,
        },
        {
          name: r('rStrike'), src: ['model'],
          tex: String.raw`R_{${ground}} = ${N(arc.rStrike / 1e3)}\,\text{k}\Omega/\text{m} \cdot \ell_{${ground}} = ${N(arc.rStrike / 1e3)}\,\text{k}\Omega/\text{m} \cdot ${m2(sl)} = ${res(Q(arc.rStrike * sl, 'Ω'))}`,
        },
        {
          name: r('back'), src: ['model'], note: note('back', { ms: fr(arc.tauStrike * 1e3) }),
          tex: String.raw`f_{${sub('back')}} = \dfrac{1}{\tau\,\ln(1/${K(STRIKE_HOLD)})} = \dfrac{1}{${N(arc.tauStrike * 1e3)}\,\text{ms} \cdot \ln ${N(1 / STRIKE_HOLD, 2)}} = ${res(Q(back, 'Hz'))}`,
        },
        {
          name: t('coils.calc.r.strikeHere', { hz }),
          tex: res(tx(strikeAt.value != null
            ? t('coils.calc.v.from', { us: fr(strikeAt.value) })
            : t('coils.calc.v.never', { us: s.board.ontime }))),
        },
      ],
    },
    {
      id: 'note', rows: [
        {
          name: r('pulse'), src: ['syntherrupter'],
          tex: String.raw`\begin{aligned} T &= \min\!\left(${w('ontimeMax')},\ \dfrac{${w('dutyMax')}}{f}\right) = \min\!\left(${usT(s.board.ontime)},\ \dfrac{${N(s.board.duty * 100, 1)}\,\%}{${N(hz)}\,\text{Hz}}\right) \\ &= \min\big(${N(s.board.ontime)},\ ${N((s.board.duty / hz) * 1e6)}\big)\,\text{µs} = ${res(usT(T))} \end{aligned}`,
        },
        {
          name: r('memory'), src: ['hickman'], note: note('memory'),
          tex: String.raw`\ell_0 = \ell\, e^{-1/(f\,\tau)} = ${m2(l)} \cdot e^{-1/(${N(hz)}\,\text{Hz} \,\cdot\, ${N(arc.tauC * 1e3)}\,\text{ms})} = ${res(m2(l * Math.exp(-1 / (hz * arc.tauC))))}`,
        },
        { name: r('settle'), tex: res(tx(t('coils.calc.tex.settle', { n: STEADY_BANGS }))) },
        {
          id: 'useful', name: r('useful'), note: note('useful'),
          tex: res(ocdInAir.value != null ? usT(ocdInAir.value) : tx(t('coils.calc.v.noOcd'))),
        },
      ],
    },
    {
      id: 'sheetFigures', rows: [
        { name: t('coils.stat.fl'), note: o ? note('flArc', { f: `${fr(o.fMin / 1e3)} kHz` }) : '', tex: `f_- = ${res(Q(m.fl, 'Hz'))}` },
        { name: t('coils.stat.arc'), tex: String.raw`\ell = ${res(m2(l))}` },
        { name: t('coils.stat.energy'), tex: String.raw`W_\text{arc} = ${res(o ? Q(o.eArc, 'J') : '')}` },
        {
          name: r('power'),
          tex: String.raw`P = W_\text{arc}\, f = ${o ? Q(o.eArc, 'J') : ''} \cdot ${N(hz)}\,\text{Hz} = ${res(o ? Q(o.eArc * hz, 'W') : '')}`,
        },
        {
          name: t('coils.stat.top'), note: c ? t('coils.stat.topSub', { lo: fr(c.breakout.lo / 1e3), hi: fr(c.breakout.hi / 1e3) }) : '',
          tex: String.raw`\max V = ${res(o ? Q(o.vMax, 'V') : '')}`,
        },
        ...(ocdInAir.value != null ? [{ name: t('coils.stat.useful'), tex: res(usT(ocdInAir.value)) }] : []),
      ],
    },
    {
      id: 'listFigures', rows: [
        {
          name: t('coils.list.arcs'), note: note('arcsMax'),
          tex: String.raw`\ell_\text{C7} = ${res(m2(sum.arcs.treble))},\quad \max_{\text{C1}\,\dots\,\text{C7}} \ell = ${res(m2(sum.arcs.bass))}`,
        },
        {
          name: t('coils.list.pulse'), note: note('pulseA3'),
          tex: sum.strikeFrom != null
            ? String.raw`T_\text{arc} = ${res(usT(sum.arcFrom))},\quad T_{${ground}} = ${res(usT(sum.strikeFrom))}`
            : String.raw`T_\text{arc} = ${res(usT(sum.arcFrom))}`,
        },
        {
          name: t('coils.list.volume'), src: ['acoustic', 'model'], note: note('volume'),
          tex: String.raw`\begin{aligned} f_\text{max} &= \dfrac{${w('dutyMax')}}{${w('ontimeMax')}} = \dfrac{${N(s.board.duty * 100, 1)}\,\%}{${usT(s.board.ontime)}} = ${Q(sum.maxHz, 'Hz')} \\ P &= W_\text{arc}\, f_\text{max} = ${Q(sum.max.eArc, 'J')} \cdot ${Q(sum.maxHz, 'Hz')} = ${Q(sum.powerW, 'W')} \\ L &= 10 \log_{10}\dfrac{P}{P_{${sub('loudest')}}} = ${res(`${levelDb > -0.05 ? '' : '-'}${N(Math.abs(levelDb), 1)}\\,\\text{dB}`)} \end{aligned}`,
        },
      ],
    },
    {
      id: 'play', rows: [
        {
          name: r('grid'), note: note('grid', { p0: PhyResponse.PULSES[0], p1: PhyResponse.PULSES[PhyResponse.PULSES.length - 1], r0: fr(PhyResponse.RATES[0], 1), r1: fr(PhyResponse.RATES[PhyResponse.RATES.length - 1]) }),
          tex: String.raw`${PhyResponse.PULSES.length}\ ${w('pulses')} \times ${PhyResponse.RATES.length}\ ${w('rates')}`,
        },
        { name: r('fate'), note: note('fate'), tex: String.raw`${w('noArc')} \;\to\; ${w('air')} \;\to\; \text{OCD} \;\to\; ${w('ground')}` },
        {
          name: r('level'), src: ['acoustic', 'model'], note: note('level', { db: SndBang.LAW.strikeDb }),
          tex: String.raw`L = 10 \log_{10}\dfrac{W_\text{arc}\, f}{P_\text{ref}}`,
        },
        {
          name: r('asked'), src: ['syntherrupter'], note: note('asked'),
          tex: String.raw`T = \begin{cases} \text{ontime} & f \ge \dfrac{\text{duty}}{\text{ontime}} \\[6pt] \dfrac{\text{duty}}{f} & ${w('otherwise')} \end{cases}`,
        },
        {
          name: r('limits'), src: ['syntherrupter'], note: note('limits', { us: MIN_PULSE_US }),
          tex: String.raw`\begin{aligned} T' &= \min\big(${w('ontimeMin')} + s\,T,\ ${w('ontimeMax')}\big) \\ s &= \min\!\left(1,\ \dfrac{${w('dutyMax')} - \sum ${w('ontimeMin')}\, f}{\sum T f}\right) \end{aligned}`,
        },
      ],
    },
  ];
});

const rowId = (s: Step, r: Row, k: number) => `eq-${r.id ?? `${s.id}-${k}`}`;

// arriving on a line (a figure of the sheet): scrolled to once the page is laid out, lit a moment
const reached = ref<string | null>(null);
function reach(): void {
  const id = route.hash.slice(1);
  const el = id ? document.getElementById(id) : null;
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  reached.value = id;
}
onMounted(() => void nextTick(reach));
// the values come a beat later and change the lines' heights: once more then
watch(() => calc.value != null, (ready) => { if (ready) void nextTick(reach); });

// each source with the rows that cite it
const sources = computed(() => {
  const cited = steps.value.flatMap((s) => s.rows.map((r, k) => ({ r, href: `#${rowId(s, r, k)}` })));
  // the published ones as the page first cites them, then the club's calibration and the model's own choices
  const OWN: SourceId[] = ['calib', 'model'];
  const first = [...new Set(cited.flatMap((x) => x.r.src ?? []))];
  const order = [...first.filter((id) => !OWN.includes(id)), ...OWN.filter((id) => first.includes(id))];
  return order.map((id, i) => ({
    id, n: i + 1, refs: CALC_SOURCES[id],
    uses: cited.filter((x) => x.r.src?.includes(id)).map((x) => ({ href: x.href, name: x.r.name })),
  }));
});
const numberOf = computed(() => Object.fromEntries(sources.value.map((x) => [x.id, x.n])) as Record<SourceId, number>);

// the bounds of the discharge physics, the three curves of the charts: where they come from
const CORNER_SOURCES: SourceId[] = ['leader', 'fritz', 'calib'];
const corners = computed(() => ARC_CORNERS.map((k) => ({
  k, label: t(`coils.corner.${k}`),
  v: `${fr(ARC_BAND[k].vGrow / 1e4, 1)} cm/µs`, c: `${fr(ARC_BAND[k].cArc * 1e12, 1)} pF/m`, e: `${fr(ARC_BAND[k].eArc / 1e5, 1)} kV/cm`,
})));
</script>

<template>
  <div class="screen calc-screen">
    <header class="screen-head calc-head" :class="{ 'is-scrolled': headScrolled }">
      <div class="calc-head__title" :style="{ '--c': color }">
        <router-link class="icon-btn" :to="coil ? { name: 'coils', params: { id: coil.id } } : { name: 'coils' }"
          :title="$t('coils.calc.back')" :aria-label="$t('coils.calc.back')"><i class="fas fa-arrow-left"></i></router-link>
        <span v-if="coil" class="calc-head__dot" aria-hidden="true"></span>
        <h1 class="view-head__title">{{ coil?.name }}<span class="calc-head__what">{{ $t('coils.calc.title') }}</span></h1>
      </div>
      <segmented-control v-model="noteHz" :options="noteOptions" :aria-label="$t('coils.note')" />
    </header>

    <p v-if="!coil" class="screen-body calc-missing">{{ $t('coils.missing') }}</p>
    <div v-else class="screen-body calc-body">
      <nav class="calc-toc" :aria-label="$t('coils.calc.toc')">
        <a v-for="(s, i) in steps" :key="s.id" :href="`#calc-${s.id}`"><span>{{ i + 1 }}</span>{{ $t(`coils.calc.step.${s.id}.title`) }}</a>
        <a href="#calc-sources"><span></span>{{ $t('coils.calc.sources') }}</a>
      </nav>

      <article class="calc-doc">
        <p class="calc-lead">{{ $t('coils.calc.lead', { name: coil.name, hz: noteHz }) }}</p>

        <section v-for="(s, i) in steps" :id="`calc-${s.id}`" :key="s.id" class="calc-step">
          <h2 class="calc-step__title"><span class="calc-step__n">{{ i + 1 }}</span>{{ $t(`coils.calc.step.${s.id}.title`) }}</h2>
          <p class="calc-step__lead">{{ $t(`coils.calc.step.${s.id}.lead`) }}</p>
          <div class="calc-eqs">
            <div v-for="(r, k) in s.rows" :id="rowId(s, r, k)" :key="k" class="calc-eq" :class="{ 'is-reached': reached === rowId(s, r, k) }">
              <div class="calc-eq__what">
                <span class="calc-eq__name">{{ r.name }}<span v-if="r.sheet" class="calc-eq__sheet">{{ $t('coils.calc.sheet') }}</span></span>
                <small v-if="r.note">{{ r.note }}</small>
                <span v-if="r.src?.length" class="calc-cites">
                  <a v-for="id in r.src" :key="id" class="calc-cite" :href="`#src-${id}`" :title="CALC_SOURCES[id][0]?.cite"><sup>{{ numberOf[id] }}</sup>{{ $t(`coils.calc.src.${id}.who`) }}</a>
                </span>
              </div>
              <math-tex class="calc-eq__math" :tex="r.tex" />
            </div>
          </div>

          <coil-chart v-if="s.id === 'bridge' && currentChart" :title="$t('coils.chart.current', { hz: noteHz })"
            :series="currentChart.series" :x="currentChart.x" :y="currentChart.y" :hlines="currentChart.hlines"
            :vlines="currentChart.vlines" :x-label="$t('coils.chart.time')" :y-label="$t('coils.chart.amps')" x-unit="µs" y-unit="A" />

          <template v-if="s.id === 'arc'">
            <table class="calc-corners">
              <caption>{{ $t('coils.calc.corners') }}
                <span class="calc-cites">
                  <a v-for="id in CORNER_SOURCES" :key="id" class="calc-cite" :href="`#src-${id}`" :title="CALC_SOURCES[id][0]?.cite"><sup>{{ numberOf[id] }}</sup>{{ $t(`coils.calc.src.${id}.who`) }}</a>
                </span>
              </caption>
              <thead>
                <tr>
                  <th scope="col"></th>
                  <th scope="col">{{ $t('coils.calc.cornerV') }}</th>
                  <th scope="col">{{ $t('coils.calc.cornerC') }}</th>
                  <th scope="col">{{ $t('coils.calc.cornerE') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in corners" :key="c.k" :class="{ 'is-ref': c.k === 'milieu' }">
                  <th scope="row">{{ c.label }}</th>
                  <td>{{ c.v }}</td>
                  <td>{{ c.c }}</td>
                  <td>{{ c.e }}</td>
                </tr>
              </tbody>
            </table>
            <coil-chart v-if="arcChart" :title="$t('coils.chart.arcs', { hz: noteHz })" :series="arcChart.series" :x="arcChart.x"
              :y="arcChart.y" :hlines="arcChart.hlines" :vlines="arcChart.vlines" :zones="arcChart.zones" :x-label="$t('coils.chart.ontime')"
              :y-label="$t('coils.chart.length')" x-unit="µs" y-unit="cm" />
          </template>
        </section>

        <!-- each source: what it is, what the model takes from it, and the lines that cite it -->
        <section id="calc-sources" class="calc-step calc-sources">
          <h2 class="calc-step__title">{{ $t('coils.calc.sources') }}</h2>
          <ol class="calc-srcs">
            <li v-for="x in sources" :id="`src-${x.id}`" :key="x.id" class="calc-src">
              <span class="calc-src__n">{{ x.n }}</span>
              <div class="calc-src__body">
                <b class="calc-src__who">{{ $t(`coils.calc.src.${x.id}.who`) }}</b>
                <p class="calc-src__what">{{ $t(`coils.calc.src.${x.id}.what`) }}</p>
                <ul v-if="x.refs.length" class="calc-src__refs">
                  <li v-for="ref in x.refs" :key="ref.cite">
                    <a v-if="ref.url" :href="ref.url" target="_blank" rel="noopener noreferrer">{{ ref.cite }}<i
                        class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
                    <span v-else>{{ ref.cite }}</span>
                  </li>
                </ul>
                <p class="calc-src__uses">{{ $t('coils.calc.usedFor') }}
                  <template v-for="(u, j) in x.uses" :key="u.href"><a :href="u.href">{{ u.name }}</a>{{ j < x.uses.length - 1 ? ', ' : '' }}</template>
                </p>
              </div>
            </li>
          </ol>
        </section>
      </article>
    </div>
  </div>
</template>
