<template>
  <div class="app-shell">
    <app-sidebar />
    <main class="app-main">
      <router-view />
    </main>
    <app-toaster />
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppToaster from '@/components/ui/AppToaster.vue'

export default {
  name: 'App',
  components: { AppSidebar, AppToaster },
  computed: { ...mapStores(useMidiStore) },
  mounted() {
    // App-level data bootstrap: every view reads these from the store. (WebMIDI,
    // output resolution, and the connection ping live in AppSidebar — the output
    // picker — which is always mounted as part of the shell.)
    this.axios.get('/api/midi').then(r => this.midiStore.setMidiFileList(r.data)).catch(() => {})
    this.axios.get('/api/songs').then(r => this.midiStore.setMidiSongList(r.data)).catch(() => {})
    this.axios.get('/api/settings').then(r => this.midiStore.setAppConfig(r.data)).catch(() => {})
  }
}
</script>
