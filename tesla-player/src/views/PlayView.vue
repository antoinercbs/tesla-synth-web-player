<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.play') }}</h1>
    </header>

    <div class="screen-body">
      <div class="columns">
        <div class="column is-5">
          <midi-song-list
            @editSong="onEditSong"
            @playSong="onPlaySong" />
        </div>
        <div class="column is-7">
          <midi-player ref="player" />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import MidiSongList from '@/components/MidiSongList.vue'
import MidiPlayer from '@/components/MidiPlayer.vue'

export default {
  name: 'PlayView',
  components: { MidiSongList, MidiPlayer },
  methods: {
    onEditSong(song) {
      this.$router.push({ name: 'edit', params: { id: String(song.id) } })
    },
    onPlaySong(song) {
      this.$refs.player.loadSong(song)
    }
  }
}
</script>
