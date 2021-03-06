import { createApp } from 'vue'
import { createStore } from 'vuex'
import App from './App.vue'

import axios from 'axios'
import VueAxios from 'vue-axios'
axios.defaults.baseURL = process.env.VUE_APP_BASE_URL

require('@/assets/main.scss');
import '@fortawesome/fontawesome-free/css/all.css'
import '@fortawesome/fontawesome-free/js/all.js'

const store = createStore({
    state () {
      return {
        midiOutput: null,
        midiOutput2: null,
        midiOutputList: null,
        midiFileList: [],
        midiSongList: [],
      }
    },
    mutations: {
      setMidiOutput (state, newMidiOutput) {
        state.midiOutput = newMidiOutput;
      },
      setMidiOutput2 (state, newMidiOutput) {
        state.midiOutput2 = newMidiOutput;
      },
      setMidiOutputList (state, newMidiOutputList) {
        state.midiOutputList = newMidiOutputList
      },
      setMidiFileList (state, newMidiFileList) {
        state.midiFileList = newMidiFileList
      },
      addMidiFileToList(state, newMidiFile) {
        state.midiFileList.push(newMidiFile)
      },
      deleteMidiFile( state, midiFileId ) {
        state.midiFileList = state.midiFileList.filter( midiFile => midiFile.id !== midiFileId )
      },
      setMidiSongList(state, newMidiSongList) {
        state.midiSongList = newMidiSongList
      },
      addMidiSongToList(state, newMidiSong) {
        state.midiSongList.push(newMidiSong)
      },
      updateMidiSong(state, midiSong) {
        const index = state.midiSongList.findIndex( song => song.id === midiSong.id );
        state.midiSongList.splice(index, 1, midiSong)
      },
      deleteMidiSong( state, midiSongId ) {
        state.midiSongList = state.midiSongList.filter( midiSong => midiSong.id !== midiSongId )
      }
    },
    actions: {
        sendSysex (context, payload) {
            var strBytes = payload.split(' ');
            var bytes = strBytes.map(str => parseInt(str, 16));
            console.log(bytes.slice(1, 4));
            console.log(bytes.slice(4, 15));
            context.state.midiOutput.sendSysex(bytes.slice(1, 4), bytes.slice(4, 15));
        },
        sendProgramChange(context, program) {
            console.log("Set program to " + program);
            context.state.midiOutput.sendProgramChange(program, {channels:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]});
        }
    }
  })

import { createI18n } from 'vue-i18n'
import {messages} from './assets/translations'

const i18n = createI18n({
  locale: 'en',
  fallbackLocale: 'en',
  messages
})

createApp(App).use(store).use(VueAxios, axios).use(i18n).mount('#app')
