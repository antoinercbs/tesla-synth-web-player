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

  <!-- A song is selected: the editor + embedded debug player -->
  <div v-else class="screen">
    <header class="screen-head" :class="{ 'is-scrolled': headerScrolled }">
      <h1 class="view-head__title">{{ headTitle }}<page-tour-button v-if="!dirty" id="edit" /></h1>
      <RouterLink class="icon-btn" :to="{ name: 'edit', params: {} }" :title="$t('label.closeEditor')"
        :aria-label="$t('label.closeEditor')">
        <i class="fas fa-xmark"></i>
      </RouterLink>
    </header>
    <div class="edit-body">
      <div class="edit-body__editor" :style="editorStyle">
        <song-editor :song="currentSong" :locked="playing" :player-position="playerPosition" @saved="onSaved"
          @change="onChange" @deleted="onDeleted" @dirty="dirty = $event" />
      </div>
      <resize-handle class="edit-body__split" @resize-start="onDockResizeStart" @resize="onDockResize"
        @resize-end="saveDockWidth" />
      <aside class="edit-body__dock" ref="dockEl" :style="dockStyle">
        <midi-player ref="player" :show-autoplay="false" :compact-graph="true" @playing-change="playing = $event"
          @position="playerPosition = $event" />
      </aside>
    </div>
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'
import SongEditor from '@/components/editor/SongEditor.vue'
import MidiPlayer from '@/components/player/MidiPlayer.vue'
import SongLibrary from '@/components/editor/SongLibrary.vue'
import ResizeHandle from '@/components/ui/ResizeHandle.vue'
import PageTourButton from '@/components/tour/PageTourButton.vue'

const DOCK_MIN = 300
const DOCK_MAX = 760

export default {
  name: 'EditView',
  components: { SongEditor, MidiPlayer, SongLibrary, ResizeHandle, PageTourButton },
  data() {
    return {
      playing: false,
      dirty: false,
      // where the embedded player is: the editor adds automation points there
      playerPosition: 0,
      headerScrolled: false,
      scrollEl: null,
      // Player dock width (px), drag-resizable + persisted. null = use the
      // default 2:1 proportion (editor 2/3, player 1/3) until the user drags.
      dockWidth: Number(localStorage.getItem('editDockWidth')) || null,
    }
  },
  mounted() {
    this.syncPlayer()
    this.scrollEl = this.$el?.closest?.('.app-main') || document.querySelector('.app-main')
    if (this.scrollEl) {
      this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true })
      this.onScroll()
    }
  },
  beforeUnmount() {
    if (this.scrollEl) this.scrollEl.removeEventListener('scroll', this.onScroll)
  },
  watch: {
    currentSong() {
      this.syncPlayer()
    },
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
    },
    headTitle() {
      return this.currentSong ? (this.currentSong.name || `#${this.currentSong.id}`) : ''
    },
    // editor : player = 2 : 1 by default; once dragged, editor fills the rest.
    editorStyle() {
      return this.dockWidth == null ? { flex: '2 1 0', minWidth: 0 } : { flex: '1 1 0', minWidth: 0 }
    },
    dockStyle() {
      return this.dockWidth == null
        ? { flex: '1 1 0', minWidth: 0 }
        : { flex: `0 0 ${this.dockWidth}px`, width: `${this.dockWidth}px` }
    }
  },
  methods: {
    // Seed the px width from the current render on the first drag (keeps the 2:1 default).
    onDockResizeStart() {
      if (this.dockWidth == null) {
        this.dockWidth = this.$refs.dockEl?.offsetWidth || 400
      }
    },
    // Drag the divider: moving right shrinks the dock (it sits on the right).
    onDockResize(dx) {
      if (this.dockWidth == null) return
      this.dockWidth = Math.min(DOCK_MAX, Math.max(DOCK_MIN, this.dockWidth - dx))
    },
    saveDockWidth() {
      if (this.dockWidth != null) localStorage.setItem('editDockWidth', String(this.dockWidth))
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
      // song removed from the store by the editor → back to the songs
      this.$router.push({ name: 'edit', params: {} })
    },
    onScroll() {
      this.headerScrolled = (this.scrollEl?.scrollTop ?? 0) > 6
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
