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
                    {{name.length > 13 ? name.slice(0, 13) + '...' : name}}
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
            <option v-for="midiFile in midiStore.midiFileList" :key="midiFile.id"
                :value="midiFile.id">
                {{midiFile.name}}
            </option>
        </select>
        </div>
        <a class="button ml-2"
        v-if="selectedDeleteMidiId"
        target="_blank"
        :href="downloadUrl">
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
        :href="editorUrl">
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
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'

export default {
    data: function() {
        return {
            name: this.$t('label.noFile'),
            file: null,
            selectedDeleteMidiId: null,
            deletingMidi: false,
        }
    },
    computed: {
        ...mapStores(useMidiStore),
        selectedFilePath() {
            const file = this.midiStore.midiFileList.find(e => e.id == this.selectedDeleteMidiId);
            return file ? file.path : '';
        },
        // The stored path looks like "./uploads/xxx"; build an absolute URL on
        // the API origin so the link works when front and back are served apart.
        downloadUrl() {
            return import.meta.env.VITE_BASE_URL + this.selectedFilePath.substring(1);
        },
        editorUrl() {
            return import.meta.env.VITE_BASE_URL + '/editor/?songUrl=' + this.selectedFilePath.substring(1);
        }
    },
    methods: {
        handleFileSelection(e) {
            const files = e.target.files || e.dataTransfer.files;
            if (!files.length)
                return;
            this.name = files[0].name;
            this.file = files[0];
        },
        resetFileSelector(e) {
            e.target.value = '';
        },
        uploadFile() {
            const formData = new FormData();
            formData.append('file', this.file);
            formData.append('name', this.name);
            const headers = { 'Content-Type': 'multipart/form-data' };
            this.axios.post('/api/midi', formData, { headers })
                .then(response => {
                    this.file = null;
                    this.name = this.$t('label.noFile');
                    this.midiStore.addMidiFileToList(response.data);
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
            this.axios.delete(`/api/midi/${this.selectedDeleteMidiId}`).then(() => {
                this.midiStore.deleteMidiFile(this.selectedDeleteMidiId);
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
