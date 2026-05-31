import { defineStore } from 'pinia'
import {
  sendSysex as helperSendSysex,
  sendLiveOntimeAdjustForSong as helperSendLiveOntimeAdjustForSong,
  sendLiveDutyAdjustForSong as helperSendLiveDutyAdjustForSong
} from '@/utils/live-sysex-helper'

export const useMidiStore = defineStore('midi', {
  state: () => ({
    midiOutput: null,
    midiOutput2: null,
    midiOutputList: null,
    midiFileList: [],
    midiSongList: [],
    settings: {
      enableSecondMidiOutput: false
    }
  }),
  actions: {
    setMidiOutput (output) {
      this.midiOutput = output
    },
    setMidiOutput2 (output) {
      this.midiOutput2 = output
    },
    setMidiOutputList (list) {
      this.midiOutputList = list
    },
    setMidiFileList (list) {
      this.midiFileList = list
    },
    addMidiFileToList (file) {
      this.midiFileList.push(file)
    },
    deleteMidiFile (fileId) {
      this.midiFileList = this.midiFileList.filter(file => file.id !== fileId)
    },
    setMidiSongList (list) {
      this.midiSongList = list
    },
    addMidiSongToList (song) {
      this.midiSongList.push(song)
    },
    updateMidiSong (song) {
      const index = this.midiSongList.findIndex(s => s.id === song.id)
      this.midiSongList.splice(index, 1, song)
    },
    deleteMidiSong (songId) {
      this.midiSongList = this.midiSongList.filter(song => song.id !== songId)
    },
    saveSettings () {
      localStorage.setItem('settings', JSON.stringify(this.settings))
    },
    loadSettings () {
      const settings = JSON.parse(localStorage.getItem('settings'))
      if (settings) this.settings = settings
    },
    sendSysex (payload) {
      helperSendSysex(this.midiOutput, payload)
    },
    sendProgramChange (program) {
      console.log('Set program to ' + program)
      this.midiOutput.sendProgramChange(program, {
        channels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
      })
    },
    sendLiveOntimeAdjustForSong ({ song, ontimeRatio }) {
      helperSendLiveOntimeAdjustForSong(song, ontimeRatio, this.midiOutput)
    },
    sendLiveDutyAdjustForSong ({ song, dutyRatio }) {
      helperSendLiveDutyAdjustForSong(song, dutyRatio, this.midiOutput)
    }
  }
})
