<template>
<article class="panel">
    <p class="panel-heading">
        {{$t('title.midiFileManager')}}
    </p>
    <a class="panel-block">
        <div class="file has-name is-fullwidth">
            <label class="file-label">
                <input class="file-input" type="file" 
                accept=".mid, .midi"
                @click="resetFileSelector"
                @change="handleFileSelection">
                <span class="file-cta">
                <span class="file-icon">
                    <i class="fas fa-file-audio"></i>
                </span>
                <span class="file-label">
                    {{$t('label.chooseAMidiFile')}}
                </span>
                </span>
                <span class="file-name">
                    {{name.slice(0, 13) + '...'}}
                </span>
            </label>
        </div>
        <div id="upload-button">
        <button class="button px-4"
        :disabled="file == null"
        @click="uploadFile">
            <span class="icon">
                <i class="fas fa-upload"></i>
            </span>
        </button>
        </div>
    </a>
    <a class="panel-block">
        <div class="select is-fullwidth">
        <select v-model="selectedDeleteMidiId">
            <option v-for="midiFile in $store.state.midiFileList" :key="midiFile.id" 
                :value="midiFile.id">
                {{midiFile.name}}
            </option>
        </select>
        </div>
        <a class="button ml-2"
        v-if="selectedDeleteMidiId"
        target="_blank"
        :href="selectedFilePath">
            <span class="icon">
                <i class="fas fa-download"></i>
            </span>
        </a>
        <button class="ml-2 button"
        v-else
        disabled
        >
            <span class="icon">
                <i class="fas fa-download"></i>
            </span>
        </button>


        <a class="button ml-2"
        v-if="selectedDeleteMidiId"
        target="_blank"
        :href="'/editor/?songUrl=' + selectedFilePath.substring(1)">
            <span class="icon">
                <i class="fas fa-pen-to-square"></i>
            </span>
        </a>
        <button class="ml-2 button"
        v-else
        disabled
        >
            <span class="icon">
                <i class="fas fa-pen-to-square"></i>
            </span>
        </button>


        <button class="ml-2 button"
            :class="(deletingMidi) ? 'is-danger' : 'is-warning'"
            :disabled="selectedDeleteMidiId == null"
            @click="deleteFile">
            <span class="icon">
                <i class="fas fa-trash"></i>
            </span>
            <span>{{$t('label.delete')}}</span>
        </button>
    </a>
</article>
</template>

<script>
export default {
    data: function() {
        return {
            name: this.$t('label.noFile'),
            file: null,
            selectedDeleteMidiId: null,
            midiFiles: [],
            deletingMidi: false,
        }
    },
    computed: {
        selectedFilePath() {
            var file = this.$store.state.midiFileList.find(e => e.id == this.selectedDeleteMidiId);
            return file.path;
        }
    },
    methods: {
        handleFileSelection(e) {
            var files = e.target.files || e.dataTransfer.files;
            if (!files.length)
                return;
            this.name = files[0].name;
            this.file = files[0];
        },
        resetFileSelector(e) {
            e.target.value = '';
        },
        uploadFile() {
            var formData = new FormData();
            formData.append('file', this.file);
            formData.append('name', this.name);
            const headers = { 'Content-Type': 'multipart/form-data' };
            this.axios.post('/api/midi', formData, { headers: headers })
                .then(response => {
                    this.file = null;
                    this.name = "Aucun fichier";
                    this.$store.commit('addMidiFileToList', response.data);
                    this.$emit('midi-uploaded', response.data);
                })
                .catch(error => {
                    console.log(error);
                });
        },
        deleteFile() {
            if (!this.deletingMidi) {
                this.deletingMidi = true;
                return;
            }
            this.deletingMidi = false;
            this.axios.delete('/api/midi', {
                params: {
                    id: this.selectedDeleteMidiId
                }
            }).then(() => {
                this.$store.commit('deleteMidiFile', this.selectedDeleteMidiId);
                this.selectedDeleteMidiId = null;
            }).catch(error => {
                console.log(error);
            });
        }
    }
}
</script>

<style>
#upload-button {
    margin-left: auto;
}
</style>