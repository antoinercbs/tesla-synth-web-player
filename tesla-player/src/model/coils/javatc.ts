import type { CoilSpec } from '@/model/coils/spec';

export type JavaTcSpec = Partial<Pick<CoilSpec, 'sec' | 'top' | 'pri' | 'stand' | 'f2' | 'C2' | 'L1' | 'c1' | 'k'>>;

const UNIT_MM: Record<string, number> = { centimeters: 10, millimeters: 1, inches: 25.4, meters: 1000 };
const LINE = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*(?:\[[^\]]*\])?\s*=\s*(.+?)\s*$/i;
const RING = /^\s*(?:Rings?|Toroid)\s*#\d+\s*:\s*minor=([\d.]+),\s*major=([\d.]+),\s*height=([\d.]+)/i;

/**
 * Reads JavaTC's consolidated output (the text it saves or copies): sections
 * between dashed lines, one value per line as `value [unit] = Label` or
 * `value = Label`, lengths in the file's unit. What it finds goes over the
 * sheet; what it does not know (bridge, OCD, outlet tube...) stays.
 */
export class PhyJavaTc {
  private static round(v: number, digits = 1): number {
    return +v.toFixed(digits);
  }

  /** The sheet's values found in a JavaTC output; null when it is not one. */
  static parse(text: string): JavaTcSpec | null {
    if (!/J\s*A\s*V\s*A\s*T\s*C/i.test(text) && !/Secondary Coil (Inputs|Outputs)/i.test(text)) return null;
    const unit = /Units\s*=\s*(\w+)/i.exec(text)?.[1]?.toLowerCase();
    const mm = UNIT_MM[unit ?? 'centimeters'] ?? 10;
    const sections: Record<string, Map<string, number>> = {};
    const rings: { minor: number; major: number; height: number }[] = [];
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
      const head = /^\s*([A-Za-z][A-Za-z ]+?)\s*:\s*$/.exec(raw);
      if (head) { section = head[1].toLowerCase(); sections[section] ??= new Map(); continue; }
      const ring = RING.exec(raw);
      if (ring) { rings.push({ minor: +ring[1], major: +ring[2], height: +ring[3] }); continue; }
      const m = LINE.exec(raw);
      if (m && section) sections[section].set(m[2].toLowerCase(), +m[1]);
    }
    const get = (sec: string, label: string) => sections[sec]?.get(label.toLowerCase());
    const out: JavaTcSpec = {};

    const r1 = get('secondary coil inputs', 'Radius 1'), h1 = get('secondary coil inputs', 'Height 1'), h2 = get('secondary coil inputs', 'Height 2');
    if (r1 != null && h1 != null && h2 != null) out.sec = { d: PhyJavaTc.round(2 * r1 * mm), h: PhyJavaTc.round((h2 - h1) * mm) };
    const pr2 = get('primary coil inputs', 'Radius 2'), pH = get('primary coil inputs', 'Height 1');
    // JavaTC's radii run along the conductor's centre
    const pWire = get('primary coil inputs', 'Wire Diameter') ?? 0;
    if (pr2 != null) out.pri = { od: PhyJavaTc.round((2 * pr2 + pWire) * mm, 0) };
    if (pH != null) out.stand = PhyJavaTc.round(pH * mm);
    const cap = get('primary coil inputs', 'Primary Cap (uF)');
    if (cap != null) out.c1 = cap * 1e-6;

    const f2 = get('secondary coil outputs', 'Secondary Resonant Frequency');
    if (f2 != null) out.f2 = f2 * 1e3;
    // with the frequency it gives the secondary's inductance too
    const ces = get('secondary coil outputs', 'Ces-Effective Shunt Capacitance');
    if (ces != null) out.C2 = ces * 1e-12;

    const ldc = get('primary coil outputs', 'Ldc-Low Frequency Inductance'), lead = get('primary coil outputs', 'Lead Length Inductance');
    if (ldc != null) out.L1 = (ldc + (lead ?? 0)) * 1e-6;
    const k = get('primary coil outputs', 'Coupling Coefficient');
    if (k != null) out.k = k;

    if (rings.length) {
      // the envelope of the rings: outer diameter and height, tube included
      const tube = Math.max(...rings.map((r) => r.minor));
      const D = Math.max(...rings.map((r) => r.major + r.minor));
      const d = Math.max(...rings.map((r) => r.height)) - Math.min(...rings.map((r) => r.height)) + tube;
      out.top = { D: PhyJavaTc.round(D * mm), d: PhyJavaTc.round(d * mm), ...(rings.length > 1 ? { rings: { n: rings.length, tube: PhyJavaTc.round(tube * mm) } } : {}) };
    } else {
      const top = Object.entries(sections).find(([name]) => name.startsWith('top load'))?.[1];
      const major = top && [...top].find(([l]) => l.includes('major diameter'))?.[1];
      const minor = top && [...top].find(([l]) => l.includes('minor diameter'))?.[1];
      if (major != null && minor != null) out.top = { D: PhyJavaTc.round(major * mm), d: PhyJavaTc.round(minor * mm) };
    }
    return Object.keys(out).length ? out : null;
  }

}
