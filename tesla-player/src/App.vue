<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <router-link class="brand__emblem" :to="{ name: 'play' }" aria-label="Tesla Player"
          :style="{ '--emblem-src': 'url(' + emblemSrc + ')' }" />
        <div class="brand__text">
          <router-link class="brand__app" :to="{ name: 'play' }">Tesla Player</router-link>
          <a class="brand__label-link" href="https://clubelek.fr" target="_blank" rel="noopener"
            title="clubelek.fr">
            <img class="brand__label" :src="labelSrc" alt="Clubelek" />
          </a>
        </div>
      </div>

      <nav class="nav">
        <router-link class="nav-item" :to="{ name: 'play' }">
          <span class="icon"><i class="fas fa-play"></i></span>{{ $t('nav.play') }}
        </router-link>
        <router-link class="nav-item" :to="{ name: 'edit' }">
          <span class="icon"><i class="fas fa-pencil"></i></span>{{ $t('nav.edit') }}
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
          <div class="select-field" :class="{ 'is-synth': isSynthSelected }">
            <select v-model="selectedOutputId" @change="onOutputChange">
              <option :value="synthId">⚡ {{ $t('label.builtinSynth') }}</option>
              <option v-for="o in outputs" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>
          <span v-if="isSynthSelected" class="output-emul"><span class="icon"><i class="fas fa-wave-square"></i></span>{{ $t('label.emulationHint') }}</span>
        </div>
        <div class="sidebar-output">
          <label class="sidebar-output__label">{{ $t('label.secondOutput') }}</label>
          <div class="select-field">
            <select v-model="selectedOutput2Id" @change="onOutput2Change">
              <option :value="null">—</option>
              <option v-for="o in outputs" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>
          <!-- manual latency offset to align the 2nd output with the 1st (hardware calibration) -->
          <div v-if="selectedOutput2Id" class="sidebar-offset" :title="$t('label.output2OffsetHint')">
            <label class="sidebar-offset__label" for="out2-offset">{{ $t('label.output2Offset') }}</label>
            <input id="out2-offset" class="sidebar-offset__range" type="range" min="-200" max="200" step="5"
              v-model.number="output2Offset">
            <span class="sidebar-offset__val">{{ output2Offset > 0 ? '+' : '' }}{{ output2Offset }} ms</span>
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

      <!-- Desktop app: a prominent Sync button, then server config + language.
           No online/offline (the backend is local). -->
      <section v-if="isElectron" class="sidebar-foot-el">
        <button class="btn btn--volt sidebar-foot-el__sync" type="button" @click="syncOpen = true">
          <span class="icon"><i class="fas fa-rotate"></i></span>{{ $t('desktop.sync') }}
        </button>
        <div class="sidebar-foot-el__row">
          <button class="btn btn--ghost sidebar-foot-el__cfg" type="button"
            :title="$t('desktop.serverConfig')" @click="serverOpen = true">
            <span class="icon"><i class="fas fa-server"></i></span>{{ $t('desktop.serverConfig') }}
          </button>
          <div class="select-field">
            <select v-model="$i18n.locale" @change="onLanguageChange">
              <option v-for="locale in $i18n.availableLocales" :key="locale" :value="locale">{{ locale }}</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Web: online/offline + language, then a discreet "download app" link -->
      <template v-else>
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
        <button class="sidebar__action" type="button" @click="downloadOpen = true">
          <span class="icon"><i class="fas fa-download"></i></span>{{ $t('desktop.downloadApp') }}
        </button>
      </template>
    </aside>

    <main class="app-main">
      <router-view />
    </main>

    <general-config-modal :open="configOpen" :config="midiStore.appConfig"
      @save="saveConfig" @cancel="configOpen = false" />
    <server-config-modal v-if="isElectron" :open="serverOpen"
      @close="serverOpen = false" @saved="onServerSaved" />
    <sync-modal v-if="isElectron" :open="syncOpen"
      @close="syncOpen = false" @applied="onSyncApplied" />
    <download-modal v-if="!isElectron" :open="downloadOpen" @close="downloadOpen = false" />
    <app-toaster />
  </div>
</template>

<script>
import { mapStores } from 'pinia'
import { WebMidi } from 'webmidi'
import emblemSrc from '@/assets/emblem_high_black.svg'
import labelSrc from '@/assets/label_high_black.svg'
import { useMidiStore } from '@/stores/midi'
import { coilColor } from '@/ui/coil-colors'
import { notify } from '@/utils/toast'
import { getTeslaSynth, SYNTH_OUTPUT_ID } from '@/audio/tesla-synth'
import GeneralConfigModal from '@/components/GeneralConfigModal.vue'
import ServerConfigModal from '@/components/ServerConfigModal.vue'
import SyncModal from '@/components/SyncModal.vue'
import DownloadModal from '@/components/DownloadModal.vue'
import AppToaster from '@/components/AppToaster.vue'

export default {
  name: 'App',
  components: { GeneralConfigModal, ServerConfigModal, SyncModal, DownloadModal, AppToaster },
  data() {
    return {
      emblemSrc,
      labelSrc,
      isConnected: false,
      pingTimer: null,
      configOpen: false,
      // Electron desktop bridge (absent in the web build).
      isElectron: typeof window !== 'undefined' && window.teslaElectron?.isElectron === true,
      serverOpen: false,
      syncOpen: false,
      unsubServerConfig: null,
      // Web-only: desktop-app download modal.
      downloadOpen: false,
      synthId: SYNTH_OUTPUT_ID,
      // default to the built-in synth until a real output is explicitly chosen
      selectedOutputId: localStorage.getItem('midiOutput1Id') || SYNTH_OUTPUT_ID,
      selectedOutput2Id: localStorage.getItem('midiOutput2Id') || null
    }
  },
  computed: {
    ...mapStores(useMidiStore),
    isSynthSelected() { return this.selectedOutputId === SYNTH_OUTPUT_ID },
    outputs() {
      return this.midiStore.midiOutputList || []
    },
    // manual 2nd-output timing offset (ms), persisted per-machine in the store
    output2Offset: {
      get() { return this.midiStore.output2OffsetMs },
      set(v) { this.midiStore.setOutput2Offset(Number(v)) }
    }
  },
  methods: {
    coilColor,
    saveConfig(config) {
      this.axios.put('/api/settings', config)
        .then(r => { this.midiStore.setAppConfig(r.data); notify('label.settingsSaved') })
        .catch(err => console.error('Save config failed', err))
        .finally(() => { this.configOpen = false })
    },
    // Resolve the store's outputs from the selected ids. Output 1 falls back to
    // the built-in synth whenever no real output is chosen/connected. WebMidi
    // rebuilds Output objects on (dis)connection, so we always look up by id.
    resolveOutputs() {
      let out1 = this.selectedOutputId === SYNTH_OUTPUT_ID
        ? null
        : (this.outputs.find(o => o.id === this.selectedOutputId) || null)
      if (!out1) { out1 = getTeslaSynth(); this.selectedOutputId = SYNTH_OUTPUT_ID }
      this.midiStore.setMidiOutput(out1)
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
      localStorage.setItem('midiOutput1Id', this.selectedOutputId || SYNTH_OUTPUT_ID)
      if (this.selectedOutputId === SYNTH_OUTPUT_ID) {
        const synth = getTeslaSynth()
        synth.resume() // selection is a user gesture → unlock the AudioContext
        this.midiStore.setMidiOutput(synth)
      } else {
        this.resolveOutputs()
      }
    },
    onOutput2Change() {
      if (this.selectedOutput2Id) localStorage.setItem('midiOutput2Id', this.selectedOutput2Id)
      else localStorage.removeItem('midiOutput2Id')
      this.midiStore.setMidiOutput2(this.outputs.find(o => o.id === this.selectedOutput2Id) || null)
    },
    onLanguageChange() {
      localStorage.setItem('locale', this.$i18n.locale)
    },
    // --- Desktop app (Electron-only sync/server) ---
    onServerSaved() {
      notify('label.settingsSaved')
    },
    onSyncApplied() {
      // A pull may have changed the local DB — refresh the cached lists, and
      // bump the data revision so views that fetch ad-hoc (playlists) re-read.
      this.axios.get('/api/midi').then(r => this.midiStore.setMidiFileList(r.data)).catch(() => {})
      this.axios.get('/api/songs').then(r => this.midiStore.setMidiSongList(r.data)).catch(() => {})
      this.midiStore.bumpDataRevision()
    },
    ping() {
      this.axios.get('/api/ping')
        .then(() => { this.isConnected = true })
        .catch(() => { this.isConnected = false })
    }
  },
  mounted() {
    this.resolveOutputs() // built-in synth available immediately, even before/without WebMIDI
    WebMidi.enable({ sysex: true }).then(this.onEnabled).catch(err => console.error('WebMIDI:', err))
    this.axios.get('/api/midi').then(r => this.midiStore.setMidiFileList(r.data)).catch(() => {})
    this.axios.get('/api/songs').then(r => this.midiStore.setMidiSongList(r.data)).catch(() => {})
    this.axios.get('/api/settings').then(r => this.midiStore.setAppConfig(r.data)).catch(() => {})
    this.ping()
    this.pingTimer = setInterval(this.ping, 10000)
    // Native menu "Server configuration…" opens the modal.
    if (this.isElectron && window.teslaElectron) {
      this.unsubServerConfig = window.teslaElectron.onOpenServerConfig(() => { this.serverOpen = true })
    }
  },
  beforeUnmount() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.unsubServerConfig) this.unsubServerConfig()
    if (WebMidi.enabled) {
      WebMidi.removeListener('connected', this.refreshOutputs)
      WebMidi.removeListener('disconnected', this.refreshOutputs)
    }
  }
}
</script>
