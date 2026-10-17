<template>
  <!-- No song selected: the songs (search, new song, table) -->
  <div v-if="isChooser" class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.edit') }}<page-tour-button id="edit" /></h1>
    </header>
    <div class="screen-body lib-page">
      <song-library />
    </div>
  </div>

  <!-- A song is selected: the atelier (its own head, the player in its toolbar) -->
  <div v-else class="screen screen--atelier">
    <song-editor v-if="currentSong" :song="currentSong" @saved="onSaved" @deleted="onDeleted" />
    <p v-else class="atelier__loading"><span class="arc-loader" aria-hidden="true"></span>{{ $t('label.loading') }}…</p>
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'
import SongEditor from '@/components/editor/SongEditor.vue'
import SongLibrary from '@/components/editor/SongLibrary.vue'
import PageTourButton from '@/components/tour/PageTourButton.vue'

export default {
  name: 'EditView',
  components: { SongEditor, SongLibrary, PageTourButton },
  watch: {
    isInvalidId: {
      immediate: true,
      handler(invalid) {
        if (invalid) {
          this.$router.replace({ name: 'edit', params: {} })
        }
      }
    }
  },
  computed: {
    ...mapStores(useMidiStore),
    routeId() {
      return this.$route.params.id
    },
    isInvalidId() {
      const id = this.routeId
      if (!id) return false
      const list = this.midiStore.midiSongList
      if (!list || list.length === 0) return false
      return !list.some(s => s.id === Number(id))
    },
    isChooser() {
      return !this.routeId
    },
    currentSong() {
      const id = Number(this.routeId)
      if (!id) return null
      return this.midiStore.midiSongList.find(s => s.id === id) || null
    }
  },
  methods: {
    onSaved(song) {
      if (String(song.id) !== String(this.routeId)) {
        this.$router.replace({ name: 'edit', params: { id: String(song.id) } })
      }
    },
    onDeleted() {
      // song removed from the store by the editor → back to the songs
      this.$router.push({ name: 'edit', params: {} })
    }
  }
}
</script>
