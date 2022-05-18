<template>
  <article class="panel">
    <p class="panel-heading">
        {{$t('title.playlistEditor')}}
    </p>
    <a class="panel-block">
      <span class="panel-icon">
          <i class="fas fa-list"></i>
      </span>
      <div class="select is-fullwidth">
        <select @change="onPlaylistSelected">
          <option></option>
          <option v-for="playlist in playlists" :key="playlist.id" :value="playlist.id">
            {{playlist.name}}
          </option>
        </select>
      </div>
    </a>

    <a class="panel-block">
      <span class="panel-icon">
      <i class="fas fa-list"></i>
      </span>
      <input v-if="editName" type="text" class="input is-small" :placeholder="$t('label.playlistName')" v-model="currentPlaylist.name">
      <span v-else>{{currentPlaylist.name}}</span>
      <button class="button is-small" id="change-name" @click="editName = !editName">
          <span class="icon">
              <i class="fas fa-pen"></i>
          </span>
      </button>
    </a>
    <a class="panel-block" v-for="(songId,idx) in currentPlaylist.songIds" :key="songId">
        <span class="panel-icon">
            <i class="fas fa-music"></i>
        </span>
        <span v-if="getSongById(songId)">{{getSongById(songId).name}}</span>
        <span v-else>{{$t('label.unknownSong')}}</span>
        <div class="buttons has-addons">
            <button class="button is-small" 
            @click="playSong(getSongById(songId))"
            :disabled="!getSongById(songId)">
                <span class="icon">
                    <i class="fas fa-play"></i>
                </span>
            </button>
            <button class="button is-small" 
            @click="upSong(idx)"
            :disabled="idx == 0">
                <span class="icon">
                    <i class="fas fa-angle-up"></i>
                </span>
            </button>
            <button class="button is-small" 
            @click="downSong(idx)"
            :disabled="idx == currentPlaylist.songIds.length - 1">
                <span class="icon">
                    <i class="fas fa-angle-down"></i>
                </span>
            </button>
            <button class="button is-danger is-small" @click="removeSong(idx)">
                <span class="icon">
                    <i class="fas fa-minus"></i>
                </span>
            </button>
        </div>
    </a>

    <a class="panel-block" >
      <div class="buttons has-addons" id="main-buttons">
        <button class="button"
            @click="savePlaylist">
            <span class="icon">
                <i class="fas fa-save"></i>  
            </span>
            <span>{{currentPlaylist.id?$t('label.update'):$t('label.save')}}</span>
        </button>
         <button class="button"
            :class="(deletingPlaylist) ? 'is-danger' : 'is-warning'"
            :disabled="!this.currentPlaylist.id"
            @click="deletePlaylist(currentPlaylist)">
            <span class="icon">
                <i class="fas fa-trash"></i>
            </span>
            <span>{{$t('label.delete')}}</span>
        </button>
      </div>
    </a>
  </article>
</template>

<script>
export default {
  data: function() {
    return {
      editName: false,
      deletingPlaylist: false,
      playlists: [],
      currentPlaylist: {
        id: '',
        name: 'Untitled playlist',
        songIds: []
      }
    }
  },
  methods: {
    upSong(idx) {
        let tmp = this.currentPlaylist.songIds[idx];
        this.currentPlaylist.songIds[idx] = this.currentPlaylist.songIds[idx-1];
        this.currentPlaylist.songIds[idx-1] = tmp;
    },
    downSong(idx) {
        let tmp = this.currentPlaylist.songIds[idx];
        this.currentPlaylist.songIds[idx] = this.currentPlaylist.songIds[idx+1];
        this.currentPlaylist.songIds[idx+1] = tmp;
    },
    playSong(song) {
      this.$emit('playSong', song);
    },
    onPlaylistSelected(e) {
      try {
        if (e.target.value == '') {
          this.currentPlaylist = {
            id: '',
            name: 'Untitled playlist',
            songIds: []
          }
          return;
        }
        this.currentPlaylist = this.playlists.find(playlist => playlist.id == e.target.value);
      } catch (e) {
        this.currentPlaylist = {
          id: '',
          name: 'Untitled playlist',
          songIds: []
        }
      }
    },
    addSongById(songId) {
      this.currentPlaylist.songIds.push(songId);
    },
    removeSong(idx) {
      this.currentPlaylist.songIds.splice(idx, 1);
    },
    getSongById(songId) {
      var index = this.$store.state.midiSongList.findIndex(song => song.id === songId);
      return this.$store.state.midiSongList[index];
    },
    getPlaylists() {
      this.axios.get('/api/playlists').then(response => {
        var filtered = response.data;
        for (var i = 0; i < filtered.length; i++) {
          for (var j = 0; j < filtered[i].songIds.length; j++) {
            if (filtered[i].songIds[j] == null) {
              filtered[i].songIds.splice(j, 1);
            }
          }
        }
        this.playlists = filtered;
      });
    },
    savePlaylist() {
      if (this.currentPlaylist.id) {
        this.updatePlaylist();
      } else {
        this.createPlaylist();
      }
    },
    createPlaylist() {
      this.axios.post('/api/playlists', this.currentPlaylist).then(response => {
        this.playlists.push(response.data);
        this.currentPlaylist = response.data;
      });
    },
    updatePlaylist() {
      this.axios.put('/api/playlists', this.currentPlaylist).then(response => {
        this.currentPlaylist = response.data;
        var index = this.playlists.findIndex(playlist => playlist.id == response.data.id);
        this.playlists.splice(index, 1, response.data);
      });
    },
    deletePlaylist(playlist) {
      if (!this.deletingPlaylist) {
        this.deletingPlaylist = true;
        return;
      }
      this.axios.delete('/api/playlists', {params: {id: playlist.id}}).then(() => {
        this.playlists = this.playlists.filter(p => p.id !== playlist.id);
      });
    },
  },

  mounted: function() {
    this.getPlaylists()
  }
}
</script>

<style scoped>
.buttons, #change-name{
    margin-left: auto;
}
#main-buttons{
    margin-left: auto;
    margin-right: auto;
}
</style>