<template>
    <article class="panel">
    <p class="panel-heading message-header">
        {{$t('title.songEditor')}}
        <button class="button is-dark"
            @click="resetSong">
            <span class="icon">
                <i class="fas fa-file"></i>
            </span>
            <span>{{$t('label.newSong')}}</span>
        </button>
    </p>

    <a class="panel-block">
        <span class="panel-icon">
        <i class="fas fa-music"></i>
        </span>
        <input v-if="editName" type="text" class="input is-small" :placeholder="$t('label.songName')" v-model="name">
        <span v-else>{{name}}</span>
        <button class="button is-small" id="change-name" @click="editName = !editName">
            <span class="icon">
                <i class="fas fa-pen"></i>
            </span>
        </button>   
    </a>

    <label class="panel-block">
        <span class="panel-icon">
            <i class="fas fa-hashtag"></i>
        </span>
        <span class="mr-2 ml-2">{{$t('label.output1Channels')}}</span>
        <div class="buttons has-addons midi-chan-select"> 
            <button v-for="index in outputMapping1Boolean.length" :key="index"
            class="button is-small" 
            :class="(outputMapping1Boolean[index-1]) ? 'is-warning' : ''"
            @click="outputMapping1Boolean[index-1] = !outputMapping1Boolean[index-1]">
            {{index-1}}
            </button>
        </div>
    </label>

    <label class="panel-block"  v-if="$store.state.settings.enableSecondMidiOutput" >
        <span class="panel-icon">
            <i class="fas fa-hashtag"></i>
        </span>
        <span class="mr-2 ml-2">{{$t('label.output2Channels')}}</span>
        <div class="buttons has-addons midi-chan-select"> 
            <button v-for="index in outputMapping2Boolean.length" :key="index"
            class="button is-small" 
            :class="(outputMapping2Boolean[index-1]) ? 'is-warning' : ''"
            @click="outputMapping2Boolean[index-1] = !outputMapping2Boolean[index-1]">
            {{index-1}}
            </button>
        </div>
    </label>

    <label class="panel-block">
        <span class="panel-icon">
            <i class="fas fa-wrench"></i>
        </span>
        <span class="has-text-weight-bold">{{$t('label.syntherrupterConfigCommandsAtStart')}}</span>
    </label>

    <a v-for="(cmd, idx) in sysex" :key="cmd.value" 
        class="panel-block is-flex">
        <span class="panel-icon">
        <i class="fas fa-wrench"></i>
        </span>
        <input v-if="editSysex[idx]" type="text" class="input is-small" placeholder="Sysex syntherrupter command" v-model="sysex[idx].command">
        <span v-else :title="cmd.value">{{cmd.command}}</span>
        <button class="button is-small" id="change-sysex" @click="editSysexCommand(idx)">
            <span v-if="editSysex[idx]" class="icon">
                <i  class="fas fa-check"></i>  
            </span>
            <span v-else class="icon">
                <i  class="fas fa-pen"></i> 
            </span>
        </button>  
        <span class="buttons has-addons">
            <button class="button is-small"
            @click="upSysex(idx)"
            :disabled="idx == 0">
                <span class="icon">
                    <i class="fas fa-angle-up"></i>
                </span>
            </button>
            <button class="button is-small"
            @click="downSysex(idx)"
            :disabled="idx == sysex.length - 1">
                <span class="icon">
                    <i class="fas fa-angle-down"></i>
                </span>
            </button>
            <button class="button is-small is-danger"
            @click="removeSysex(idx)">
                <span class="icon">
                    <i class="fas fa-trash"></i>
                </span>
            </button>
        </span>
    </a>

    <a class="panel-block">
        <span class="panel-icon">
        <i class="fas fa-file-audio" aria-hidden="true"></i>
        </span>
        <div class="select is-fullwidth">
        <select v-model="selectedMidiFileId">
            <option value=''>{{$t('label.noAssociatedMidiFile')}}</option>
            <option v-for="midiFile in $store.state.midiFileList" :key="midiFile.id" 
                :value="midiFile.id">
                {{midiFile.name}}
            </option>
        </select>
        </div>
        <a class="button ml-2"
            v-if="selectedMidiFileId"
            target="_blank"
            :href="'/editor/?songUrl=' + selectedFilePath.substring(1)">
            <span class="icon">
                <i class="fas fa-pen-to-square"></i>
            </span>
        </a>
        <button class="ml-2 button" v-else disabled>
            <span class="icon">
                <i class="fas fa-pen-to-square"></i>
            </span>
        </button>
    </a>

    <label class="panel-block mt-2 is-block">
        <span class="buttons has-addons columns is-centered">
            <button class="button"
            @click="executeConfig">
                <span class="icon">
                    <i class="fas fa-flask-vial"></i>
                </span>
                <span>{{$t('label.executeConfiguration')}}</span>
            </button>
            <button class="button"
            @click="sendToPlayer">
                <span class="icon">
                    <i class="fas fa-play"></i>
                </span>
                <span>{{$t('label.sendToPlayer')}}</span>
            </button>
            <button class="button"
            @click="saveSong">
                <span class="icon">
                    <i class="fas fa-save"></i>  
                </span>
                <span>{{id?$t('label.update'):$t('label.save')}}</span>
            </button>
        </span>
    </label>
</article>
</template>

<script>
export default {
    data: function() {
        return {
            editName: false,
            editSysex: [],
            id: "",
            name : "Sans titre",
            sysex: [{command: "set enable for mode midi-live to 1", value: "f0 00 26 05 01 7f 20 00 00 02 01 00 00 00 00 f7"}],
            selectedMidiFileId: "",
            "outputMapping1Boolean": [true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true],
            "outputMapping2Boolean": [true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true],
        }
    },
    computed: {
        outputMapping1() {
            return this.boolArrayToInt(this.outputMapping1Boolean);
        },
        outputMapping2() {
            return this.boolArrayToInt(this.outputMapping2Boolean);
        },
        selectedFilePath() {
            var file = this.$store.state.midiFileList.find(e => e.id == this.selectedMidiFileId);
            return file.path;
        },
    },

    methods: {
        resetSong() {
            this.id = "";
            this.name = "Sans titre";
            this.sysex = [{command: "set enable for mode midi-live to 1", value: "f0 00 26 05 01 7f 20 00 00 02 01 00 00 00 00 f7"}];
            this.selectedMidiFileId = "";
            this.outputMapping1Boolean = [true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true];
            this.outputMapping2Boolean = [true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true,
                                        true, true, true, true];
        },
        loadSong(song) {
            console.log(song)
            this.sysex = [];
            this.selectedMidiFileId = "";
            this.id = song.id;
            this.name = song.name;
            this.outputMapping1Boolean = this.intToBoolArray(song.outputMapping1);
            this.outputMapping2Boolean = this.intToBoolArray(song.outputMapping2);
            if (song.midiFile) {
                this.selectedMidiFileId = song.midiFile.id;
            } 
            if (song.sysex) {
                if (song.sysex.length > 0) {
                    if (song.sysex[0].value) {
                        this.sysex = song.sysex.sort((a, b) => a.idx-b.idx);
                    }
                }
            }
            this.editSysex = this.sysex.map(() => false);
        },
        boolArrayToInt(boolArray) {
            let output = 0;
            for (let i = 0; i < boolArray.length; i++) {
                if (boolArray[i]) {
                    output += Math.pow(2, i);
                }
            }
            return output;
        },
        intToBoolArray(int) {
            let output = [];
            for (let i = 0; i < 16; i++) {
                output.push((int & Math.pow(2, i)) > 0);
            }
            return output;
        },
        editSysexCommand(idx) {
            if (!this.editSysex[idx])  {
                this.editSysex[idx] = true;
                return;
            }
            this.axios.post(
                '/api/translate-sysex', 
                {sysexCommand: this.sysex[idx].command}
            ).then(response => {
                this.sysex[idx].value = response.data;
                this.editSysex[idx] = false;
            }).catch(error => {
               alert(error);
            });
        },
        addSysex(sysex) {
            console.log(sysex);
            this.sysex.push(sysex);
            this.editSysex = this.sysex.map(() => false);
        },
        upSysex(idx) {
            let tmp = this.sysex[idx];
            this.sysex[idx] = this.sysex[idx-1];
            this.sysex[idx-1] = tmp;
            this.editSysex = this.sysex.map(() => false);
        },
        downSysex(idx) {
            let tmp = this.sysex[idx];
            this.sysex[idx] = this.sysex[idx+1];
            this.sysex[idx+1] = tmp;
            this.editSysex = this.sysex.map(() => false);
        },
        removeSysex(idx) {
            this.sysex.splice(idx, 1);
            this.editSysex = this.sysex.map(() => false);
        },
        executeConfig() {
            this.sysex.forEach(cmd => {
                console.log("Executing Sysex:",cmd);
                this.$store.dispatch('sendSysex', cmd.value);
            });
        },
        saveSong() {
            var data = {
                name: this.name,
                sysex: this.sysex,
                outputMapping1: this.outputMapping1,
                outputMapping2: this.outputMapping2,
                midiFileId: this.selectedMidiFileId,
                id: this.id
            }
            if (this.id) {
                this.axios.put('/api/songs', data).then(response => {
                    console.log(response);
                    this.id = response.data.id;
                    data.id = this.id;
                    data.midiFile = this.$store.state.midiFileList.filter(midiFile => midiFile.id == data.midiFileId)[0];
                    this.$store.commit('updateMidiSong', data);
                }).catch(error => {
                    console.log(error);
                });
            } else {
                this.axios.post('/api/songs', data).then(response => {
                    console.log(response);
                    this.id = response.data.id;
                    data.id = this.id;
                    data.midiFile = this.$store.state.midiFileList.filter(midiFile => midiFile.id == data.midiFileId)[0];
                    this.$store.commit('addMidiSongToList', data);
                }).catch(error => {
                    console.log(error);
                });
            }
            
        },
        sendToPlayer() {
            var data = {
                name: this.name,
                sysex: this.sysex,
                outputMapping1: this.outputMapping1,
                outputMapping2: this.outputMapping2,
                midiFile: this.$store.state.midiFileList.find(midi => midi.id == this.selectedMidiFileId),
                id: this.id
            } 
            this.$emit('sendToPlayer', data);
        }
    }
}
</script>

<style scoped>
.midi-chan-select, #change-name {
    margin-left: auto;
}
#change-sysex {
    margin-left: auto;
    margin-right: 1em;
}

</style>