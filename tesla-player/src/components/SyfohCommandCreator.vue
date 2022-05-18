<template>
<article class="panel is-warning">
    <p class="panel-heading">
        {{$t('title.syntherrupterCommandCreator')}}
    </p>
    <a class="panel-block">
        <span class="panel-icon">
        <i class="fas fa-wrench"></i>
        </span>
        <span>set
            <div class="select is-small">
            <select v-model="selectedSysexName">
                <option 
                    v-for="(number, name) in sysexNameNumber"
                    :key="name"
                    :value="name"
                    >
                    {{name}}
                </option>
            </select>
            </div>
        </span>
        <span v-if="sysexProperties[selectedSysexNumber]">
            <span v-if="sysexProperties[selectedSysexNumber]['targetMSB-name']">
                for 
                {{sysexProperties[selectedSysexNumber]['targetMSB-name']}}
                <div class="select is-small">
                <select v-model="selectedTargetMSB">
                    <option 
                        v-for="(_, name) in sysexProperties[selectedSysexNumber].targetMSB"
                        :key="name"
                        :value="name"
                        >
                        {{name}}
                    </option>
                    <option v-for="(_, i) in 6" :key="i" :value="i">
                        {{i}}
                    </option>
                </select>
                </div>
            </span>

            <span v-if="sysexProperties[selectedSysexNumber]['targetLSB-name']">
                {{sysexProperties[selectedSysexNumber]['targetMSB-name'] == ""?'for':'and'}} 
                {{sysexProperties[selectedSysexNumber]['targetLSB-name']}}
                <div class="select is-small">
                <select v-model="selectedTargetLSB">
                    <option 
                        v-for="(_, name) in sysexProperties[selectedSysexNumber].targetLSB"
                        :key="name"
                        :value="name"
                        >
                        {{name}}
                    </option>
                    <option v-for="(_, i) in 6" :key="i" :value="i">
                        {{i}}
                    </option>
                </select>
                </div>
            </span>
            to
            <input v-if="sysexProperties[selectedSysexNumber]['type'] == 'str'"
            class="input is-small"
            maxlength="4"
            v-model="value"
            required
            >
            <input v-if="sysexProperties[selectedSysexNumber]['type'] == 'int'"
            class="input is-small"
            type="number"
            step="1"
            placeholder="Nombre entier"
            v-model="value"
            required
            >
            <input v-if="sysexProperties[selectedSysexNumber]['type'] == 'float'"
            class="input is-small"
            type="number"
            placeholder="Nombre flottant"
            v-model="value"
            required
            >
            <span class="is-size-7 is-italic ml-4">
                ({{$t('label.availableSpecificValues')}} {{sysexProperties[selectedSysexNumber]['value']}})
            </span>
        </span>
        <button class="button" id="compile"
        @click="getHexCommand"
        :disabled="!sysexProperties[selectedSysexNumber]">
        <span class="panel-icon">
            <i class="fas fa-terminal"></i>
        </span>
        <span>{{$t('label.compile')}}</span>
        </button>  
    </a>

    <label class="panel-block">
        <span class="panel-icon">
            <i class="fas fa-hashtag"></i>
        </span>
        <span class="mr-2 ml-2">{{$t('label.binaryDecimalConverter')}}</span>
        <div class="buttons has-addons"> 
            <button v-for="index in midiCh.length" :key="index"
            class="button is-small" 
            :class="(midiCh[index-1]) ? 'is-warning' : ''"
            @click="midiCh[index-1] = !midiCh[index-1]">
            {{index-1}}
            </button>
        </div>
        &nbsp;  &nbsp;= &nbsp; {{midiChDecimal}}
    </label>

    <a class="panel-block" v-if="command!=''">
        <span class="panel-icon">
        <i class="fas fa-terminal"></i>
        </span>
        <span>{{$t('label.commandTranslatesTo', {command, translatedCommand})}}</span>
    </a>
    <a class="panel-block is-block mt-2">
        <div class="buttons has-addons columns is-centered">
            <button class="button"
                @click="sendCommand"
                :disabled="!translatedCommand || !$store.state.midiOutput">
                <span class="icon">
                    <i class="fas fa-flask"></i>
                </span>
                <span>{{$t('label.executeCommand')}}</span>
            </button>
            <button class="button"
                @click="emitCommand"
                :disabled="!translatedCommand">
                <span class="icon">
                    <i class="fas fa-add"></i>
                </span>
                <span>{{$t('label.addToSong')}}</span>
            </button>
        </div>
    </a>
</article>
</template>

<script>
import sysexNameNumberJson from '@/assets/SysexNameNumber.json';
import sysexPropertiesJson from '@/assets/SysexProperties.json';

export default {
 data: function() {
   return {
        sysexNameNumber: sysexNameNumberJson,
        selectedSysexName: "",
        sysexProperties: sysexPropertiesJson,
        selectedTargetMSB: null,
        selectedTargetLSB: null,
        value: null,
        command: "",
        translatedCommand: "",
        midiCh: [false, false, false, false,
                false, false, false, false,
                false, false, false, false,
                false, false, false, false],
   }
 },
 computed: {
     selectedSysexNumber() {
         return this.sysexNameNumber[this.selectedSysexName];
     },
     midiChDecimal() {
         let chanel = 0;
         for (let i = 0; i < this.midiCh.length; i++) {
             if (this.midiCh[i]) {
                 chanel += Math.pow(2, i);
             }
         }
         return chanel;
     },
 },
 methods: {
    getHexCommand() {
        this.translatedCommand = "";
        this.command = `set ${this.selectedSysexName}`;
        if (this.sysexProperties[this.selectedSysexNumber]['targetMSB-name']) {
            this.command += ` for ${this.sysexProperties[this.selectedSysexNumber]['targetMSB-name']} ${this.selectedTargetMSB}`;
            if (this.sysexProperties[this.selectedSysexNumber]['targetLSB-name'])
                this.command += ` and ${this.sysexProperties[this.selectedSysexNumber]['targetLSB-name']} ${this.selectedTargetLSB}`;
        } else if (this.sysexProperties[this.selectedSysexNumber]['targetLSB-name']) {
            this.command += ` for ${this.sysexProperties[this.selectedSysexNumber]['targetLSB-name']} ${this.selectedTargetLSB}`;
        }
        this.command += ` to ${this.value}`;
        
        this.axios.post(
            '/api/translate-sysex', 
            {sysexCommand: this.command}
        ).then(response => {
            this.translatedCommand = response.data;
        });
    },

    sendCommand() {
        this.$store.dispatch('sendSysex', this.translatedCommand);
    },
    
    emitCommand() {
        this.$emit('commandExport', {
            command: this.command,
            value: this.translatedCommand
        });
    }
 }
}
</script>

<style scoped>
#compile {
    margin-left: auto;
}
.input {
    width: 10em;
}
</style>