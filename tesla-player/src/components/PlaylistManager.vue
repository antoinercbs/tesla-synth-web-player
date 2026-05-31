<template>
    <article class="panel">
        <p class="panel-heading">
            {{$t('title.playlistManager')}}
        </p>
        <div class="panel-block" v-if="playlist.length === 0">
            {{$t('label.emptyPlaylist')}}
        </div>
        <div class="panel-block" v-for="(song, index) in playlist" :key="index">
            <div class="is-flex is-justify-content-space-between is-align-items-center is-fullwidth">
                <span>{{song.name}}</span>
                <div class="buttons">
                    <button class="button is-small" @click="playSong(song)">
                        <span class="icon is-small">
                            <i class="fas fa-play"></i>
                        </span>
                    </button>
                    <button class="button is-small" @click="removeSong(index)">
                        <span class="icon is-small">
                            <i class="fas fa-trash"></i>
                        </span>
                    </button>
                </div>
            </div>
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
            playlist: [],
        }
    },
    methods: {
        addSongById(songId) {
            const song = this.midiStore.midiSongList.find(song => song.id === songId);
            if (song) {
                this.playlist.push(song);
            }
        },
        playSong(song) {
            this.$emit('playSong', song);
        },
        removeSong(index) {
            this.playlist.splice(index, 1);
        }
    }
}
</script>
