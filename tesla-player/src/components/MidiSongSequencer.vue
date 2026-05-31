<template>
    <article class="panel">
        <p class="panel-heading">
            {{$t('title.songSequencer')}}
        </p>
        <div class="panel-block">
            <input class="input" type="text" v-model="songName" :placeholder="$t('label.songName')">
        </div>
        <div class="panel-block">
            <div class="select is-fullwidth">
                <select v-model="selectedMidiFile">
                    <option v-for="midiFile in midiFileList" :key="midiFile.id" :value="midiFile">{{midiFile.name}}</option>
                </select>
            </div>
        </div>
        <div class="panel-block" v-if="selectedMidiFile">
            <div class="field is-grouped is-grouped-multiline">
                <div class="control" v-for="(channel, index) in 16" :key="index">
                    <label class="checkbox">
                        <input type="checkbox" :value="index" v-model="outputMapping1Selected">
                        {{index}}
                    </label>
                </div>
            </div>
        </div>
        <div class="panel-block" v-if="selectedMidiFile && midiStore.settings.enableSecondMidiOutput">
            <div class="field is-grouped is-grouped-multiline">
                <div class="control" v-for="(channel, index) in 16" :key="index">
                    <label class="checkbox">
                        <input type="checkbox" :value="index" v-model="outputMapping2Selected">
                        {{index}}
                    </label>
                </div>
            </div>
        </div>
        <div class="panel-block">
            <textarea class="textarea" v-model="sysexCommands" :placeholder="$t('label.sysexPlaceholder')" rows="10"></textarea>
        </div>
        <div class="panel-block">
            <button class="button is-warning is-fullwidth" @click="saveSong" :disabled="!canSave">{{$t('label.saveSong')}}</button>
        </div>
    </article>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'

export default {
    data: function() {
        return {
            songName: '',
            selectedMidiFile: null,
            sysexCommands: '',
            editingSongId: null,
            outputMapping1Selected: [],
            outputMapping2Selected: [],
        }
    },
    computed: {
        ...mapStores(useMidiStore),
        midiFileList() {
            return this.midiStore.midiFileList;
        },
        canSave() {
            return this.songName && this.selectedMidiFile;
        }
    },
    methods: {
        addSysex(sysex) {
            this.sysexCommands += sysex + '\n';
        },
        loadSong(song) {
            this.songName = song.name;
            this.selectedMidiFile = this.midiFileList.find(midiFile => midiFile.id === song.midiFile.id);
            this.sysexCommands = song.sysex.map(cmd => cmd.value).join('\n');
            this.editingSongId = song.id;
            this.outputMapping1Selected = this.intToChannelArray(song.outputMapping1);
            this.outputMapping2Selected = this.intToChannelArray(song.outputMapping2);
        },
        saveSong() {
            const sysexArray = this.sysexCommands.split('\n').filter(cmd => cmd.trim() !== '').map(cmd => ({value: cmd}));
            const song = {
                name: this.songName,
                midiFile: this.selectedMidiFile,
                sysex: sysexArray,
                outputMapping1: this.channelArrayToInt(this.outputMapping1Selected),
                outputMapping2: this.channelArrayToInt(this.outputMapping2Selected),
            };
            if (this.editingSongId) {
                song.id = this.editingSongId;
                this.axios.put(`/api/songs/${song.id}`, song)
                .then(response => {
                    this.midiStore.updateMidiSong(response.data);
                    this.resetForm();
                })
                .catch(error => {
                    console.log(error);
                });
            } else {
                this.axios.post('/api/songs', song)
                .then(response => {
                    this.midiStore.addMidiSongToList(response.data);
                    this.resetForm();
                })
                .catch(error => {
                    console.log(error);
                });
            }
        },
        resetForm() {
            this.songName = '';
            this.selectedMidiFile = null;
            this.sysexCommands = '';
            this.editingSongId = null;
            this.outputMapping1Selected = [];
            this.outputMapping2Selected = [];
        },
        intToChannelArray(int) {
            let channels = [];
            for (let i = 0; i < 16; i++) {
                if ((int & Math.pow(2, i)) > 0) {
                    channels.push(i);
                }
            }
            return channels;
        },
        channelArrayToInt(channels) {
            let int = 0;
            channels.forEach(channel => {
                int += Math.pow(2, channel);
            });
            return int;
        }
    }
}
</script>
