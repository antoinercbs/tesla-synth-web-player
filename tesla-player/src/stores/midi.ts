import { defineStore } from 'pinia';
import type { Output } from 'webmidi';
import {
  sendSysex as helperSendSysex,
  sendLiveOntimeAdjust as helperSendLiveOntimeAdjust,
  sendLiveDutyAdjust as helperSendLiveDutyAdjust,
  type SysexOutput,
} from '@/utils/live-sysex-helper';
import { SYNTH_OUTPUT_ID, type MidiSink } from '@/audio/tesla-synth';
import { SERIAL_OUTPUT_ID } from '@/serial/serial-midi';
import type { AppConfig, CoilConfig, MidiFile, Song } from '@/types/domain';

interface MidiState {
  /** Output 1 (coils): a real WebMidi output or the built-in Tesla synth. */
  midiOutput: MidiSink | null;
  midiOutput2: Output | null;
  midiOutputList: Output[] | null;
  midiFileList: MidiFile[];
  midiSongList: Song[];
  /** Auto-start a track on select / when the previous one ends (persisted). */
  autoplay: boolean;
  /** Manual timing offset (ms) applied to the 2nd output to compensate a hardware
   *  latency difference between interfaces. Per-machine calibration (persisted). */
  output2OffsetMs: number;
  /** Global operator config (coil names + default coil count). */
  appConfig: AppConfig;
  /** Bumped after a desktop sync so views holding ad-hoc data (e.g. playlists,
   *  which are not in this store) know to re-read from the API. */
  dataRevision: number;
  /** True while output 1 is a live bidirectional serial link to a Syntherrupter.
   *  Gates access to the device-config page. */
  serialConnected: boolean;
  /** Human label of the connected serial port (for the sidebar). */
  serialPortLabel: string;
}

/** Clamp the 2nd-output offset to a safe range (< the player look-ahead). */
function clampOffset(ms: number): number {
  return Number.isFinite(ms) ? Math.max(-200, Math.min(200, Math.round(ms))) : 0;
}

export const useMidiStore = defineStore('midi', {
  state: (): MidiState => ({
    midiOutput: null,
    midiOutput2: null,
    midiOutputList: null,
    midiFileList: [],
    midiSongList: [],
    autoplay: localStorage.getItem('autoplay') === '1', // default OFF
    output2OffsetMs: clampOffset(Number(localStorage.getItem('midiOutput2Offset'))),
    appConfig: { coilNames: [], defaultCoilCount: 3 },
    dataRevision: 0,
    serialConnected: false,
    serialPortLabel: '',
  }),
  getters: {
    /** Operator name for a coil index, or '' if unnamed. */
    coilName: (state) => (index: number): string => state.appConfig.coilNames[index] ?? '',
    /** True when output 1 is the built-in emulated synth (no real hardware). */
    isSynthOutput: (state): boolean => state.midiOutput?.id === SYNTH_OUTPUT_ID,
    /** True when output 1 is the bidirectional serial Syntherrupter link. */
    isSerialOutput: (state): boolean => state.midiOutput?.id === SERIAL_OUTPUT_ID,
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
      };
    },
    setAutoplay(value: boolean) {
      this.autoplay = value;
      localStorage.setItem('autoplay', value ? '1' : '0');
    },
    setMidiOutput(output: MidiSink | null) {
      this.midiOutput = output;
    },
    /** Record the serial link state (label = connected port, null = disconnected). */
    setSerialConnection(label: string | null) {
      this.serialConnected = label != null;
      this.serialPortLabel = label ?? '';
    },
    setMidiOutput2(output: Output | null) {
      this.midiOutput2 = output;
    },
    setOutput2Offset(ms: number) {
      this.output2OffsetMs = clampOffset(ms);
      localStorage.setItem('midiOutput2Offset', String(this.output2OffsetMs));
    },
    setMidiOutputList(list: Output[]) {
      this.midiOutputList = list;
    },
    setMidiFileList(list: MidiFile[]) {
      this.midiFileList = list;
    },
    addMidiFileToList(file: MidiFile) {
      this.midiFileList.push(file);
    },
    deleteMidiFile(fileId: number) {
      this.midiFileList = this.midiFileList.filter((file) => file.id !== fileId);
    },
    setMidiSongList(list: Song[]) {
      this.midiSongList = list;
    },
    addMidiSongToList(song: Song) {
      this.midiSongList.push(song);
    },
    updateMidiSong(song: Song) {
      const index = this.midiSongList.findIndex((s) => s.id === song.id);
      if (index !== -1) this.midiSongList.splice(index, 1, song);
      else this.midiSongList.push(song);
    },
    deleteMidiSong(songId: number) {
      this.midiSongList = this.midiSongList.filter((song) => song.id !== songId);
    },
    sendSysex(payload: string | number[]) {
      if (this.midiOutput) helperSendSysex(this.midiOutput as SysexOutput, payload);
    },
    sendLiveOntimeAdjust({ coils, ratio }: { coils: CoilConfig[]; ratio: number }) {
      if (this.midiOutput) helperSendLiveOntimeAdjust(coils, ratio, this.midiOutput as SysexOutput);
    },
    sendLiveDutyAdjust({ coils, ratio }: { coils: CoilConfig[]; ratio: number }) {
      if (this.midiOutput) helperSendLiveDutyAdjust(coils, ratio, this.midiOutput as SysexOutput);
    },
  },
});
