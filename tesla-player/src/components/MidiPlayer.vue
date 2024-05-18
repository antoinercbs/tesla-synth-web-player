<template>
  <article class="panel">
    <p class="panel-heading">
        {{$t('title.player')}}
    </p>

    <!-- Currently loaded song title and metadatas -->
    <label class="panel-block">
      <span class="panel-icon">
        <i class="fas fa-music"></i>
      </span>
      <span v-if="song">
         {{$t('label.selectedSong')}} {{song.name}} ({{song.sysex.length}} {{$t('label.configCommands')}})
      </span>
      <span v-else>
        {{$t('label.noSongLoaded')}}
      </span>
    </label>

    <!-- Currently disabled outputs (from the player) -->
    <label class="panel-block">
        <span class="panel-icon">
            <i class="fas fa-hashtag"></i>
        </span>
        <span class="mr-2 ml-2">{{$t('label.disactivatedChannelsOutput1')}}</span>
        <div v-if="channelMapping1Bool" class="buttons has-addons"> 
            <button v-for="(activated, index) in channelMapping1Bool" :key="index"
            class="button is-small" 
            :class="(activated) ? '' : 'is-danger'"
            disabled>
            {{index}}
            </button>
        </div>
    </label>

     <label class="panel-block" v-if="$store.state.settings.enableSecondMidiOutput" >
        <span class="panel-icon">
            <i class="fas fa-hashtag"></i>
        </span>
        <span class="mr-2 ml-2">{{$t('label.disactivatedChannelsOutput2')}}</span>
        <div v-if="channelMapping1Bool" class="buttons has-addons"> 
            <button v-for="(activated, index) in channelMapping2Bool" :key="index"
            class="button is-small" 
            :class="(activated) ? '' : 'is-danger'"
            disabled>
            {{index}}
            </button>
        </div>
    </label>

    <!-- Ontime change slider (between 0 and 200%) -->
    <label class="panel-block">
      <span class="panel-icon">
        <i class="fas fa-wave-square"></i>
      </span>
      <span>{{$t('label.ontimeRatio')}}</span>
      <input type="range" min="0" max="200" step="1" 
        @change="onOntimeRatioChange" 
        v-model="ontimeRatio" 
        class="slider is-fullwidth is-circle is-warning has-output ml-3"
        id="ontimeRatioSlider"
        :disabled="!canPlay && !canStop"
      >
      <output class="is-size-7">{{ontimeRatio}}%</output>
    </label>

    <!-- Duty change slider (between 0 and 200%) -->
    <label class="panel-block">
      <span class="panel-icon">
        <i class="fas fa-wave-square"></i>
      </span>
      <span>{{$t('label.dutyRatio')}}</span>
      <input type="range" min="0" max="200" step="1" 
        @change="onDutyRatioChange" 
        v-model="dutyRatio" 
        class="slider is-fullwidth is-circle is-warning has-output ml-3"
        id="dutyRatioSlider"
        :disabled="!canPlay && !canStop"
      >
      <output class="is-size-7">{{dutyRatio}}%</output>
    </label>

    <!-- Currently played notes visualisation -->
    <label class="panel-block">
      <div class="buttons has-addons" id="midiouts">
        <button class="button is-small" id="midiout1" disabled>0</button>
        <button class="button is-small" id="midiout2" disabled>1</button>
        <button class="button is-small" id="midiout3" disabled>2</button>
        <button class="button is-small" id="midiout4" disabled>3</button>
        <button class="button is-small" id="midiout5" disabled>4</button>
        <button class="button is-small" id="midiout6" disabled>5</button>
        <button class="button is-small" id="midiout7" disabled>6</button>
        <button class="button is-small" id="midiout8" disabled>7</button>
        <button class="button is-small" id="midiout9" disabled>8</button>
        <button class="button is-small" id="midiout10" disabled>9</button>
        <button class="button is-small" id="midiout11" disabled>10</button>
        <button class="button is-small" id="midiout12" disabled>11</button>
        <button class="button is-small" id="midiout13" disabled>12</button>
        <button class="button is-small" id="midiout14" disabled>13</button>
        <button class="button is-small" id="midiout15" disabled>14</button>
        <button class="button is-small" id="midiout16" disabled>15</button>
      </div>
    </label>
    <label class="panel-block is-block mt-2">
      <span class="buttons has-addons columns is-centered">
        <button @click="play"
        class="button"
        :disabled="!canPlay">
          <span class="icon">
            <i class="fas fa-play"></i>
          </span>
          <span>Play</span>
        </button>
        <button @click="stop"
        class="button"
        :disabled="!canStop">
          <span class="icon">
            <i class="fas fa-stop"></i>
          </span>
          <span>Stop</span>
        </button>
        <button @click="panic"
        class="button"
        :disabled="!canPanic">
          <span class="icon">
            <i class="fas fa-bell-slash"></i>
          </span>
          <span>Panic</span>
        </button>
        <button @click="executeConfig"
        class="button"
        :disabled="!canSysex">
          <span class="icon">
            <i class="fas fa-wrench"></i>
          </span>
          <span>{{$t('label.executeConfiguration')}}</span>
        </button>
      </span>
    </label>
    
  </article>
</template>

<script>
import SmfParser from '../smfplayer/js/smfParser.js';
import SmfPlayer from '../smfplayer/js/smfPlayer.js';
export default {
  data: function() {
    return {
      song: null,
      parsedMidiFile: null,
      smfPlayer: null,
      isPlaying: false,
      finishedInterval: null,
      ontimeRatio: 100,
      dutyRatio: 100,
      midiSTimerId: {input:[], output:[]},
      channelMapping1Bool: [false, false, false, false,
                            false, false, false, false,
                            false, false, false, false,
                            false, false, false, false],
      channelMapping2Bool: [false, false, false, false,
                            false, false, false, false,
                            false, false, false, false,
                            false, false, false, false],

    }
  },
  computed: {
    canPlay() {
      return this.parsedMidiFile 
          && this.$store.state.midiOutput
          && !this.isPlaying
    },
    canStop() {
      return this.parsedMidiFile 
          && this.$store.state.midiOutput
          && this.isPlaying
    },
    canPanic() {
      return this.$store.state.midiOutput
    },
    canSysex() {
      return this.parsedMidiFile 
          && this.$store.state.midiOutput
    }
  },
  methods: {
    loadSong(song) {
      this.song = song;
      if (this.smfPlayer) {
        this.stop();
      }
      this.channelMapping1Bool = this.intToBoolArray(this.song.outputMapping1);
      this.channelMapping2Bool = this.intToBoolArray(this.song.outputMapping2);
      this.parsedMidiFile = null;
      this.smfPlayer = null;
      this.loadMidiFile(this.song.midiFile.path)
      .then((midiFile) => {
        var smfParser = new SmfParser();
        this.parsedMidiFile = smfParser.parse(this.arrayBufferToString(midiFile));
        console.log(this.parsedMidiFile)
      });
    },
    executeConfig() {
      this.song.sysex.forEach(cmd => {
          console.log("Executing Sysex:",cmd);
          this.$store.dispatch('sendSysex', cmd.value);
      });
      //this.$store.dispatch('sendProgramChange', 80);
    },

    play(){
      if (this.smfPlayer) {
        this.stop();
      }
      this.isPlaying = true;
      this.executeConfig();
      this.smfPlayer = new SmfPlayer(this.$store.state.midiOutput, 
                                      this.$store.state.midiOutput2,
                                      this.channelMapping1Bool,
                                      this.channelMapping2Bool);
      this.smfPlayer.dispEventMonitor=this.dispEventMonitor;
      this.smfPlayer.init(this.parsedMidiFile, 800, 0);
      this.smfPlayer.startPlay();
      this.finishedInterval = setInterval(() => {
        if (this.smfPlayer.finished) {
          this.$emit('songFinished');
          this.stop();
        }
      }, 100);
    },

    stop() {
      if (this.finishedInterval) {
        clearInterval(this.finishedInterval);
      }
      this.isPlaying = false;
      this.smfPlayer.stopPlay();
    },
    panic() {
      this.$store.state.midiOutput.sendAllSoundOff();
      if (this.$store.state.midiOutput2) this.$store.state.midiOutput2.sendAllSoundOff();
    },

    onOntimeRatioChange() {
      this.$store.dispatch('sendLiveOntimeAdjustForSong', {song: this.song, ontimeRatio: this.ontimeRatio});
    },

    onDutyRatioChange() {
      this.$store.dispatch('sendLiveDutyAdjustForSong', {song: this.song, dutyRatio: this.dutyRatio});
    },

    loadMidiFile(path) {
      return new Promise((resolve, reject) => {
        path = path.substring(1);
        this.axios.get(path, {responseType: 'arraybuffer'})
          .then(response => {
            resolve(response.data);
          })
          .catch(error => {
            reject(error);
          });
      });
    },

    dispEventMonitor(msg, type, latency) {
      var tmp;
      if(typeof msg[0]==="number") {
            tmp=msg[0].toString(16);
            if(tmp.length==1) {
                tmp= "0" + tmp;
            }
        } else if(msg[0].length==4 && msg[0].substr(0,2)=="0x"){
            tmp=msg[0].substr(2, 2);
        } else {
            tmp=msg[0];
        }
      var ch=(parseInt(tmp.substr(1, 1), 16)+1).toString(10);
      if (type != "input") {
        var midiLabel="midiout"+ch;
        var light=document.getElementById(midiLabel);
        if(light.className=="button is-small") {
          setTimeout(() => {
              light.className="button is-small is-warning";
              setTimeout(() => {
                  light.className="button is-small";
              }, 300);
          }, 0);
        } 
      }
    },

    intToBoolArray(int) {
      let output = [];
      for (let i = 0; i < 16; i++) {
          output.push((int & Math.pow(2, i)) > 0);
      }
      return output;
    },
    arrayBufferToString(buffer) {
      return this.binaryToString(String.fromCharCode.apply(null, Array.prototype.slice.apply(new Uint8Array(buffer))));
    },
    binaryToString(binary) {
      var error;

      try {
          return decodeURIComponent(escape(binary));
      } catch (_error) {
          error = _error;
          if (error instanceof URIError) {
              return binary;
          } else {
              throw error;
          }
      }
    }
  },
}
</script>

<style scoped>
#midiouts {
  margin-left: auto;
  margin-right: auto;
}

output {
  min-width: 3.5rem;
}

</style>