<template>
  <aside class="sidebar" :class="{ 'sidebar--compact': sidebarCompact }">
    <!-- Signed-in identity + sign-out, at the very top (web, OIDC-enabled server). -->
    <div v-if="authStore.enabled && authStore.authenticated && !sidebarCompact" class="sidebar-auth">
      <span class="sidebar-auth__who" :title="authStore.displayName">
        <i class="fas fa-user"></i><span class="sidebar-auth__name">{{ authStore.displayName || $t('auth.signedIn') }}</span>
      </span>
      <button class="sidebar-auth__out" type="button" :title="$t('auth.signOut')" @click="signOut">
        <i class="fas fa-right-from-bracket"></i>
      </button>
    </div>

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
      <button class="brand__toggle" type="button" @click="toggleSidebar"
        :title="sidebarCompact ? $t('nav.expandSidebar') : $t('nav.collapseSidebar')"
        :aria-label="sidebarCompact ? $t('nav.expandSidebar') : $t('nav.collapseSidebar')">
        <i class="fas" :class="sidebarCompact ? 'fa-angles-right' : 'fa-angles-left'"></i>
      </button>
    </div>

    <nav class="nav">
      <router-link class="nav-item" :to="{ name: 'play' }" :title="sidebarCompact ? $t('nav.play') : null">
        <span class="icon"><i class="fas fa-play"></i></span><span class="nav-item__label">{{ $t('nav.play') }}</span>
      </router-link>
      <router-link class="nav-item" :to="{ name: 'edit' }" :title="sidebarCompact ? $t('nav.edit') : null">
        <span class="icon"><i class="fas fa-pencil"></i></span><span class="nav-item__label">{{ $t('nav.edit') }}</span>
      </router-link>
      <router-link class="nav-item" :to="{ name: 'playlists' }" :title="sidebarCompact ? $t('nav.playlists') : null">
        <span class="icon"><i class="fas fa-list-ul"></i></span><span class="nav-item__label">{{ $t('nav.playlists') }}</span>
      </router-link>
      <router-link class="nav-item" :to="{ name: 'midi' }" :title="sidebarCompact ? $t('nav.midi') : null">
        <span class="icon"><i class="fas fa-folder-open"></i></span><span class="nav-item__label">{{ $t('nav.midi') }}</span>
      </router-link>
      <!-- device config: only reachable over a live bidirectional serial link -->
      <router-link v-if="midiStore.serialConnected" class="nav-item" :to="{ name: 'syntherrupter' }"
        :title="sidebarCompact ? $t('nav.syntherrupter') : null">
        <span class="icon"><i class="fas fa-sliders"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter') }}</span>
      </router-link>
      <span v-else class="nav-item is-disabled" :title="$t('label.serialNeededForConfig')">
        <span class="icon"><i class="fas fa-sliders"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter') }}</span>
      </span>
    </nav>

    <div class="sidebar__spacer"></div>

    <section class="sidebar-card">
      <div class="sidebar-card__title">{{ $t('title.outputSelection') }}</div>
      <div class="sidebar-output">
        <label class="sidebar-output__label">{{ $t('label.firstOutput') }}</label>
        <!-- output 1 transport: virtual synth · MIDI device · bidirectional serial -->
        <segmented-control v-model="output1Mode" fill class="output-modes" @update:model-value="onMode1Change" :options="[
          { value: 'synth', label: $t('label.outSynth') },
          { value: 'midi', label: $t('label.outMidi') },
          { value: 'serial', label: $t('label.outSerial'), disabled: !serialSupported,
            title: serialSupported ? '' : $t('label.serialUnsupported') },
        ]" />

        <span v-if="output1Mode === 'synth'" class="output-emul">
          <span class="icon"><i class="fas fa-wave-square"></i></span>{{ $t('label.emulationHint') }}
        </span>

        <template v-else-if="output1Mode === 'midi'">
          <div class="select-field">
            <select v-model="selectedOutputId" @change="onOutputChange">
              <option v-for="o in outputs" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>
          <span v-if="outputs.length === 0" class="output-emul">{{ $t('label.noMidiOutput') }}</span>
        </template>

        <div v-else class="sidebar-serial">
          <template v-if="midiStore.serialConnected">
            <span class="sidebar-serial__on"><span class="conn__dot"></span>{{ midiStore.serialPortLabel }}</span>
            <button class="btn btn--ghost sidebar-serial__btn" type="button" @click="disconnectSerial">
              <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>{{ $t('label.serialDisconnect') }}
            </button>
          </template>
          <template v-else>
            <button class="btn btn--volt sidebar-serial__btn" type="button" :disabled="!serialSupported" @click="connectSerial">
              <span class="icon"><i class="fas fa-plug"></i></span>{{ $t('label.serialConnect') }}
            </button>
            <span v-if="!serialSupported" class="output-emul">{{ $t('label.serialUnsupported') }}</span>
            <span v-else-if="serialError" class="output-emul is-error">{{ serialError }}</span>
          </template>
        </div>
      </div>
      <div class="sidebar-output">
        <!-- second output is off by default (compact); the toggle reveals the picker -->
        <div class="sidebar-output__head">
          <label class="sidebar-output__label">{{ $t('label.secondOutput') }}</label>
          <label class="switch sidebar-output__toggle" :title="$t('label.secondOutput')">
            <input type="checkbox" v-model="showSecondOutput" @change="onSecondToggle">
            <span class="switch__track"></span>
          </label>
        </div>
        <template v-if="showSecondOutput">
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
        </template>
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

    <!-- Synthetic credits → verbose modal (foremost: the Syntherrupter author). -->
    <button v-if="!sidebarCompact" class="sidebar-credits" type="button"
      :title="$t('credits.title')" @click="creditsOpen = true">
      <i class="fas fa-circle-info"></i><span class="sidebar-credits__text">{{ $t('credits.footer') }}</span>
    </button>

    <!-- Compact rail keeps the essentials visible: selected output(s) + connection. -->
    <div v-if="sidebarCompact" class="sidebar-cstatus">
      <span class="cstat" :class="{ 'is-synth': midiStore.isSynthOutput || midiStore.isSerialOutput }"
        :title="$t('label.firstOutput') + ' · ' + output1Name">
        <i class="fas" :class="output1Icon"></i>
      </span>
      <span v-if="selectedOutput2Id" class="cstat cstat--spk"
        :title="$t('label.secondOutput') + ' · ' + output2Name">
        <i class="fas fa-volume-high"></i>
      </span>
      <span v-if="!isElectron" class="cstat-conn" :class="{ 'is-up': isConnected }"
        :title="isConnected ? 'online' : 'offline'">
        <span class="conn__dot"></span>
      </span>
    </div>
  </aside>

  <!-- sidebar action modals (config / desktop sync+server / download) -->
  <general-config-modal :open="configOpen" :config="midiStore.appConfig"
    @save="saveConfig" @close="configOpen = false" />
  <server-config-modal v-if="isElectron" :open="serverOpen"
    @close="serverOpen = false" @saved="onServerSaved" />
  <sync-modal v-if="isElectron" :open="syncOpen"
    @close="syncOpen = false" @applied="onSyncApplied" />
  <download-modal v-if="!isElectron" :open="downloadOpen" @close="downloadOpen = false" />
  <credits-modal :open="creditsOpen" @close="creditsOpen = false" />
</template>

<script>
import { markRaw } from 'vue'
import { mapStores } from 'pinia'
import { WebMidi } from 'webmidi'
import emblemSrc from '@/assets/emblem_high_black.svg'
import labelSrc from '@/assets/label_high_black.svg'
import { useMidiStore } from '@/stores/midi'
import { useAuthStore } from '@/stores/auth'
import { coilColor } from '@/ui/coil-colors'
import { notify } from '@/utils/toast'
import { getTeslaSynth, SYNTH_OUTPUT_ID } from '@/audio/tesla-synth'
import { SERIAL_OUTPUT_ID, SerialMidiOutput } from '@/serial/serial-midi'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import GeneralConfigModal from '@/components/settings/GeneralConfigModal.vue'
import ServerConfigModal from '@/components/desktop/ServerConfigModal.vue'
import SyncModal from '@/components/desktop/SyncModal.vue'
import DownloadModal from '@/components/desktop/DownloadModal.vue'
import CreditsModal from '@/components/layout/CreditsModal.vue'

/**
 * The application sidebar: brand, navigation, the collapse/compact toggle, MIDI
 * output selection (incl. the built-in synth + WebMIDI device resolution), the
 * coil legend, connection status / language, and the desktop sync/server/config
 * action modals. Owns the WebMIDI lifecycle + output resolution (it IS the
 * output picker) and the connection ping. App.vue stays a thin shell.
 */
export default {
  name: 'AppSidebar',
  components: { SegmentedControl, GeneralConfigModal, ServerConfigModal, SyncModal, DownloadModal, CreditsModal },
  data() {
    return {
      emblemSrc,
      labelSrc,
      // output-1 transport mode: 'synth' | 'midi' | 'serial' (persisted). Defaults
      // from the legacy persisted device id (synth vs a real MIDI output).
      output1Mode: localStorage.getItem('output1Mode')
        || ((localStorage.getItem('midiOutput1Id') || SYNTH_OUTPUT_ID) === SYNTH_OUTPUT_ID ? 'synth' : 'midi'),
      serialError: '',
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
      selectedOutput2Id: localStorage.getItem('midiOutput2Id') || null,
      // 2nd-output picker is collapsed unless a device is set (compact by default)
      showSecondOutput: !!localStorage.getItem('midiOutput2Id'),
      // narrow icon-rail sidebar (persisted); nav stays, the verbose cards collapse
      sidebarCompact: localStorage.getItem('sidebarCompact') === '1',
      creditsOpen: false
    }
  },
  computed: {
    ...mapStores(useMidiStore, useAuthStore),
    isSynthSelected() { return this.selectedOutputId === SYNTH_OUTPUT_ID },
    outputs() {
      return this.midiStore.midiOutputList || []
    },
    /** Web Serial available (Chromium; also Electron with the main-process handler). */
    serialSupported() {
      return typeof navigator !== 'undefined' && 'serial' in navigator
    },
    /** Compact-rail chip icon for the active output 1. */
    output1Icon() {
      if (this.midiStore.isSerialOutput) return 'fa-bolt'
      if (this.midiStore.isSynthOutput) return 'fa-wave-square'
      return 'fa-plug'
    },
    // name shown as the tooltip on the compact-sidebar output-1 chip
    output1Name() {
      if (this.midiStore.isSerialOutput) return this.midiStore.serialPortLabel
      return this.isSynthSelected
        ? this.$t('label.builtinSynth')
        : (this.outputs.find(o => o.id === this.selectedOutputId)?.name || '—')
    },
    output2Name() {
      return this.outputs.find(o => o.id === this.selectedOutput2Id)?.name || '—'
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
    // Resolve output 1 from the current mode. Output 2 is always a WebMIDI device.
    // A live serial link is never clobbered (a WebMIDI (dis)connect must not drop
    // it); other modes fall back to the built-in synth so sound always works.
    resolveOutputs() {
      if (this.output1Mode === 'serial') {
        if (!this.midiStore.serialConnected) this.midiStore.setMidiOutput(getTeslaSynth());
      } else if (this.output1Mode === 'midi') {
        const dev = this.outputs.find(o => o.id === this.selectedOutputId) || null;
        this.midiStore.setMidiOutput(dev || getTeslaSynth());
      } else {
        this.midiStore.setMidiOutput(getTeslaSynth());
        this.selectedOutputId = SYNTH_OUTPUT_ID;
      }
      this.midiStore.setMidiOutput2(this.outputs.find(o => o.id === this.selectedOutput2Id) || null);
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
      this.resolveOutputs()
    },
    // --- output-1 mode switch + serial (Syntherrupter) link ---
    onMode1Change(mode) {
      localStorage.setItem('output1Mode', mode)
      if (mode !== 'serial' && this.midiStore.serialConnected) this.closeSerial()
      if (mode === 'synth') {
        const synth = getTeslaSynth()
        synth.resume() // the click is a user gesture → unlock the AudioContext
        this.midiStore.setMidiOutput(synth)
        this.selectedOutputId = SYNTH_OUTPUT_ID
        localStorage.setItem('midiOutput1Id', SYNTH_OUTPUT_ID)
      } else {
        this.resolveOutputs() // midi → device/synth ; serial → synth until Connect
      }
    },
    async connectSerial() {
      this.serialError = ''
      if (!this.serialSupported) return
      try {
        const port = await navigator.serial.requestPort()
        await this.openSerial(port)
      } catch (err) {
        if (err && err.name !== 'NotFoundError') { // NotFoundError = picker dismissed
          this.serialError = this.$t('label.serialError')
          console.error('Serial connect failed', err)
        }
      }
    },
    async openSerial(port) {
      const label = this.portLabel(port)
      const out = await SerialMidiOutput.open(port, label, () => this.onSerialClosed())
      this.midiStore.setMidiOutput(markRaw(out))
      this.midiStore.setSerialConnection(label)
    },
    async closeSerial() {
      const out = this.midiStore.midiOutput
      this.midiStore.setSerialConnection(null)
      if (out && out.id === SERIAL_OUTPUT_ID) { try { await out.close() } catch { /* */ } }
    },
    async disconnectSerial() {
      await this.closeSerial()
      this.resolveOutputs() // fall back to the synth
    },
    onSerialClosed() {
      // stream ended (physical unplug or close) — drop the link + fall back
      this.midiStore.setSerialConnection(null)
      if (this.output1Mode === 'serial') this.resolveOutputs()
    },
    portLabel(port) {
      const info = port.getInfo ? port.getInfo() : null
      if (info && info.usbVendorId != null) {
        const hex = (n) => (n || 0).toString(16).padStart(4, '0')
        return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`
      }
      return this.$t('label.serialPort')
    },
    onOutput2Change() {
      if (this.selectedOutput2Id) localStorage.setItem('midiOutput2Id', this.selectedOutput2Id)
      else localStorage.removeItem('midiOutput2Id')
      this.midiStore.setMidiOutput2(this.outputs.find(o => o.id === this.selectedOutput2Id) || null)
    },
    // toggling the 2nd output off clears it (so it can't stay active while hidden)
    onSecondToggle() {
      if (!this.showSecondOutput && this.selectedOutput2Id) {
        this.selectedOutput2Id = null
        this.onOutput2Change()
      }
    },
    onLanguageChange() {
      localStorage.setItem('locale', this.$i18n.locale)
    },
    signOut() {
      this.authStore.logout()
    },
    toggleSidebar() {
      this.sidebarCompact = !this.sidebarCompact
      localStorage.setItem('sidebarCompact', this.sidebarCompact ? '1' : '0')
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
    // Serial mode persisted → silently reopen a previously-authorized port (no prompt).
    if (this.output1Mode === 'serial' && this.serialSupported) {
      navigator.serial.getPorts()
        .then(ports => { if (ports[0]) this.openSerial(ports[0]).catch(() => {}) })
        .catch(() => {})
    }
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

<style scoped>
.sidebar-auth {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.7rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.08));
  font-size: 0.72rem;
  color: var(--text-mute);
}
.sidebar-auth__who {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  flex: 1;
}
.sidebar-auth__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-auth__out {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  color: var(--text-mute);
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  border-radius: 4px;
}
.sidebar-auth__out:hover {
  color: var(--volt, #ffd24d);
  background: var(--line-005, rgba(255, 255, 255, 0.04));
}
</style>
