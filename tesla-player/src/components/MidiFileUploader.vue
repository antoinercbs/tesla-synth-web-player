<template>
    <article class="panel">
        <p class="panel-heading">
            {{$t('title.fileManager')}}
        </p>
        <div class="panel-block">
            <form @submit.prevent="uploadFile" class="is-fullwidth">
                <div class="file has-name is-fullwidth">
                    <label class="file-label">
                        <input class="file-input" type="file" @change="onFileChange" accept=".mid,.midi">
                        <span class="file-cta">
                            <span class="file-icon">
                                <i class="fas fa-upload"></i>
                            </span>
                            <span class="file-label">
                                {{$t('label.chooseFile')}}
                            </span>
                        </span>
                        <span class="file-name" v-if="selectedFile">
                            {{selectedFile.name}}
                        </span>
                    </label>
                </div>
                <button type="submit" class="button is-warning mt-3 is-fullwidth" :disabled="!selectedFile">
                    {{$t('label.upload')}}
                </button>
            </form>
        </div>
    </article>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'

export default {
    computed: {
        ...mapStores(useMidiStore)
    },
    data: function() {
        return {
            selectedFile: null,
        }
    },
    methods: {
        onFileChange(event) {
            this.selectedFile = event.target.files[0];
        },
        uploadFile() {
            const formData = new FormData();
            formData.append('file', this.selectedFile);
            this.axios.post('/api/midi', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            })
            .then(response => {
                this.midiStore.addMidiFileToList(response.data);
                this.selectedFile = null;
            })
            .catch(error => {
                console.log(error);
            });
        }
    }
}
</script>
