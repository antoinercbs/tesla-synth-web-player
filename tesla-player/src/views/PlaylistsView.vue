<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.playlists') }}</h1>
    </header>
    <div class="screen-body">
      <div class="columns">
        <div class="column is-6">
          <playlist-manager />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import PlaylistManager from '@/components/PlaylistManager.vue'

export default {
  name: 'PlaylistsView',
  components: { PlaylistManager }
}
</script>
