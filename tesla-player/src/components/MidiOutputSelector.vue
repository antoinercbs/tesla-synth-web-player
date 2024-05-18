<template>
  <article class="panel">
    <p class="panel-heading">
        {{$t('title.ioConfiguration')}}
    </p>
    <a class="panel-block">
        <span class="panel-icon">
            <i class="fas fa-right-from-bracket"></i>
        </span>
        <span class="is-size-7">{{$t('label.firstOutput')}}</span>
        <div class="select is-small is-fullwidth">
        
        <select @change="onChange">
            <option></option>
            <option v-for="output in $store.state.midiOutputList" :key="output.id"
                :value="output.id"
                >
                {{output.name}} ({{output.manufacturer}})
            </option>
        </select>
        </div>
    </a>
    <a class="panel-block"  v-if="$store.state.settings.enableSecondMidiOutput" >
        <span class="panel-icon">
            <i class="fas fa-right-from-bracket"></i>
        </span>
        <span class="is-size-7">{{$t('label.secondOutput')}}</span>
        <div class="select is-small is-fullwidth">
        <select @change="onChange2">
            <option></option>
            <option v-for="output in $store.state.midiOutputList" :key="output.id"
                :value="output.id"
                >
                {{output.name}} ({{output.manufacturer}})
            </option>
        </select>
        </div>
    </a>
  </article>
</template>

<script>
export default {
    methods: {
        onChange(event) {
            if (event.target.value != "") {
                var output = this.$store.state.midiOutputList.filter(out => {
                    return out.id === event.target.value
                })[0];
                console.log(output);
                this.$store.commit('setMidiOutput', output);
            } else {
                this.$store.commit('setMidiOutput', null);
            }
        },
        onChange2(event) {
            if (event.target.value != "") {
                var output = this.$store.state.midiOutputList.filter(out => {
                    return out.id === event.target.value
                })[0];
                this.$store.commit('setMidiOutput2', output);
            } else {
                this.$store.commit('setMidiOutput2', null);
            }
        }
    }
}
</script>

<style>

</style>