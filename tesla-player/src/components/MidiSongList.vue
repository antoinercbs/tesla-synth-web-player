<template>
  <article class="panel">
    <p class="panel-heading">
        {{$t('title.mySongs')}}
    </p>
    <div class="panel-block">
    <p class="control has-icons-left">
      <input class="input" type="text" :placeholder="$t('label.search')" v-model="searchText">
      <span class="icon is-left">
        <i class="fas fa-search"></i>
      </span>
    </p>
  </div>
    <a class="panel-block" v-for="song in filteredSongs" :key="song.id">
        <span class="panel-icon">
            <i class="fas fa-music"></i>
        </span>
        {{song.name}}
        <div class="buttons has-addons">
            <button class="button is-small" @click="playSong(song)">
                <span class="icon">
                    <i class="fas fa-play"></i>
                </span>
            </button>
            <button class="button is-small" @click="addToPlaylist(song)">
                <span class="icon">
                    <i class="fas fa-add"></i>
                </span>
            </button>
            <button class="button is-small" @click="copySong(song)">
                <span class="icon">
                    <i class="fas fa-copy"></i>
                </span>
            </button>
            <button class="button is-small" @click="editSong(song)">
                <span class="icon">
                    <i class="fas fa-pen"></i>
                </span>
            </button>
            <button class="button is-small"
            :class="(deletingSong == song) ? 'is-danger' : 'is-warning'"
            @click="deleteSong(song)">
                <span class="icon">
                    <i class="fas fa-trash"></i>
                </span>
            </button>
        </div>
    </a>
    <a class="panel-block">
        <nav class="pagination" role="navigation" aria-label="pagination">
            <ul class="pagination-list">
                <li>
                    <a class="pagination-link"
                        @click="selectedPageIdx = 0">
                        <span class="icon">
                            <i class="fas fa-angles-left"></i>
                        </span>
                    </a>
                </li>
                <div v-for="(n, idx) in 5" :key="idx">
                    <li v-if="idx-2+selectedPageIdx >= 0 && idx-2+selectedPageIdx < pageCount">
                        <a class="pagination-link" 
                            @click="selectedPageIdx = idx-2+selectedPageIdx"
                            :class="idx == 2 ? 'is-current':''">
                            {{n-2+selectedPageIdx}}
                        </a>
                    </li>
                </div>
                <li>
                    <a class="pagination-link"
                        @click="selectedPageIdx = pageCount - 1">
                        <span class="icon">
                            <i class="fas fa-angles-right"></i>
                        </span>
                    </a>
                </li>
            </ul>
        </nav>
    </a>
  </article>
</template>

<script>
export default {
    data: function() {
        return {
            searchText: '',
            selectedPageIdx: 0,
            deletingSong: null,
        }
    },
    computed : {
        pageCount() {
            return Math.ceil(this.searchedSongs.length/10);
        },
        searchedSongs() {
            return this.$store.state.midiSongList.filter(song => {
                return song.name.toLowerCase().includes(this.searchText.toLowerCase());
            });
        },
        filteredSongs() {
            return this.searchedSongs.slice(this.selectedPageIdx*10, (this.selectedPageIdx+1)*10);
        }
    },
    methods: {
        editSong(song) {
            this.$emit('editSong', song);
        },
        playSong(song) {
            this.$emit('playSong', song);
        },
        addToPlaylist(song) {
            this.$emit('addToPlaylist', song.id);
        },
        deleteSong(song) {
            if (song != this.deletingSong) {
                this.deletingSong = song;
                return;
            }
            this.axios.delete('/api/songs', {
                params: {
                    id: song.id
                }
            }).then(() => {
                this.$store.commit('deleteMidiSong', song.id);
                this.$forceUpdate();
            }).catch(error => {
                console.log(error);
            });
        },
        copySong(song) {
            var data = {
                name: song.name + (song.name.length > 0 ? ' - copy' : 'copy'),
                sysex: song.sysex,
                outputMapping1: song.outputMapping1,
                outputMapping2: song.outputMapping2,
                midiFileId: song.midiFile.id,
                id: song.id
            }
            this.axios.post('/api/songs', data).then(response => {
                data.id = response.data.id;
                data.midiFile = this.$store.state.midiFileList.filter(midiFile => midiFile.id == data.midiFileId)[0];
                this.$store.commit('addMidiSongToList', data);
            }).catch(error => {
                console.log(error);
            });
        }
    },
}
</script>

<style scoped>
.buttons  {
    margin-left: auto;
}
.pagination {
    margin: auto;
}
</style>