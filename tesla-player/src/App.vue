<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand__bolt"><i class="fas fa-bolt"></i></span>
        <div>
          <div>Tesla Player</div>
          <div class="brand__sub">Clubelek</div>
        </div>
      </div>

      <nav class="nav">
        <router-link class="nav-item" :to="{ name: 'play' }">
          <span class="icon"><i class="fas fa-play"></i></span>{{ $t('nav.play') }}
        </router-link>
        <router-link class="nav-item" :to="{ name: 'edit' }">
          <span class="icon"><i class="fas fa-sliders"></i></span>{{ $t('nav.edit') }}
        </router-link>
        <router-link class="nav-item" :to="{ name: 'playlists' }">
          <span class="icon"><i class="fas fa-list-ul"></i></span>{{ $t('nav.playlists') }}
        </router-link>
      </nav>

      <div class="sidebar__spacer"></div>

      <div class="sidebar__section-title">{{ $t('title.outputSelection') }}</div>
      <div class="sidebar-output">
        <label class="sidebar-output__label">{{ $t('label.firstOutput') }}</label>
        <div class="select-field">
          <select v-model="selectedOutputId" @change="onOutputChange">
            <option :value="null">—</option>
            <option v-for="o in outputs" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>
      </div>
      <div class="sidebar-output">
        <label class="sidebar-output__label">{{ $t('label.secondOutput') }}</label>
        <div class="select-field">
          <select v-model="selectedOutput2Id" @change="onOutput2Change">
            <option :value="null">—</option>
            <option v-for="o in outputs" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>
      </div>

      <div class="sidebar__foot">
        <div class="conn" :class="{ 'is-up': isConnected }">
          <span class="conn__dot"></span>
          {{ isConnected ? 'online' : 'offline' }}
        </div>
        <div class="select-field">
          <select v-model="$i18n.locale" @change="onLanguageChange">
            <option v-for="locale in $i18n.availableLocales" :key="locale" :value="locale">{{ locale }}</option>
          </select>
        </div>
      </div>
    </aside>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { WebMidi } from 'webmidi'
import { useMidiStore } from '@/stores/midi'

export default {
  name: 'App',
  data() {
    return { isConnected: false, pingTimer: null, selectedOutputId: null, selectedOutput2Id: null }
  },
  computed: {
    ...mapStores(useMidiStore),
    outputs() {
      return this.midiStore.midiOutputList || []
    }
  },
  methods: {
    // Resolve the store's Output instances from the selected ids. WebMidi
    // rebuilds Output objects on (dis)connection, so we always look up by id.
    resolveOutputs() {
      this.midiStore.setMidiOutput(this.outputs.find(o => o.id === this.selectedOutputId) || null)
      this.midiStore.setMidiOutput2(this.outputs.find(o => o.id === this.selectedOutput2Id) || null)
    },
    refreshOutputs() {
      this.midiStore.setMidiOutputList(WebMidi.outputs)
      this.resolveOutputs()
    },
    onEnabled() {
      this.midiStore.setMidiOutputList(WebMidi.outputs)
      WebMidi.addListener('connected', this.refreshOutputs)
      WebMidi.addListener('disconnected', this.refreshOutputs)
    },
    onOutputChange() {
      this.midiStore.setMidiOutput(this.outputs.find(o => o.id === this.selectedOutputId) || null)
    },
    onOutput2Change() {
      this.midiStore.setMidiOutput2(this.outputs.find(o => o.id === this.selectedOutput2Id) || null)
    },
    onLanguageChange() {
      localStorage.setItem('locale', this.$i18n.locale)
    },
    ping() {
      this.axios.get('/api/ping')
        .then(() => { this.isConnected = true })
        .catch(() => { this.isConnected = false })
    }
  },
  mounted() {
    WebMidi.enable({ sysex: true }).then(this.onEnabled).catch(err => console.error('WebMIDI:', err))
    this.axios.get('/api/midi').then(r => this.midiStore.setMidiFileList(r.data)).catch(() => {})
    this.axios.get('/api/songs').then(r => this.midiStore.setMidiSongList(r.data)).catch(() => {})
    this.ping()
    this.pingTimer = setInterval(this.ping, 10000)
  },
  beforeUnmount() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (WebMidi.enabled) {
      WebMidi.removeListener('connected', this.refreshOutputs)
      WebMidi.removeListener('disconnected', this.refreshOutputs)
    }
  }
}
</script>
