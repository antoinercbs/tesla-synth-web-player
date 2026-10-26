/**
 * The icon of each notion of the app, so that a notion looks the same wherever
 * it shows and an icon keeps one meaning. Font Awesome names, or the app's own
 * (`tp-…`, ui/styles/components/_app-icon.scss) where it has no glyph; both
 * go wherever an icon class goes. Generic actions (play, save, delete…) keep
 * their Font Awesome names inline.
 */
export const ICONS = {
  /* the hardware */
  coil: 'tp-coil',
  /** Firing the coil for a measurement or a test. */
  trial: 'fa-play',
  primary: 'tp-primary',
  interrupter: 'tp-interrupter',
  fiber: 'tp-fiber',
  /** Ontime and duty: the pulses the interrupter fires. */
  power: 'tp-pulses',
  /** What the device keeps in its own memory, across a reboot. */
  eeprom: 'tp-chip',

  /* the outputs */
  /** The built-in synth standing in for the coils. */
  synth: 'fa-volume-high',
  serial: 'tp-usb',
  midi: 'tp-midi-port',
  /** The second output: speakers playing alongside the coils. */
  speakers: 'tp-speaker-wireless',

  /* playing */
  nowPlaying: 'fa-play',
  live: 'tp-piano',
  /** A fixed frequency, ontime and duty per coil. */
  fixedMode: 'tp-pulses',
  velocity: 'tp-velocity',

  /* a song's sound */
  envelope: 'tp-envelope',
  /** On a coil, an instrument is an envelope program. */
  instrument: 'tp-piano',
  /** The power changing along a song. */
  dynamics: 'tp-pulses-rising',
  stereo: 'tp-stereo',
  /** Spatialisation following the notes' pitch. */
  pitchPan: 'tp-pitch-pan',

  /* tuning */
  tuning: 'tp-tuning',
  arcMeter: 'tp-arc-meter',
  recaptureBackground: 'tp-camera-retake',
  editZone: 'tp-vector-square-edit',
  /** Back to a saved tuning's tap. */
  recall: 'tp-primary',
} as const;
