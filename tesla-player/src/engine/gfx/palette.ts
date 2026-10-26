/**
 * The 3D's own colours, named by what they are (sRGB): a picture of the real
 * thing, so copper, aluminium, the sparks' violet and the lamps keep theirs
 * whatever the theme. What follows the theme comes in through SceneColors
 * (the mats' lines, the chosen handle). The handles' own stay off the fibre
 * caps' hues: those name the outputs.
 */
export const GFX_PALETTE = {
  /** The hall's light: the sky and the ground of the hemisphere, the key light, the fill. */
  light: { sky: 0xbfd2ff, ground: 0x101420, key: 0xffffff, fill: 0x9fb4ff },
  metal: {
    copper: 0xc8743c,
    aluminium: 0xc9d1dc,
    steel: 0x8a929c,
    /** A clamp's zinc, the truss's tubes. */
    zinc: 0x9aa3ad,
    polished: 0xd9dde2,
    brass: 0xc9a24a,
    /** A table's legs. */
    blackSteel: 0x2a2c31,
  },
  /** Printed parts, the hub, the box's faces, the secondary's form. */
  plastic: { printed: 0x15171c, hub: 0x1c1e24, plexi: 0x1b2340, form: 0xe8e6df },
  wood: 0x3a2f25,
  /** The secondary's winding: its turns, light and dark, on the form's copper. */
  winding: { base: 0xb8652f, light: 0xd98a4e, dark: 0x8f4a22 },
  /** An earth cable's stripes. */
  earth: { green: 0x2f8f3a, yellow: 0xe2c21c },
  /** The box's lamps. */
  lamp: { power: 0x2bd96b, signal: 0x3d8bff, ocd: 0xff3b3b },
  spark: {
    /** The streamers' core, halo and glow; a strike's. */
    looks: [0xeee4ff, 0x9c6cff, 0x5b34d8, 0xffffff, 0xd2c0ff, 0x8b6cff],
    /** Each streamer look from a weak bang to a strong one. */
    energy: [[0xddccff, 0xffffff], [0x8a50ff, 0xae88ff], [0x4c22d0, 0x6a46e0]],
    /** A strike's hot core, a tip's glow and its corona. */
    core: 0xffffff,
    tip: 0xffffff,
    corona: 0xa77bff,
    /** The arcs' light, a strike's flash. */
    arcLight: 0xb89cff,
    hitLight: 0xe6dcff,
    /** A strike's spot on the mat, from its heart out: where (0..1), colour, opacity. */
    spot: [[0, 0xffffff, 1], [0.12, 0xf0e6ff, 0.9], [0.35, 0xaa82ff, 0.35], [1, 0x6e46ff, 0]],
  },
  /** A cage's welded mesh; a texture's mask (white: the material's own colour shows). */
  wire: 0xc9d1dc,
  mask: 0xffffff,
  knight: {
    /** The mail's texture: the gaps, the rings; the mail's tint, the gloves'. */
    mailGap: 0x4a4f57,
    mailRing: 0xdfe3e8,
    mail: 0xd4d8de,
    glove: 0x9aa4b2,
    belt: 0x111215,
    canvas: 0x2f4a78,
    sole: 0xeeeeee,
  },
  /** The handles: what moves or turns, the bright ones (a tube's tip, a lit arrow, the notches), the ones that size; the chosen one when the theme gives none. */
  handle: { grip: 0x5b8cff, bright: 0xffffff, size: 0xe8ecf6, chosen: 0xb9a4ff },
  /** The coil sheet's dashed ring around the tip, as far as the arcs reach. */
  reach: 0x9cb8ff,
  decor: {
    /** Grains of a floor's concrete or stone. */
    speck: 0xffffff,
    hall: { centre: 0x0f1320, middle: 0x0a0d17, edge: 0x060912, background: 0x060912 },
    lab: {
      floor: 0x26282c, blocks: 0x202328, mortar: 0x16181c, sign: 0xe8c21a, signInk: 0x111111, crate: 0x2a3340, background: 0x0a0c11,
    },
    concert: {
      deck: 0x0e0f12, pit: 0x07080a, curtainDark: 0x100509, curtainLight: 0x2e0b12, lamp: 0x15171c, monitor: 0x0b0c0f, background: 0x050609,
    },
    /** The cyclorama: its foot, and its top where it fades. */
    cyclo: { foot: 0x4b4b50, top: 0x2c2c2f, background: 0x0b0c10 },
  },
} as const;

/** A palette colour as CSS, for what is drawn on a canvas. */
export const css = (c: number, alpha = 1): string =>
  alpha >= 1 ? `#${c.toString(16).padStart(6, '0')}` : `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${alpha})`;

/** Between two palette colours, mixed channel by channel as CSS mixes them (sRGB), for a canvas. */
export const mixCss = (a: number, b: number, t: number): string => {
  const ch = (s: number) => (((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) | 0;
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
