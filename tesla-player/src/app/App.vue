<template>
  <div class="app-shell">
    <!-- Hide the full chrome on the login/callback screens (auth enabled but not
         yet signed in); the centered login card takes the whole main area. -->
    <app-sidebar v-if="showChrome" />
    <main class="app-main">
      <!-- off for a moment while a guided tour swaps the real data for the demo's, and back -->
      <router-view v-if="!tour.swapping" />
    </main>
    <app-toaster />
    <!-- the overlay and its demo fetched with the first tour -->
    <tour-overlay v-if="showChrome && tourOn" />
    <welcome-dialog v-if="showChrome && !tour.active" />
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue'
import { mapStores } from 'pinia'
import { useMidiStore } from '@/app/stores/midi'
import { useAuthStore } from '@/app/stores/auth'
import { useScenesStore } from '@/app/stores/scenes'
import { listScenes } from '@/api/scenes'
import AppSidebar from '@/ui/components/layout/AppSidebar.vue'
import AppToaster from '@/ui/components/ui/AppToaster.vue'
import WelcomeDialog from '@/ui/components/tour/WelcomeDialog.vue'
import { tour } from '@/ui/tour/tour'
import { startBoardMonitor } from '@/app/board-monitor'

export default {
  name: 'App',
  components: {
    AppSidebar, AppToaster, WelcomeDialog,
    TourOverlay: defineAsyncComponent(() => import('@/ui/components/tour/TourOverlay.vue'))
  },
  data() {
    return { tour, tourOn: tour.active }
  },
  computed: {
    ...mapStores(useMidiStore, useAuthStore, useScenesStore),
    // Full app chrome (sidebar) is shown unless we're gated at the login /
    // access-denied screen (auth on, and either not signed in or role-refused).
    showChrome() {
      if (this.$route.meta.bare) return false // e.g. the tuning camera page on a phone
      const a = this.authStore
      return !(a.enabled && (!a.authenticated || a.accessDenied))
    }
  },
  methods: {
    // App-level data bootstrap: every view reads these from the store. (WebMIDI,
    // output resolution, and the connection ping live in AppSidebar — the output
    // picker — which is always mounted as part of the shell.)
    loadBootData() {
      this.axios.get('/api/songs').then(r => this.midiStore.setMidiSongList(r.data)).catch(() => {})
      this.axios.get('/api/settings').then(r => this.midiStore.setAppConfig(r.data)).catch(() => {})
      this.axios.get('/api/tags').then(r => this.midiStore.setTagList(r.data)).catch(() => {})
      this.axios.get('/api/envelopes').then(r => this.midiStore.setEnvelopeList(r.data)).catch(() => {})
      this.axios.get('/api/coils').then(r => this.midiStore.setCoilList(r.data)).catch(() => {})
      listScenes().then(list => this.scenesStore.setList(list)).catch(() => {})
    }
  },
  watch: {
    'tour.active'(on) {
      if (on) this.tourOn = true
    },
    // When auth is enabled, load (and re-load) the moment the user becomes
    // authenticated — e.g. right after the login round-trip lands back on /play.
    'authStore.authenticated'(isAuth) {
      if (isAuth) this.loadBootData()
    }
  },
  created() {
    startBoardMonitor()
  },
  mounted() {
    // Only fetch when allowed: auth off (always), or auth on AND authenticated.
    // Otherwise the router guard has bounced us to /login and these would 401.
    if (!this.authStore.enabled || this.authStore.authenticated) this.loadBootData()
  }
}
</script>
