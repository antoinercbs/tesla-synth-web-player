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

      <section class="sidebar-card">
        <div class="sidebar-card__title">{{ $t('title.outputSelection') }}</div>
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
      </section>

      <section class="sidebar-card">
        <div class="sidebar-card__title">
          {{ $t('title.coils') }}
          <button class="sidebar-card__cfg" type="button" :title="$t('label.generalConfig')"
            @click="configOpen = true">
            <i class="fas fa-gear"></i>
          </button>
        </div>
        <ul class="sidebar-coils">
          <li v-for="n in midiStore.appConfig.defaultCoilCount" :key="n - 1" class="sidebar-coil">
            <span class="sidebar-coil__dot" :style="{ '--c': coilColor(n - 1) }"></span>
            <span class="sidebar-coil__idx">{{ n - 1 }}</span>
            <span class="sidebar-coil__name" :class="{ 'is-empty': !midiStore.coilName(n - 1) }">
              {{ midiStore.coilName(n - 1) || $t('label.unnamedCoil') }}
            </span>
          </li>
        </ul>
      </section>

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

    <general-config-modal :open="configOpen" :config="midiStore.appConfig"
      @save="saveConfig" @cancel="configOpen = false" />
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { WebMidi } from 'webmidi'
import { useMidiStore } from '@/stores/midi'
import { coilColor } from '@/ui/coil-colors'
import GeneralConfigModal from '@/components/GeneralConfigModal.vue'

export default {
  name: 'App',
  components: { GeneralConfigModal },
  data() {
    return {
      isConnected: false,
      pingTimer: null,
      configOpen: false,
      selectedOutputId: localStorage.getItem('midiOutput1Id') || null,
      selectedOutput2Id: localStorage.getItem('midiOutput2Id') || null
    }
  },
  computed: {
    ...mapStores(useMidiStore),
    outputs() {
      return this.midiStore.midiOutputList || []
    }
  },
  methods: {
    coilColor,
    saveConfig(config) {
      this.axios.put('/api/settings', config)
        .then(r => this.midiStore.setAppConfig(r.data))
        .catch(err => console.error('Save config failed', err))
        .finally(() => { this.configOpen = false })
    },
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
      this.resolveOutputs() // restore the persisted output selection
    },
    onOutputChange() {
      if (this.selectedOutputId) localStorage.setItem('midiOutput1Id', this.selectedOutputId)
      else localStorage.removeItem('midiOutput1Id')
      this.midiStore.setMidiOutput(this.outputs.find(o => o.id === this.selectedOutputId) || null)
    },
    onOutput2Change() {
      if (this.selectedOutput2Id) localStorage.setItem('midiOutput2Id', this.selectedOutput2Id)
      else localStorage.removeItem('midiOutput2Id')
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
    this.axios.get('/api/settings').then(r => this.midiStore.setAppConfig(r.data)).catch(() => {})
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
