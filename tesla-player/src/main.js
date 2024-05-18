import { createApp } from 'vue'
import { createStore } from 'vuex'
import App from './App.vue'

import axios from 'axios'
import VueAxios from 'vue-axios'
axios.defaults.baseURL = process.env.VUE_APP_BASE_URL

require('@/assets/main.scss');
import '@fortawesome/fontawesome-free/css/all.css'
import '@fortawesome/fontawesome-free/js/all.js'
import { sendLiveOntimeAdjustForSong, sendLiveDutyAdjustForSong, sendSysex } from './utils/live-sysex-helper'

const store = createStore({
    state () {
      return {
        midiOutput: null,
        midiOutput2: null,
        midiOutputList: null,
        midiFileList: [],
        midiSongList: [],
        settings: {
          enableSecondMidiOutput: false
        }
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
        state.midiSongList.splice(index, 1, midiSong);
      },
      deleteMidiSong( state, midiSongId ) {
        state.midiSongList = state.midiSongList.filter( midiSong => midiSong.id !== midiSongId );
      },
      saveSettings(state) {
        localStorage.setItem('settings', JSON.stringify(state.settings));
      },
      loadSettings(state) {
        const settings = JSON.parse(localStorage.getItem('settings'));
        if (settings) state.settings = settings;
      }
    },
    actions: {
        sendSysex (context, payload) {
            sendSysex(context.state.midiOutput, payload);
        },
        sendProgramChange(context, program) {
            console.log("Set program to " + program);
            context.state.midiOutput.sendProgramChange(program, {channels:[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]});
        },
        sendLiveOntimeAdjustForSong(context, {song, ontimeRatio}) {
            sendLiveOntimeAdjustForSong(song, ontimeRatio, context.state.midiOutput);
        },
        sendLiveDutyAdjustForSong(context, {song, dutyRatio}) {
          sendLiveDutyAdjustForSong(song, dutyRatio, context.state.midiOutput);
        }
    },

});

store.commit('loadSettings');

import { createI18n } from 'vue-i18n'
import {messages} from './assets/translations'

const i18n = createI18n({
  locale: localStorage.getItem('locale') || 'en',
  fallbackLocale: 'en',
  messages
})

createApp(App).use(store).use(VueAxios, axios).use(i18n).mount('#app')
