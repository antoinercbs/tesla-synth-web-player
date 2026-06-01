<template>
  <article class="songlist-panel">
    <header class="songlist-panel__head">
      <span class="icon"><i class="fas fa-list-ul"></i></span>{{ $t('title.mySongs') }}
    </header>

    <div class="songlist-search">
      <span class="songlist-search__icon"><i class="fas fa-search"></i></span>
      <input class="text-field" type="text" :placeholder="$t('label.search')" v-model="searchText">
    </div>

    <ul class="songlist-rows">
      <li class="songlist-row" v-for="song in filteredSongs" :key="song.id">
        <span class="songlist-row__icon"><i class="fas fa-music"></i></span>
        <span class="songlist-row__name">{{ song.name }}</span>
        <span class="songlist-row__dur" v-if="song.midiFile">{{ fmtDur(song.midiFile.durationMs) }}</span>
        <div class="songlist-row__actions">
          <button class="icon-action" type="button" @click="playSong(song)">
            <i class="fas fa-play"></i>
          </button>
          <button class="icon-action" type="button" @click="addToPlaylist(song)">
            <i class="fas fa-add"></i>
          </button>
          <button class="icon-action" type="button" @click="copySong(song)">
            <i class="fas fa-copy"></i>
          </button>
          <button class="icon-action" type="button" @click="editSong(song)">
            <i class="fas fa-pen"></i>
          </button>
          <button
            class="icon-action icon-action--warn"
            :class="{ 'icon-action--danger': deletingSong == song }"
            type="button"
            @click="deleteSong(song)">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </li>
    </ul>

    <footer class="songlist-pager" v-if="pageCount > 1">
      <nav class="pagination" role="navigation" aria-label="pagination">
        <ul class="pagination-list">
          <li>
            <a class="pagination-link" @click="selectedPageIdx = 0">
              <span class="icon"><i class="fas fa-angles-left"></i></span>
            </a>
          </li>
          <template v-for="(n, idx) in 5" :key="idx">
            <li v-if="idx-2+selectedPageIdx >= 0 && idx-2+selectedPageIdx < pageCount">
              <a class="pagination-link"
                @click="selectedPageIdx = idx-2+selectedPageIdx"
                :class="idx == 2 ? 'is-current':''">
                {{ n-2+selectedPageIdx }}
              </a>
            </li>
          </template>
          <li>
            <a class="pagination-link" @click="selectedPageIdx = pageCount - 1">
              <span class="icon"><i class="fas fa-angles-right"></i></span>
            </a>
          </li>
        </ul>
      </nav>
    </footer>
  </article>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'
import { formatDuration } from '@/utils/format'

export default {
    data: function() {
        return {
            searchText: '',
            selectedPageIdx: 0,
            deletingSong: null,
        }
    },
    computed : {
        ...mapStores(useMidiStore),
        pageCount() {
            return Math.ceil(this.searchedSongs.length/10);
        },
        searchedSongs() {
            return this.midiStore.midiSongList.filter(song => {
                return song.name.toLowerCase().includes(this.searchText.toLowerCase());
            });
        },
        filteredSongs() {
            return this.searchedSongs.slice(this.selectedPageIdx*10, (this.selectedPageIdx+1)*10);
        }
    },
    methods: {
        fmtDur: formatDuration,
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
            this.axios.delete(`/api/songs/${song.id}`).then(() => {
                this.midiStore.deleteMidiSong(song.id);
                this.deletingSong = null;
            }).catch(error => {
                console.log(error);
            });
        },
        copySong(song) {
            const data = {
                name: song.name + (song.name.length > 0 ? ' - copy' : 'copy'),
                coilCount: song.coilCount,
                mode: song.mode,
                output2Mask: song.output2Mask,
                coils: song.coils,
                events: song.events ?? [],
                midiFileId: song.midiFile ? song.midiFile.id : null,
            }
            this.axios.post('/api/songs', data).then(response => {
                this.midiStore.addMidiSongToList(response.data);
            }).catch(error => {
                console.log(error);
            });
        }
    },
}
</script>

<style scoped>
/* --- panel shell (mirrors .player-panel) --------------------------------- */
.songlist-panel {
    background: linear-gradient(180deg, var(--panel-2), var(--panel));
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
}
.songlist-panel__head {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.7rem 1rem;
    font-family: var(--font-display); text-transform: uppercase;
    letter-spacing: 0.07em; font-size: 0.8rem; color: var(--text);
    background: rgba(70, 224, 255, 0.06);
    border-bottom: 1px solid var(--line);
}
.songlist-panel__head .icon { color: var(--volt); }

/* --- search --------------------------------------------------------------- */
.songlist-search { position: relative; padding: 0.8rem 1rem; }
.songlist-search .text-field { padding-left: 2.2rem; }
.songlist-search__icon {
    position: absolute; left: 1.7rem; top: 50%; transform: translateY(-50%);
    color: var(--text-mute); pointer-events: none; font-size: 0.85rem;
}

/* --- rows ----------------------------------------------------------------- */
.songlist-rows { list-style: none; margin: 0; padding: 0; }
.songlist-row {
    display: flex; align-items: center; gap: 0.65rem;
    padding: 0.55rem 1rem; min-width: 0;
    border-top: 1px solid var(--line);
    transition: background 0.13s;
}
.songlist-row:hover { background: rgba(120, 160, 205, 0.05); }
.songlist-row__icon { color: var(--text-dim); flex: 0 0 auto; font-size: 0.85rem; }
.songlist-row__name {
    flex: 1 1 auto; min-width: 0; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.songlist-row__dur {
    flex: 0 0 auto; color: var(--text-mute);
    font-size: 0.8rem; font-variant-numeric: tabular-nums;
}

/* --- compact action buttons ----------------------------------------------- */
.songlist-row__actions { display: flex; gap: 4px; flex: 0 0 auto; }
.icon-action {
    width: 2rem; height: 2rem; border-radius: 7px;
    display: grid; place-items: center; cursor: pointer;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--line-strong); color: var(--text-dim);
    font-size: 0.8rem; transition: 0.13s;
}
.icon-action:hover { color: var(--volt); border-color: var(--volt); }
.icon-action--warn:hover { color: var(--coil-1); border-color: var(--coil-1); }
.icon-action--danger {
    color: #fff; background: var(--danger); border-color: var(--danger);
    box-shadow: 0 0 14px -3px var(--danger);
}
.icon-action--danger:hover { color: #fff; border-color: var(--danger); filter: brightness(1.08); }

/* --- pagination ----------------------------------------------------------- */
.songlist-pager {
    display: flex; justify-content: center;
    padding: 0.8rem 1rem;
    border-top: 1px solid var(--line);
}
.songlist-pager .pagination { margin: 0; }
.songlist-pager .pagination-link { cursor: pointer; }
</style>
