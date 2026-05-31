<template>
  <article class="playlist-panel">
    <header class="playlist-panel__head">
      <span class="icon"><i class="fas fa-list"></i></span>{{ $t('title.playlistEditor') }}
    </header>

    <div class="playlist-pick">
      <span class="icon"><i class="fas fa-list"></i></span>
      <div class="select-field">
        <select @change="onPlaylistSelected">
          <option></option>
          <option v-for="playlist in playlists" :key="playlist.id" :value="playlist.id">
            {{ playlist.name }}
          </option>
        </select>
      </div>
    </div>

    <div class="playlist-name">
      <span class="icon"><i class="fas fa-music"></i></span>
      <input
        v-if="editName"
        type="text"
        class="text-field"
        :placeholder="$t('label.playlistName')"
        v-model="currentPlaylist.name"
      >
      <span v-else class="playlist-name__text">{{ currentPlaylist.name }}</span>
      <button class="icon-btn" id="change-name" @click="editName = !editName">
        <span class="icon"><i class="fas fa-pen"></i></span>
      </button>
    </div>

    <ul class="playlist-songs">
      <li
        class="playlist-song"
        v-for="(songId, idx) in currentPlaylist.songIds"
        :key="songId"
      >
        <span class="icon playlist-song__icon"><i class="fas fa-music"></i></span>
        <span class="playlist-song__name" v-if="getSongById(songId)">{{ getSongById(songId).name }}</span>
        <span class="playlist-song__name playlist-song__name--unknown" v-else>{{ $t('label.unknownSong') }}</span>
        <div class="playlist-song__actions">
          <button
            class="icon-btn"
            @click="playSong(getSongById(songId))"
            :disabled="!getSongById(songId)"
          >
            <span class="icon"><i class="fas fa-play"></i></span>
          </button>
          <button
            class="icon-btn"
            @click="upSong(idx)"
            :disabled="idx == 0"
          >
            <span class="icon"><i class="fas fa-angle-up"></i></span>
          </button>
          <button
            class="icon-btn"
            @click="downSong(idx)"
            :disabled="idx == currentPlaylist.songIds.length - 1"
          >
            <span class="icon"><i class="fas fa-angle-down"></i></span>
          </button>
          <button class="icon-btn icon-btn--danger" @click="removeSong(idx)">
            <span class="icon"><i class="fas fa-minus"></i></span>
          </button>
        </div>
      </li>
    </ul>

    <div class="playlist-foot">
      <button class="btn btn--volt" @click="savePlaylist">
        <span class="icon"><i class="fas fa-save"></i></span>
        <span>{{ currentPlaylist.id ? $t('label.update') : $t('label.save') }}</span>
      </button>
      <button
        class="btn"
        :class="(deletingPlaylist) ? 'btn--danger' : 'btn--warning'"
        :disabled="!currentPlaylist.id"
        @click="deletePlaylist(currentPlaylist)"
      >
        <span class="icon"><i class="fas fa-trash"></i></span>
        <span>{{ $t('label.delete') }}</span>
      </button>
    </div>
  </article>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'

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
  computed: {
    ...mapStores(useMidiStore)
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
      } catch {
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
      var index = this.midiStore.midiSongList.findIndex(song => song.id === songId);
      return this.midiStore.midiSongList[index];
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
      this.axios.put(`/api/playlists/${this.currentPlaylist.id}`, this.currentPlaylist).then(response => {
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
      this.axios.delete(`/api/playlists/${playlist.id}`).then(() => {
        this.playlists = this.playlists.filter(p => p.id !== playlist.id);
        this.currentPlaylist = {
          id: '',
          name: 'Untitled playlist',
          songIds: []
        };
        this.deletingPlaylist = false;
      });
    },
  },

  mounted: function() {
    this.getPlaylists()
  }
}
</script>

<style scoped lang="scss">
// panel shell — mirrors .player-panel
.playlist-panel {
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.playlist-panel__head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.7rem 1rem;
  font-family: var(--font-display); text-transform: uppercase;
  letter-spacing: 0.07em; font-size: 0.8rem; color: var(--text);
  background: rgba(70, 224, 255, 0.06); border-bottom: 1px solid var(--line);
}
.playlist-panel__head .icon { color: var(--volt); }

// playlist selector + rename rows
.playlist-pick,
.playlist-name {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.7rem 1rem; min-width: 0;
}
.playlist-pick .icon,
.playlist-name .icon { color: var(--text-dim); flex: 0 0 auto; }
.playlist-pick .select-field { flex: 1 1 auto; min-width: 0; }
.playlist-name { border-top: 1px solid var(--line); }
.playlist-name .text-field { flex: 1 1 auto; min-width: 0; }
.playlist-name__text {
  flex: 1 1 auto; min-width: 0; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

// reorderable song rows
.playlist-songs {
  list-style: none; margin: 0; padding: 0;
  border-top: 1px solid var(--line);
}
.playlist-song {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.5rem 1rem; min-width: 0;
  border-bottom: 1px solid var(--line);
  transition: background 0.12s;
}
.playlist-song:hover { background: rgba(120, 160, 205, 0.05); }
.playlist-song__icon { color: var(--text-dim); flex: 0 0 auto; }
.playlist-song__name {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.playlist-song__name--unknown { color: var(--text-mute); font-style: italic; }
.playlist-song__actions { flex: 0 0 auto; display: flex; gap: 0.3rem; }

// compact circular action buttons (built on .icon-btn)
.icon-btn {
  width: 2rem; height: 2rem;
  border-radius: 7px;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line-strong); color: var(--text-dim);
  transition: 0.15s;
}
.icon-btn .icon { width: auto; height: auto; }
.icon-btn:hover { color: var(--volt); border-color: var(--volt); box-shadow: 0 0 14px -6px var(--volt); }
.icon-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
.icon-btn:disabled:hover { color: var(--text-dim); border-color: var(--line-strong); }
.icon-btn--danger:hover { color: var(--danger); border-color: var(--danger); box-shadow: 0 0 14px -6px var(--danger); }

#change-name { flex: 0 0 auto; }

// footer action bar
.playlist-foot {
  display: flex; gap: 0.6rem; padding: 0.8rem 1rem 1rem;
  border-top: 1px solid var(--line);
}
.playlist-foot .btn { flex: 1 1 auto; justify-content: center; }
.btn--warning { background: var(--coil-1); border-color: var(--coil-1); color: #06090f; }
.btn--warning:hover { color: #06090f; filter: brightness(1.08); }
</style>
