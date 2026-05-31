<template>
  <!-- No song selected: a sober, centred chooser (pick existing OR create new) -->
  <div v-if="isChooser" class="edit-chooser">
    <div class="edit-chooser__card">
      <h1 class="view-head__title">{{ $t('nav.edit') }}</h1>
      <p class="edit-chooser__hint">{{ $t('label.chooseOrCreate') }}</p>
      <div class="edit-chooser__actions">
        <searchable-select
          class="edit-chooser__pick"
          v-model="chooserPick"
          :items="songItems"
          :label="$t('label.selectSongToEdit')"
          :placeholder="$t('label.selectSongToEdit')" />
        <span class="edit-chooser__or">{{ $t('label.or') }}</span>
        <button class="btn btn--volt" type="button" @click="newSong">
          <span class="icon"><i class="fas fa-file-circle-plus"></i></span>
          {{ $t('label.newSong') }}
        </button>
      </div>
    </div>
  </div>

  <!-- A song (or "new") is selected: the editor + embedded debug player -->
  <div v-else class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ headTitle }}</h1>
      <button class="icon-btn" type="button" :title="$t('label.closeEditor')" :aria-label="$t('label.closeEditor')" @click="close">
        <i class="fas fa-xmark"></i>
      </button>
    </header>
    <div class="edit-body">
      <div class="edit-body__editor">
        <song-editor :song="currentSong" :locked="playing" @saved="onSaved" @change="onChange" @deleted="onDeleted" />
      </div>
      <aside class="edit-body__dock">
        <midi-player ref="player" :show-autoplay="false" @playing-change="playing = $event" />
      </aside>
    </div>
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'
import SongEditor from '@/components/SongEditor.vue'
import MidiPlayer from '@/components/MidiPlayer.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'

export default {
  name: 'EditView',
  components: { SongEditor, MidiPlayer, SearchableSelect },
  data() {
    return { playing: false }
  },
  mounted() {
    this.syncPlayer()
  },
  watch: {
    currentSong() {
      this.syncPlayer()
    }
  },
  computed: {
    ...mapStores(useMidiStore),
    routeId() {
      return this.$route.params.id
    },
    isChooser() {
      return this.routeId == null
    },
    songItems() {
      return this.midiStore.midiSongList.map(s => ({ id: s.id, label: s.name || `#${s.id}` }))
    },
    currentSong() {
      const id = Number(this.routeId)
      if (!id) return null
      return this.midiStore.midiSongList.find(s => s.id === id) || null
    },
    headTitle() {
      return this.currentSong ? (this.currentSong.name || `#${this.currentSong.id}`) : this.$t('label.newSong')
    },
    chooserPick: {
      get() { return null },
      set(id) { if (id) this.$router.push({ name: 'edit', params: { id: String(id) } }) }
    }
  },
  methods: {
    newSong() {
      this.$router.push({ name: 'edit', params: { id: 'new' } })
    },
    close() {
      this.$router.push({ name: 'edit', params: {} })
    },
    onSaved(song) {
      if (String(song.id) !== String(this.routeId)) {
        this.$router.replace({ name: 'edit', params: { id: String(song.id) } })
      }
    },
    onChange(song) {
      this.$refs.player?.loadSong(song)
    },
    onDeleted() {
      // song removed from the store by the editor → back to the chooser
      this.$router.push({ name: 'edit', params: {} })
    },
    // Preload the embedded player with the current song (refs ready on nextTick).
    syncPlayer() {
      this.$nextTick(() => {
        if (this.currentSong) this.$refs.player?.loadSong(this.currentSong)
      })
    }
  }
}
</script>
