/**
 * Where the coil model's formulas and constants come from, for the page that
 * details its calculations (ui/views/CoilsCalcView.vue): each source's references
 * as they are cited (authors, title, where, when) with a link to read them.
 * What the model takes from each, and what it only assumes, is said in the
 * translations (coils.calc.src.<id>). No reference: the club's calibration and
 * the model's own choices.
 */
export type SourceId =
  | 'javatc' | 'kaizer' | 'detune' | 'ampere' | 'ud27' | 'wire' | 'peek' | 'leader' | 'fritz' | 'manley'
  | 'hickman' | 'lenz' | 'acoustic' | 'syntherrupter' | 'calib' | 'model';

export interface CalcRef {
  cite: string;
  url?: string;
}

export const CALC_SOURCES: Record<SourceId, CalcRef[]> = {
  javatc: [
    { cite: 'Barton B. Anderson, JAVATC 13.6, classictesla.com, 2020', url: 'https://www.classictesla.com/java/javatc/javatc.html' },
    { cite: 'Barton B. Anderson, Tesla Coil Mailing List, 5 Jul 2008 (GeoTC, boundary elements)', url: 'https://pupman.com/listarchives/2008/Jul/msg00114.html' },
  ],
  kaizer: [
    {
      cite: 'Mads Barnkob, Kaizer Power Electronics, Secondary coil design and construction for Tesla coils (DRSSTC design guide, ch. 9), 2015, updated 2021',
      url: 'https://kaizerpowerelectronics.dk/tesla-coils/drsstc-design-guide/secondary-coil/',
    },
  ],
  detune: [
    { cite: 'Gao Guangyan (loneoceans), DRSSTC 1: Table Top Musical Tesla Coil, 2013', url: 'https://www.loneoceans.com/labs/drsstc1/' },
    { cite: 'Steve Ward, Tesla Coil Mailing List, 9 Dec 2009', url: 'https://pupman.com/listarchives/2009/Dec/msg00120.html' },
    { cite: 'Steve Conner, Tesla Coil Mailing List, 3 Sep 2004', url: 'https://pupman.com/listarchives/2004/September/msg00031.html' },
  ],
  ampere: [{ cite: 'Projet Tesla Ampère, dossier de conception (JavaTC 3D et calculs), non publié' }],
  ud27: [
    { cite: 'Gao Guangyan (loneoceans), Universal DRSSTC Tesla Coil Driver 2.7 Rev C, 2015', url: 'https://www.loneoceans.com/labs/ud27/' },
    { cite: 'Steve Ward, A General Guide to DRSSTC Design, 2005', url: 'https://stevehv.4hv.org/drsstc_design.htm' },
    { cite: 'Udo Lenz, Steve Ward, Tesla Coil Mailing List, Feb 2013 (the pole a zero-crossing driver locks on)', url: 'https://pupman.com/listarchives/2013/Feb/msg00052.html' },
    { cite: 'Matt Giordano, Tesla Coil Mailing List, 31 Jan 2014 (the MMC voltage, half cycle after half cycle)', url: 'https://pupman.com/listarchives/2014/Jan/msg00108.php' },
  ],
  wire: [
    {
      cite: 'L. D. Landau, E. M. Lifshitz, Electrodynamics of Continuous Media, §4 (A conducting ellipsoid), Pergamon, 1960',
      url: 'https://archive.org/details/ost-physics-landaulifshitz-electrodynamicsofcontinuousmedia',
    },
    { cite: 'J. D. Jackson, Charge density on thin straight wire, revisited, Am. J. Phys. 68 (2000) 789–799', url: 'https://doi.org/10.1119/1.1302908' },
  ],
  peek: [
    { cite: 'F. W. Peek Jr., Dielectric Phenomena in High Voltage Engineering, McGraw-Hill, 1915, ch. IV, p. 93', url: 'https://archive.org/details/dielectricphenom00peekrich' },
  ],
  leader: [
    {
      cite: 'P. Lalande, A. Bondiou-Clergerie, G. Bacchiega, I. Gallimberti, Observations and modeling of lightning leaders, C. R. Physique 3 (2002) 1375–1392',
      url: 'https://comptes-rendus.academie-sciences.fr/physique/item/10.1016/S1631-0705(02)01413-5.pdf',
    },
    {
      cite: 'I. Gallimberti et al., Fundamental processes in long air gap discharges, C. R. Physique 3 (2002) 1335–1359',
      url: 'https://comptes-rendus.academie-sciences.fr/physique/item/10.1016/S1631-0705(02)01414-7.pdf',
    },
  ],
  fritz: [
    {
      cite: 'Terry Fritz, Modeled and Actual Voltage and Current Waveforms within a Tesla Coil, hot-streamer.com, 1998',
      url: 'https://web.archive.org/web/20010822034633/http://hot-streamer.com/TeslaCoils/MyPapers/modact/modact.html',
    },
    { cite: 'Terry Fritz, Tesla Coil Mailing List, 30 Jun 2005', url: 'https://pupman.com/listarchives/2005/Jul/msg00001.html' },
  ],
  manley: [
    { cite: 'T. C. Manley, The Electric Characteristics of the Ozonator Discharge, Trans. Electrochem. Soc. 84 (1943) 83–96', url: 'https://doi.org/10.1149/1.3071556' },
  ],
  hickman: [
    { cite: 'Bert Hickman, Tesla Coil Mailing List, 17 Feb 2009', url: 'https://pupman.com/listarchives/2009/Feb/msg00187.html' },
    {
      cite: 'Les Renardières Group, Double impulse tests of long airgaps, part 2: leader decay and reactivation, IEE Proc. A 133 (1986) 410',
      url: 'https://doi.org/10.1049/ip-a-1.1986.0064',
    },
  ],
  lenz: [{ cite: 'Udo Lenz, Spark models, revisited, Tesla Coil Mailing List, 17 Oct 2012', url: 'https://pupman.com/listarchives/2012/Oct/msg00125.html' }],
  acoustic: [
    {
      cite: 'D. Hufschläger, M. Gaal, Sending and receiving acoustic waves using atmospheric pressure plasmas, DAGA 2022, 923–926',
      url: 'https://pub.dega-akustik.de/DAGA_2022/data/articles/000178.pdf',
    },
  ],
  syntherrupter: [
    { cite: 'Max Zuidberg, Syntherrupter 4.2.2: MIDI.cpp, ToneList.cpp, Coil.cpp, Output.cpp, 2022', url: 'https://github.com/MMMZZZZ/Syntherrupter/tree/v4.2.2' },
  ],
  calib: [],
  model: [],
};
