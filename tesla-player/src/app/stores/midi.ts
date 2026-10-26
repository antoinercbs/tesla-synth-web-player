import type { BoardStatus } from '@/model/sysex/board';
import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import type { Output } from 'webmidi';
import { sendSysex as helperSendSysex, type SysexOutput } from '@/engine/serial/live-sysex-helper';
import { SYNTH_OUTPUT_ID, type MidiSink } from '@/engine/audio/synth';
import { SERIAL_OUTPUT_ID, type SerialMidiOutput } from '@/engine/serial/serial-midi';
import type { DeviceLink } from '@/model/devices/device-link';
import { SndEnvPrograms } from '@/model/sysex/envelopes';
import { DevDrivers, type DeviceDriver } from '@/model/devices/driver';
import { DevProfiles, type OutputIdentity } from '@/model/devices/registry';
import type { DeviceId, DeviceProfile } from '@/model/devices/types';
import { DevCoilLimits, type CoilLimits, type CoilLimitsSource, type SimLimits } from '@/model/devices/coil-limits';
import { lastCoilLimits, rememberCoilLimits } from '@/engine/devices/coil-limits';
import { MAX_COILS, type AppConfig, type AppTag, type CoilConfig, type CustomEnvelope, type Song } from '@/model/domain';
import { forgetQueuedSong } from '@/ui/components/player/queue';
import type { TeslaCoil } from '@/model/coils/inventory';
import { PhyResponse, type CoilResponse } from '@/model/coils/response';
import { PhySpec, type CoilSpec } from '@/model/coils/spec';
import { PhyStage } from '@/model/coils/stage';
import { onPhysicsSeeded, physicsPrefetch } from '@/engine/sim/run';

// in a ref: the pickers' computeds follow the library's edits
SndEnvPrograms.holdIn(shallowRef(new Map()));

/** A song's places, by place: what the board is set to for its coil, the coil's sheet, its physics. */
export interface Places { limits: SimLimits[]; specs: (CoilSpec | null)[]; physics: (CoilResponse | null)[] }

interface MidiState {
  /** Output 1 (coils): a real WebMidi output or the built-in Tesla synth. */
  midiOutput: MidiSink | null;
  midiOutput2: Output | null;
  midiOutputList: Output[] | null;
  /** The songs, each with its own MIDI file (song.midiFile): there is no file library. */
  midiSongList: Song[];
  tagList: AppTag[];
  /** Library envelopes (programs 20-63). Mutate through the actions only: they
   *  keep the envelope registry (synth, VU, pickers) in step. */
  envelopeList: CustomEnvelope[];
  /** Auto-start a track on select / when the previous one ends (persisted). */
  autoplay: boolean;
  /** Manual timing offset (ms) applied to the 2nd output to compensate a hardware
   *  latency difference between interfaces. Per-machine calibration (persisted). */
  output2OffsetMs: number;
  /** Global operator config (default coil count; the coil names before the inventory). */
  appConfig: AppConfig;
  /** The real coils, in inventory order; empty from a server that predates them. */
  coilList: TeslaCoil[];
  /** Bumped after a desktop sync so views holding ad-hoc data (e.g. playlists,
   *  which are not in this store) know to re-read from the API. */
  dataRevision: number;
  /** True while output 1 is a live bidirectional serial link to a Syntherrupter.
   *  Gates access to the device-config page. */
  serialConnected: boolean;
  /** Human label of the connected serial port (for the sidebar). */
  serialPortLabel: string;
  /** Link with read-back to the device, used by the config page: the serial
   *  link, or a Web MIDI output paired with the device's input. null = none. */
  deviceLink: DeviceLink | null;
  /** Bumped by panic(): the player, Live and Fixed modes stop on it, whichever runs. */
  panicRev: number;
  /** Name of the coil output that went away (unplugged, link dropped) and was
   *  replaced by the built-in synth; null once it is back or another is chosen. */
  outputLost: string | null;
  /** The board this machine drives when the output does not say which one
   *  (the built-in synth, a MIDI interface…). Per machine (persisted). */
  boardId: DeviceId;
  /** What the board behind output 1 last said of itself (app/board-monitor.ts);
   *  null when it cannot tell, or has not yet. */
  boardStatus: BoardStatus | null;
  /** Protection trips per coil since the board started, read on a trip. */
  boardTrips: number[];
  /** The board stopped answering its heartbeat. */
  boardSilent: boolean;
  /** Each coil's limits as the board gave them (max ontime, max duty, min ontime,
   *  voices), by coil index; empty when there is no board to ask (app/board-monitor.ts). */
  /** As the board gave them now; empty without a board to ask. */
  coilLimits: CoilLimits[];
  /** As this kind of board last gave them on this machine. */
  lastCoilLimits: CoilLimits[];
}

/** Clamp the 2nd-output offset to a safe range (< the player look-ahead). */
/** The limits a reading holds: its numbers only (a stored one may be anything). */
function known(limits: CoilLimits | undefined): CoilLimits {
  const out: CoilLimits = {};
  for (const k of ['ontimeUs', 'duty', 'minOntimeUs', 'voices'] as const) {
    const v = limits?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function clampOffset(ms: number): number {
  return Number.isFinite(ms) ? Math.max(-200, Math.min(200, Math.round(ms))) : 0;
}

/** What a coil output tells of its board: nothing for the built-in synth. */
function outputIdentity(sink: MidiSink | null): OutputIdentity | null {
  if (!sink || sink.id === SYNTH_OUTPUT_ID) return null;
  if (sink.id === SERIAL_OUTPUT_ID) return { usb: (sink as SerialMidiOutput).usb ?? undefined };
  return { midiName: sink.name };
}

// the coils' responses come when worked out (~0.2 s a sheet, off the page: engine/sim): the
// getters that read them read this too, and read again when more arrive
const physicsTick = shallowRef(0);
onPhysicsSeeded(() => { physicsTick.value++; });

export const useMidiStore = defineStore('midi', {
  state: (): MidiState => ({
    midiOutput: null,
    midiOutput2: null,
    midiOutputList: null,
    midiSongList: [],
    tagList: [],
    envelopeList: [],
    autoplay: localStorage.getItem('autoplay') === '1', // default OFF
    output2OffsetMs: clampOffset(Number(localStorage.getItem('midiOutput2Offset'))),
    appConfig: { coilNames: [], defaultCoilCount: 3 },
    coilList: [],
    dataRevision: 0,
    serialConnected: false,
    serialPortLabel: '',
    deviceLink: null,
    panicRev: 0,
    outputLost: null,
    boardId: DevProfiles.byId(localStorage.getItem('boardId') ?? DevProfiles.DEFAULT_ID).id,
    boardStatus: null,
    boardTrips: [],
    boardSilent: false,
    coilLimits: [],
    lastCoilLimits: lastCoilLimits(DevProfiles.byId(localStorage.getItem('boardId') ?? DevProfiles.DEFAULT_ID).id),
  }),
  getters: {
    coilByUuid: (state) => (uuid: string | null | undefined): TeslaCoil | null =>
      (uuid ? state.coilList.find((c) => c.uuid === uuid) ?? null : null),
    /**
     * The coil on each output of the board (its uuid, '' free): the saved
     * wiring, else the inventory's coil k on output k. Indexed like the outputs:
     * everything "by coil index" below is by output.
     */
    wiring(state): string[] {
      const w = state.appConfig.wiring;
      return Array.from({ length: MAX_COILS }, (_, o) => (w ? w[o] ?? '' : state.coilList[o]?.uuid ?? ''));
    },
    wiredCoil(): (output: number) => TeslaCoil | null {
      return (output) => this.coilByUuid(this.wiring[output]);
    },
    /** The output a coil is wired to, −1 when none. */
    outputOf(): (uuid: string) => number {
      return (uuid) => this.wiring.indexOf(uuid);
    },
    /** The coil at place k of a song (its own, else the inventory's coil k). */
    placeCoil: (state) => (coils: readonly CoilConfig[], k: number): TeslaCoil | null => new PhyStage(state.coilList).placeCoil(coils, k),
    /** A coil's limits, as its sheet sets the board for it (the defaults without a sheet). */
    limitsOf: () => (coil: TeslaCoil | null): CoilLimits => (coil ? new PhySpec(PhySpec.resolve(coil.spec)).limits : { ...DevCoilLimits.DEFAULT }),
    /** A coil's physics, from its sheet: null without one, or until it is worked out (asked for here, then read again). */
    physicsOf: () => (coil: TeslaCoil | null): CoilResponse | null => {
      if (!coil) return null;
      void physicsTick.value;
      const spec = PhySpec.resolve(coil.spec);
      const r = PhyResponse.cached(spec);
      if (!r) void physicsPrefetch.prefetch([spec]);
      return r;
    },
    /** Each output's coil sheet (null: none wired). */
    coilSpecs(): (CoilSpec | null)[] {
      return Array.from({ length: MAX_COILS }, (_, o) => {
        const c = this.wiredCoil(o);
        return c ? PhySpec.resolve(c.spec) : null;
      });
    },
    /** The name of the coil on an output (the inventory's, else the old settings'), or '' if none. */
    coilName(state): (index: number) => string {
      return (index) => (state.coilList.length ? this.wiredCoil(index)?.name : state.appConfig.coilNames[index]) ?? '';
    },
    /** Each output's physics, from the sheet of the coil wired to it (null: none, or no sheet). */
    coilResponses(): (CoilResponse | null)[] {
      return Array.from({ length: MAX_COILS }, (_, o) => this.physicsOf(this.wiredCoil(o)));
    },
    /** By place: the limits, the sheet and the physics of a song's coils (the outputs' before the inventory, without sheets). */
    placesOf(state): (coils: readonly CoilConfig[], count: number) => Places {
      return (coils, count) => {
        if (!state.coilList.length) {
          return {
            limits: this.effectiveCoilLimits.slice(0, count).map((l) => ({ ...DevCoilLimits.DEFAULT, ...l }) as SimLimits),
            specs: Array.from({ length: count }, () => null),
            physics: this.coilResponses.slice(0, count),
          };
        }
        const real = Array.from({ length: count }, (_, k) => this.placeCoil(coils, k));
        return {
          limits: real.map((c) => ({ ...DevCoilLimits.DEFAULT, ...this.limitsOf(c) }) as SimLimits),
          specs: real.map((c) => (c ? PhySpec.resolve(c.spec) : null)),
          physics: real.map((c) => this.physicsOf(c)),
        };
      };
    },
    /** The name of the inventory's coil at a rank (Accord's coils), else the old settings'. */
    inventoryName: (state) => (index: number): string =>
      (state.coilList.length ? state.coilList[index]?.name : state.appConfig.coilNames[index]) ?? '',
    /** Every output's coil name. */
    coilNames(state): string[] {
      return state.coilList.length ? Array.from({ length: MAX_COILS }, (_, o) => this.wiredCoil(o)?.name ?? '') : state.appConfig.coilNames;
    },
    /** True when output 1 is the built-in emulated synth (no real hardware). */
    isSynthOutput: (state): boolean => state.midiOutput?.id === SYNTH_OUTPUT_ID,
    /** True when output 1 is the bidirectional serial Syntherrupter link. */
    isSerialOutput: (state): boolean => state.midiOutput?.id === SERIAL_OUTPUT_ID,
    /** The board behind output 1: recognised on it, else this machine's. */
    deviceProfile: (state): DeviceProfile => DevProfiles.resolve(outputIdentity(state.midiOutput), state.boardId),
    /** Output 1 says which board it is (else the board is this machine's choice). */
    deviceDetected: (state): boolean => DevProfiles.detect(outputIdentity(state.midiOutput)) != null,
    /** How to talk to the board behind output 1. */
    driver: (state): DeviceDriver => DevDrivers.of(DevProfiles.resolve(outputIdentity(state.midiOutput), state.boardId)),
    /** How to talk to the board behind `sink`, e.g. an output just left. */
    driverOf: (state) => (sink: MidiSink | null): DeviceDriver =>
      DevDrivers.of(DevProfiles.resolve(outputIdentity(sink), state.boardId)),
    /** The board the built-in synth stands for, whatever output 1 is. */
    emulatorDriver: (state): DeviceDriver => DevDrivers.of(DevProfiles.byId(state.boardId)),
    /** The board's protection is latched: nothing can play until it is cleared. */
    boardLatched: (state): boolean => state.boardStatus?.latched ?? false,
    /**
     * Every output's limits: the board's now (what it really holds), else the
     * sheet of the coil wired to it (what it is to hold, and the synth holds),
     * its last reading, the defaults.
     */
    effectiveCoilLimits(state): CoilLimits[] {
      return Array.from({ length: MAX_COILS }, (_, i) => {
        const coil = this.wiredCoil(i);
        return {
          ...DevCoilLimits.DEFAULT, ...known(state.lastCoilLimits[i]),
          ...(coil ? new PhySpec(PhySpec.resolve(coil.spec)).limits : {}),
          ...known(state.coilLimits[i]),
        };
      });
    },
    coilLimit(): (index: number) => CoilLimits {
      return (index) => this.effectiveCoilLimits[index] ?? DevCoilLimits.DEFAULT;
    },
    coilLimitSource(state): (index: number) => CoilLimitsSource {
      return (index) => (Object.keys(known(state.coilLimits[index])).length ? 'board'
        : this.wiredCoil(index) ? 'sheet'
          : Object.keys(known(state.lastCoilLimits[index])).length ? 'last' : 'default');
    },
  },
  actions: {
    /** Signal that server-side data may have changed (e.g. after a sync). */
    bumpDataRevision() {
      this.dataRevision += 1;
    },
    setAppConfig(config: AppConfig) {
      this.appConfig = {
        coilNames: Array.isArray(config.coilNames) ? config.coilNames : [],
        defaultCoilCount: config.defaultCoilCount || 3,
        wiring: Array.isArray(config.wiring) ? config.wiring.map((u) => (typeof u === 'string' ? u : '')) : null,
      };
    },
    setCoilList(list: TeslaCoil[]) {
      this.coilList = [...list].sort((a, b) => a.position - b.position || a.id - b.id);
      // their responses, worked out ahead off the page: the pages that show them find them ready
      void physicsPrefetch.prefetch(this.coilList.map((c) => PhySpec.resolve(c.spec)));
    },
    upsertCoil(coil: TeslaCoil) {
      this.setCoilList([...this.coilList.filter((c) => c.id !== coil.id), coil]);
    },
    removeCoil(id: number) {
      this.coilList = this.coilList.filter((c) => c.id !== id);
    },
    setAutoplay(value: boolean) {
      this.autoplay = value;
      localStorage.setItem('autoplay', value ? '1' : '0');
    },
    // the outputs, their list and the board's link stay raw: a proxy would stand between every send and its port
    setMidiOutput(output: MidiSink | null) {
      this.midiOutput = output && markRaw(output);
    },
    /** Record the serial link state (label = connected port, null = disconnected). */
    setSerialConnection(label: string | null) {
      this.serialConnected = label != null;
      this.serialPortLabel = label ?? '';
    },
    /** Set the read-back link used by the config page (pass a markRaw'd object). */
    setDeviceLink(link: DeviceLink | null) {
      this.deviceLink = link && markRaw(link);
    },
    setBoardId(id: DeviceId) {
      this.boardId = DevProfiles.byId(id).id;
      localStorage.setItem('boardId', this.boardId);
      this.lastCoilLimits = lastCoilLimits(this.boardId);
    },
    setBoardStatus(status: BoardStatus | null) {
      this.boardStatus = status;
    },
    setBoardTrips(trips: number[]) {
      this.boardTrips = trips;
    },
    setBoardSilent(silent: boolean) {
      this.boardSilent = silent;
    },
    setCoilLimits(limits: CoilLimits[]) {
      this.coilLimits = limits;
      this.rememberCoilLimits();
    },
    setCoilLimit(index: number, limits: CoilLimits) {
      const next = Array.from({ length: Math.max(this.coilLimits.length, index + 1) }, (_, i) => this.coilLimits[i] ?? {});
      next[index] = limits;
      this.coilLimits = next;
      this.rememberCoilLimits();
    },
    /** What the board just gave becomes its last reading; what it did not give stays. */
    rememberCoilLimits() {
      if (!this.coilLimits.some((l) => Object.keys(known(l)).length)) return;
      const n = Math.max(this.coilLimits.length, this.lastCoilLimits.length);
      this.lastCoilLimits = Array.from({ length: n }, (_, i) => ({ ...known(this.lastCoilLimits[i]), ...known(this.coilLimits[i]) }));
      rememberCoilLimits(this.boardId, this.lastCoilLimits);
    },
    setMidiOutput2(output: Output | null) {
      this.midiOutput2 = output && markRaw(output);
    },
    setOutput2Offset(ms: number) {
      this.output2OffsetMs = clampOffset(ms);
      localStorage.setItem('midiOutput2Offset', String(this.output2OffsetMs));
    },
    setMidiOutputList(list: Output[]) {
      this.midiOutputList = markRaw(list.map((o) => markRaw(o)));
    },
    setMidiSongList(list: Song[]) {
      this.midiSongList = list;
    },
    addMidiSongToList(song: Song) {
      this.midiSongList.push(song);
    },
    setTagList(list: AppTag[]) {
      this.tagList = list;
    },
    setEnvelopeList(list: CustomEnvelope[]) {
      this.envelopeList = [...list].sort((a, b) => a.program - b.program);
      SndEnvPrograms.setCustom(this.envelopeList);
    },
    upsertEnvelope(envelope: CustomEnvelope) {
      this.setEnvelopeList([...this.envelopeList.filter((e) => e.id !== envelope.id), envelope]);
    },
    deleteEnvelope(id: number) {
      this.setEnvelopeList(this.envelopeList.filter((e) => e.id !== id));
    },
    updateMidiSong(song: Song) {
      const index = this.midiSongList.findIndex((s) => s.id === song.id);
      if (index !== -1) this.midiSongList.splice(index, 1, song);
      else this.midiSongList.push(song);
    },
    deleteMidiSong(songId: number) {
      this.midiSongList = this.midiSongList.filter((song) => song.id !== songId);
      forgetQueuedSong(songId);
    },
    sendSysex(payload: string | number[]) {
      if (this.midiOutput) helperSendSysex(this.midiOutput as SysexOutput, payload);
    },
    setOutputLost(name: string | null) {
      this.outputLost = name;
    },
    /**
     * Stop the coils now. Switching the device's modes off beats the notes already
     * queued on a Web MIDI output, which MIDIOutput.clear() can't be relied on to
     * drop; Play, Live and Fixed each switch their mode back on when they start.
     */
    silenceCoils(sink?: MidiSink | null) {
      const out = sink === undefined ? this.midiOutput : sink;
      if (!out) return;
      try {
        for (const frame of this.driverOf(out).silence()) helperSendSysex(out as SysexOutput, frame);
        out.sendAllSoundOff();
      } catch {
        /* an output unplugged meanwhile: nothing left to silence */
      }
      if (out === this.midiOutput) this.midiOutput2?.sendAllSoundOff();
    },
    panic() {
      this.panicRev += 1;
      this.silenceCoils();
    },
  },
});
