<template>
    <article class="panel ">
        <p class="panel-heading">
            {{$t('title.outputSelection')}}
        </p>
        <label class="panel-block">
            <span class="panel-icon">
                <i class="fas fa-plug"></i>
            </span>
            {{$t('label.mainOutput')}}
            <div class="select is-small ml-2">
                <select v-model="selectedOutput" @change="onOutputChange">
                    <option v-for="output in midiOutputList" :key="output.id" :value="output">{{output.name}}</option>
                </select>
            </div>
        </label>
         <label class="panel-block" v-if="midiStore.settings.enableSecondMidiOutput">
            <span class="panel-icon">
                <i class="fas fa-plug"></i>
            </span>
            {{$t('label.secondOutput')}}
            <div class="select is-small ml-2">
                <select v-model="selectedOutput2" @change="onOutput2Change">
                    <option v-for="output in midiOutputList" :key="output.id" :value="output">{{output.name}}</option>
                </select>
            </div>
        </label>
    </article>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'

export default {
    computed: {
        ...mapStores(useMidiStore),
        midiOutputList() {
            return this.midiStore.midiOutputList;
        }
    },
    data: function() {
        return {
            selectedOutput: null,
            selectedOutput2: null,
        }
    },
    methods: {
        onOutputChange() {
            this.midiStore.setMidiOutput(this.selectedOutput);
        },
        onOutput2Change() {
            this.midiStore.setMidiOutput2(this.selectedOutput2);
        }
    }
}
</script>
