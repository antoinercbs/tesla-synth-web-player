<template>
  <div class="app-shell">
    <!-- Hide the full chrome on the login/callback screens (auth enabled but not
         yet signed in); the centered login card takes the whole main area. -->
    <app-sidebar v-if="showChrome" />
    <main class="app-main">
      <router-view />
    </main>
    <app-toaster />
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { useMidiStore } from '@/stores/midi'
import { useAuthStore } from '@/stores/auth'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppToaster from '@/components/ui/AppToaster.vue'

export default {
  name: 'App',
  components: { AppSidebar, AppToaster },
  computed: {
    ...mapStores(useMidiStore, useAuthStore),
    // Full app chrome (sidebar) is shown unless we're gated at the login /
    // access-denied screen (auth on, and either not signed in or role-refused).
    showChrome() {
      const a = this.authStore
      return !(a.enabled && (!a.authenticated || a.accessDenied))
    }
  },
  methods: {
    // App-level data bootstrap: every view reads these from the store. (WebMIDI,
    // output resolution, and the connection ping live in AppSidebar — the output
    // picker — which is always mounted as part of the shell.)
    loadBootData() {
      this.axios.get('/api/midi').then(r => this.midiStore.setMidiFileList(r.data)).catch(() => {})
      this.axios.get('/api/songs').then(r => this.midiStore.setMidiSongList(r.data)).catch(() => {})
      this.axios.get('/api/settings').then(r => this.midiStore.setAppConfig(r.data)).catch(() => {})
    }
  },
  watch: {
    // When auth is enabled, load (and re-load) the moment the user becomes
    // authenticated — e.g. right after the login round-trip lands back on /play.
    'authStore.authenticated'(isAuth) {
      if (isAuth) this.loadBootData()
    }
  },
  mounted() {
    // Only fetch when allowed: auth off (always), or auth on AND authenticated.
    // Otherwise the router guard has bounced us to /login and these would 401.
    if (!this.authStore.enabled || this.authStore.authenticated) this.loadBootData()
  }
}
</script>
