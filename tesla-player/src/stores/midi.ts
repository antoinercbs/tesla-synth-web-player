import { defineStore } from 'pinia';
import type { Output } from 'webmidi';
import {
  sendSysex as helperSendSysex,
  sendLiveOntimeAdjust as helperSendLiveOntimeAdjust,
  sendLiveDutyAdjust as helperSendLiveDutyAdjust,
  type SysexOutput,
} from '@/utils/live-sysex-helper';
import type { CoilConfig, MidiFile, Song } from '@/types/domain';

interface MidiState {
  midiOutput: Output | null;
  midiOutput2: Output | null;
  midiOutputList: Output[] | null;
  midiFileList: MidiFile[];
  midiSongList: Song[];
  /** Auto-start a track on select / when the previous one ends (persisted). */
  autoplay: boolean;
}

export const useMidiStore = defineStore('midi', {
  state: (): MidiState => ({
    midiOutput: null,
    midiOutput2: null,
    midiOutputList: null,
    midiFileList: [],
    midiSongList: [],
    autoplay: localStorage.getItem('autoplay') === '1', // default OFF
  }),
  actions: {
    setAutoplay(value: boolean) {
      this.autoplay = value;
      localStorage.setItem('autoplay', value ? '1' : '0');
    },
    setMidiOutput(output: Output | null) {
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
