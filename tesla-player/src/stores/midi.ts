import { defineStore } from 'pinia';
import type { Output } from 'webmidi';
import {
  sendSysex as helperSendSysex,
  sendLiveOntimeAdjust as helperSendLiveOntimeAdjust,
  sendLiveDutyAdjust as helperSendLiveDutyAdjust,
  type SysexOutput,
} from '@/utils/live-sysex-helper';
import { SYNTH_OUTPUT_ID, type MidiSink } from '@/audio/tesla-synth';
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
  /** Global operator config (coil names + default coil count). */
  appConfig: AppConfig;
}

export const useMidiStore = defineStore('midi', {
  state: (): MidiState => ({
    midiOutput: null,
    midiOutput2: null,
    midiOutputList: null,
    midiFileList: [],
    midiSongList: [],
    autoplay: localStorage.getItem('autoplay') === '1', // default OFF
    appConfig: { coilNames: [], defaultCoilCount: 3 },
  }),
  getters: {
    /** Operator name for a coil index, or '' if unnamed. */
    coilName: (state) => (index: number): string => state.appConfig.coilNames[index] ?? '',
    /** True when output 1 is the built-in emulated synth (no real hardware). */
    isSynthOutput: (state): boolean => state.midiOutput?.id === SYNTH_OUTPUT_ID,
  },
  actions: {
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
    setMidiOutput2(output: Output | null) {
      this.midiOutput2 = output;
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
