<template>
    <article class="panel">
        <p class="panel-heading">
            {{$t('title.songManager')}}
        </p>
        <div class="panel-block" v-for="song in midiSongList" :key="song.id">
            <div class="card is-fullwidth">
                <header class="card-header">
                    <p class="card-header-title">
                        {{song.name}}
                    </p>
                </header>
                <div class="card-content">
                    <div class="content">
                        {{song.midiFile.name}}
                    </div>
                </div>
                <footer class="card-footer">
                    <a class="card-footer-item" @click="playSong(song)">
                        <span class="icon is-small">
                            <i class="fas fa-play"></i>
                        </span>
                    </a>
                    <a class="card-footer-item" @click="editSong(song)">
                        <span class="icon is-small">
                            <i class="fas fa-edit"></i>
                        </span>
                    </a>
                    <a class="card-footer-item" @click="addToPlaylist(song.id)">
                        <span class="icon is-small">
                            <i class="fas fa-plus"></i>
                        </span>
                    </a>
                </footer>
            </div>
        </div>
    </article>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'

export default {
    computed: {
        ...mapStores(useMidiStore),
        midiSongList() {
            return this.midiStore.midiSongList;
        }
    },
    methods: {
        playSong(song) {
            this.$emit('playSong', song);
        },
        editSong(song) {
            this.$emit('editSong', song);
        },
        addToPlaylist(songId) {
            this.$emit('addToPlaylist', songId);
        }
    }
}
</script>
