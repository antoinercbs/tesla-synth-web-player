<template>
  <div>
    <div class="columns is-vcentered mx-6 mt-3">
      <div class="column">
        <p class="is-size-5">
          {{isConnected ? $t('message.connectedToServer') : $t('message.disconnectedFromServer')}}
        </p>
      </div>
      <div class="column text-align-right">
        <div class="locale-changer select is-small">
          <select v-model="$i18n.locale" @change="onLanguageChange">
            <option v-for="locale in $i18n.availableLocales" :key="`locale-${locale}`" :value="locale">{{ locale }}</option>
          </select>
        </div>
      </div>
    </div>
    <div class="mx-6 my-3">
      <div class="tile is-ancestor">
        <div class="tile is-vertical is-9">
          <div class="tile">
            <div class="tile is-parent is-4 is-vertical">
              <midi-output-selector 
              class=" has-background-light tile is-child flex-grow is-flex-grow-1">
              </midi-output-selector>
              <midi-file-uploader 
              class=" has-background-light tile is-child  flex-grow is-flex-grow-1">
              </midi-file-uploader>
              <midi-song-list 
                class=" has-background-light tile is-child  flex-grow is-flex-grow-5"
                @editSong="onEditSong"
                @addToPlaylist="onAddToPlaylist"
                @playSong="onPlaySong">
              </midi-song-list>
            </div>
            <div class=" tile is-parent is-vertical">
                <midi-player 
                id="midi-player"
                class=" has-background-light tile is-child flex-grow is-flex-grow-1"
                ref="player"
                ></midi-player>
                <midi-song-sequencer class=" has-background-light tile is-child flex-grow is-flex-grow-5"
                  @sendToPlayer="onPlaySong"
                  ref="sequencer">
                </midi-song-sequencer>
            </div>
          </div>
          <div class="tile is-parent">
            <syfoh-command-creator class=" has-background-light tile is-child"
              @commandExport="onSysexExport">
            </syfoh-command-creator>
            
          </div>
        </div>
        <div class="tile is-parent">
          <playlist-manager class=" has-background-light tile is-child"
          @playSong="onPlaySong"
          ref="playlist">
          ></playlist-manager>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {WebMidi} from 'webmidi';
import MidiFileUploader from './components/MidiFileUploader.vue';
import MidiOutputSelector from './components/MidiOutputSelector.vue';
import MidiPlayer from './components/MidiPlayer.vue';
import MidiSongList from './components/MidiSongList.vue';
import MidiSongSequencer from './components/MidiSongSequencer.vue';
import PlaylistManager from './components/PlaylistManager.vue';
import SyfohCommandCreator from './components/SyfohCommandCreator.vue';
export default {
  name: 'App',
  metaInfo: {
    title: "Tesla Player - Clubelek"
  },
  components: {
    SyfohCommandCreator,
    MidiOutputSelector,
    MidiSongSequencer,
    MidiFileUploader,
    MidiSongList,
    PlaylistManager,
    MidiPlayer
  },
  data: function() {
    return {
      isConnected: false,
    }
  },
  methods: {
    onEnabled() {
      console.log('MIDI enabled!');
      WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name, output.id));
      this.$store.commit('setMidiOutputList', WebMidi.outputs);
    },
    onSysexExport(sysex) {
      this.$refs.sequencer.addSysex(sysex);
    },
    onEditSong(song) {
      this.$refs.sequencer.loadSong(song);
    },
    onPlaySong(song) {
      this.$refs.player.loadSong(song);
    },
    onAddToPlaylist(songId) {
      this.$refs.playlist.addSongById(songId);
    },
    onLanguageChange() {
      localStorage.setItem('locale', this.$i18n.locale);
    }
  },
  mounted: function() {
    WebMidi.enable({sysex: true}).then(this.onEnabled).catch(err => alert(err));
    this.axios.get('/api/midi')
      .then(response => {
          this.$store.commit('setMidiFileList', response.data);
      })
      .catch(error => {
          console.log(error);
      });
    this.axios.get('/api/songs')
      .then(response => {
          this.$store.commit('setMidiSongList', response.data);
      })
      .catch(error => {
          console.log(error);
      });
    var ping = () => {
      this.axios.get('/api/ping').then(() => {
        this.isConnected = true;
      }).catch(() => {
        this.isConnected = false;
      });
    }
    ping();
    setInterval(ping, 10000);
  }
}
</script>

<style>
.locale-changer {
  float: right;
  
}
</style>
