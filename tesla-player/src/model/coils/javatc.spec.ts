import { describe, expect, it } from 'vitest';
import { PhyJavaTc } from '@/model/coils/javatc';
import { PhySpec } from '@/model/coils/spec';

// the Ampère museum's coil, as JavaTC 3D 1.8 saves it (outputs trimmed to what is read)
const AMPERE = `J A V A T C 3 D version 1.8 - CONSOLIDATED OUTPUT
05/10/2026 13:55:58

Units = Centimeters
Ambient Temp = 20ºC

----------------------------------------------------
Surrounding Inputs:
----------------------------------------------------
300 = Ground Plane Radius

----------------------------------------------------
Secondary Coil Inputs:
----------------------------------------------------
Current Profile = G.PROFILE_LOADED
5 = Radius 1
5 = Radius 2
40.15 = Height 1
80.15 = Height 2
1515 = Turns
0.025 = Wire Diameter
0 = Cext_pF

----------------------------------------------------
Primary Coil Inputs:
----------------------------------------------------
Round Primary Conductor
7.85 = Radius 1
16.3 = Radius 2
39 = Height 1
39 = Height 2
6.5 = Turns
0.95 = Wire Diameter
0.1 = Primary Cap (uF)
45 = Total Lead Length

----------------------------------------------------
Secondary Coil Outputs:
----------------------------------------------------
149.52 [kHz] = Secondary Resonant Frequency
48102 [Ohms] = Reactance at Resonance
51.201 [mH] = Les-Effective Series Inductance
22.129 [pF] = Ces-Effective Shunt Capacitance
18.505 [pF] = Topload Effective Capacitance

----------------------------------------------------
Primary Coil Outputs:
----------------------------------------------------
139.87 [kHz] = Primary Resonant Frequency
12.542 [µH] = Ldc-Low Frequency Inductance
0.405 [µH] = Lead Length Inductance
0.129 [k] = Coupling Coefficient
0.129 [k] = Recommended Coupling Coefficient

----------------------------------------------------
Top Load Inputs:
----------------------------------------------------
10 [cm] = Ring Group Minor Diameter
45 [cm] = Ring Group Major Diameter
2 [cm] = Ring Diameter
6 [cm] = Number of Rings
Rings #1: minor=2, major=39.339, height=91.455, topload
Rings #2: minor=2, major=42.818, height=90.067, topload
Rings #3: minor=2, major=44.749, height=88.063, topload
Rings #4: minor=2, major=44.749, height=85.837, topload
Rings #5: minor=2, major=42.818, height=83.833, topload
Rings #6: minor=2, major=39.339, height=82.445, topload
`;

describe('JavaTC import', () => {
  it('reads the Ampère coil into the small preset values', () => {
    const s = PhyJavaTc.parse(AMPERE.replace(/\n/g, '\r\n'))!;
    const p = PhySpec.PRESETS.petite;
    expect(s.sec).toEqual(p.sec);
    expect(s.pri).toEqual(p.pri);
    expect(s.stand).toBe(p.stand);
    expect(s.top).toEqual({ D: 467.5, d: 110.1, rings: { n: 6, tube: 20 } });
    expect(s.f2).toBeCloseTo(p.f2, 3);
    expect(s.C2).toBeCloseTo(p.C2!, 15);
    expect(s.L1).toBeCloseTo(p.L1!, 9);
    expect(s.c1).toBeCloseTo(p.c1, 12);
    expect(s.k).toBe(0.129);
  });

  it('converts from inches and reads a plain toroid', () => {
    const s = PhyJavaTc.parse(`Units = Inches
Secondary Coil Inputs:
3 = Radius 1
3 = Radius 2
10 = Height 1
34 = Height 2
1000 = Turns
0.01 = Wire Diameter
Top Load Inputs:
24 [in] = Toroid Major Diameter
6 [in] = Toroid Minor Diameter
`)!;
    expect(s.sec).toEqual({ d: 152.4, h: 609.6 });
    expect(s.top).toEqual({ D: 609.6, d: 152.4 });
  });

  it('refuses another text', () => {
    expect(PhyJavaTc.parse('hello = world')).toBeNull();
  });
});
