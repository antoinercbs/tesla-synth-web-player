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
    <header class="screen-head" :class="{ 'is-scrolled': headerScrolled }">
      <h1 class="view-head__title">{{ headTitle }}</h1>
      <button class="icon-btn" type="button" :title="$t('label.closeEditor')" :aria-label="$t('label.closeEditor')" @click="close">
        <i class="fas fa-xmark"></i>
      </button>
    </header>
    <div class="edit-body">
      <div class="edit-body__editor" :style="editorStyle">
        <song-editor :song="currentSong" :locked="playing" @saved="onSaved" @change="onChange" @deleted="onDeleted"
          @instruments-saved="onInstrumentsSaved" />
      </div>
      <resize-handle class="edit-body__split" @resize-start="onDockResizeStart" @resize="onDockResize"
        @resize-end="saveDockWidth" />
      <aside class="edit-body__dock" ref="dockEl" :style="dockStyle">
        <midi-player ref="player" :show-autoplay="false" :compact-graph="true" @playing-change="playing = $event" />
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
import ResizeHandle from '@/components/ResizeHandle.vue'

const DOCK_MIN = 300
const DOCK_MAX = 760

export default {
  name: 'EditView',
  components: { SongEditor, MidiPlayer, SearchableSelect, ResizeHandle },
  data() {
    return {
      playing: false,
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
    onInstrumentsSaved() {
      // the selected file was rewritten on disk → force the embedded player to
      // re-fetch + re-parse so playback uses the new instruments.
      this.$refs.player?.reloadMidi()
    },
    onDeleted() {
      // song removed from the store by the editor → back to the chooser
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
