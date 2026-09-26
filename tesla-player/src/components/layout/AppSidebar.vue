<template>
  <aside class="sidebar" :class="{ 'sidebar--compact': sidebarCompact }">
    <div class="brand">
      <router-link class="brand__emblem" :to="{ name: 'play' }" aria-label="Tesla Player" :style="emblemStyle" />
      <span class="brand__sep" aria-hidden="true"></span>
      <div class="brand__text">
        <router-link class="brand__app" :to="{ name: 'play' }">Tesla Player</router-link>
        <a class="brand__club" href="https://clubelek.fr" target="_blank" rel="noopener" title="clubelek.fr">
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
        <span class="icon"><i class="fas fa-list-ul"></i></span><span class="nav-item__label">{{ $t('nav.playlists')
        }}</span>
      </router-link>
      <router-link class="nav-item" :to="{ name: 'midi' }" :title="sidebarCompact ? $t('nav.midi') : null">
        <span class="icon"><i class="fas fa-folder-open"></i></span>
        <span class="nav-item__label nav-item__label--long">{{ $t('nav.midi') }}</span>
        <span class="nav-item__label nav-item__label--short">{{ $t('nav.midiShort') }}</span>
      </router-link>
      <!-- content above, hardware below -->
      <span class="nav__sep" aria-hidden="true"></span>
      <router-link class="nav-item" :to="{ name: 'tune' }" :title="sidebarCompact ? $t('nav.tune') : null">
        <span class="icon"><i class="fas fa-bullseye"></i></span><span class="nav-item__label">{{ $t('nav.tune')
        }}</span>
      </router-link>
      <!-- device config: only reachable over a link with read-back (serial, or a
           Web MIDI output paired with the device's input, e.g. native USB-MIDI) -->
      <router-link v-if="midiStore.deviceLink" class="nav-item" :to="{ name: 'syntherrupter' }"
        :title="sidebarCompact ? $t('nav.syntherrupter') : null">
        <span class="icon"><i class="fas fa-sliders"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter')
        }}</span>
      </router-link>
      <span v-else class="nav-item is-disabled" :title="$t('label.serialNeededForConfig')">
        <span class="icon"><i class="fas fa-sliders"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter')
        }}</span>
        <i class="fas fa-lock nav-item__lock"></i>
      </span>
    </nav>

    <div class="sidebar__spacer"></div>

    <section class="sidebar-section">
      <h2 class="sidebar-section__title">{{ $t('title.output') }}</h2>
      <!-- output 1 transport: virtual synth · MIDI device · bidirectional serial -->
      <segmented-control v-model="output1Mode" fill class="output-modes" :aria-label="$t('label.firstOutput')"
        @update:model-value="onMode1Change" :options="[
          { value: 'synth', label: $t('label.outSynth') },
          { value: 'midi', label: $t('label.outMidi') },
          {
            value: 'serial', label: $t('label.outSerial'), disabled: !serialSupported,
            title: serialSupported ? '' : $t('label.serialUnsupported')
          },
        ]" />

      <p v-if="output1Mode === 'synth'" class="sidebar-hint">
        <i class="fas fa-wave-square"></i>{{ $t('label.emulationHint') }}
      </p>

      <div v-else-if="output1Mode === 'midi'" class="select-field sidebar-select">
        <select v-if="outputs.length" v-model="selectedOutputId" :aria-label="$t('label.firstOutput')"
          @change="onOutputChange">
          <option v-if="!selectedOutputListed" :value="selectedOutputId" disabled>{{ $t('label.chooseMidiOutput') }}
          </option>
          <option v-for="o in outputs" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <!-- nothing to pick: the empty state lives in the field itself -->
        <select v-else disabled :aria-label="$t('label.firstOutput')">
          <option>{{ $t('label.noMidiOutput') }}</option>
        </select>
      </div>

      <div v-else class="sidebar-serial">
        <template v-if="midiStore.serialConnected">
          <span class="sidebar-serial__on"><span class="conn__dot"></span>{{ midiStore.serialPortLabel }}</span>
          <button class="btn btn--ghost sidebar-serial__btn" type="button" @click="disconnectSerial">
            <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>{{ $t('label.serialDisconnect') }}
          </button>
        </template>
        <template v-else>
          <button class="btn btn--volt sidebar-serial__btn" type="button" :disabled="!serialSupported"
            @click="connectSerial">
            <span class="icon"><i class="fas fa-plug"></i></span>{{ $t('label.serialConnect') }}
          </button>
          <p v-if="!serialSupported" class="sidebar-hint">{{ $t('label.serialUnsupported') }}</p>
          <p v-else-if="serialError" class="sidebar-hint is-error">{{ serialError }}</p>
        </template>
      </div>

      <!-- second output is off by default (compact); the toggle reveals the picker -->
      <div class="sidebar-row">
        <label class="sidebar-row__label" for="out2-toggle">{{ $t('label.secondOutput') }}</label>
        <label class="switch">
          <input id="out2-toggle" type="checkbox" v-model="showSecondOutput" @change="onSecondToggle">
          <span class="switch__track"></span>
        </label>
      </div>
      <template v-if="showSecondOutput">
        <div class="select-field sidebar-select">
          <select v-model="selectedOutput2Id" :aria-label="$t('label.secondOutput')" @change="onOutput2Change">
            <option :value="null">—</option>
            <option v-for="o in outputs" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>
        <!-- manual latency offset to align the 2nd output with the 1st (hardware calibration) -->
        <div v-if="selectedOutput2Id" class="sidebar-offset" :title="$t('label.output2OffsetHint')">
          <div class="sidebar-offset__head">
            <label for="out2-offset">{{ $t('label.output2Offset') }}</label>
            <span class="sidebar-offset__val">{{ output2Offset > 0 ? '+' : '' }}{{ output2Offset }} ms</span>
          </div>
          <input id="out2-offset" class="sidebar-offset__range" type="range" min="-200" max="200" step="5"
            v-model.number="output2Offset">
        </div>
      </template>
    </section>

    <section class="sidebar-section">
      <h2 class="sidebar-section__title">{{ $t('title.coils') }}</h2>
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

    <!-- Desktop app: Sync only makes sense once a remote server is configured. -->
    <button v-if="isElectron && serverConfigured" class="btn btn--volt sidebar-sync" type="button"
      @click="syncOpen = true">
      <span class="icon"><i class="fas fa-rotate"></i></span>{{ $t('desktop.sync') }}
    </button>

    <!-- Compact rail keeps the essentials visible: selected output(s) + connection. -->
    <div v-if="sidebarCompact" class="sidebar-cstatus">
      <span class="cstat" :class="{ 'is-synth': midiStore.isSynthOutput || midiStore.isSerialOutput }"
        :title="$t('label.firstOutput') + ' · ' + output1Name">
        <i class="fas" :class="output1Icon"></i>
      </span>
      <span v-if="selectedOutput2Id" class="cstat cstat--spk" :title="$t('label.secondOutput') + ' · ' + output2Name">
        <i class="fas fa-volume-high"></i>
      </span>
      <span v-if="!isElectron" class="cstat-conn" :class="{ 'is-up': isConnected }" :title="connLabel">
        <span class="conn__dot"></span>
      </span>
    </div>

    <!-- One footer row: who is signed in (or the server status) + a menu for the
         rarely used settings. No online/offline on desktop (the backend is local). -->
    <footer class="sidebar-foot">
      <div v-if="showUser" class="sidebar-user" :title="authStore.displayName">
        <span class="sidebar-user__avatar" aria-hidden="true">
          <template v-if="userInitials">{{ userInitials }}</template><i v-else class="fas fa-user"></i>
        </span>
        <span class="sidebar-user__name">{{ authStore.displayName || $t('auth.signedIn') }}</span>
      </div>
      <span v-if="!isElectron" class="sidebar-conn" :class="{ 'is-up': isConnected }" :title="connLabel">
        <span class="conn__dot"></span><span v-if="!showUser" class="sidebar-conn__text">{{ connLabel }}</span>
      </span>
      <button ref="moreBtn" class="sidebar-more" :class="{ 'is-open': menuOpen }" type="button"
        :title="$t('label.moreOptions')" :aria-label="$t('label.moreOptions')" aria-haspopup="menu"
        :aria-expanded="menuOpen" @click="toggleMenu">
        <i class="fas fa-ellipsis"></i>
      </button>
    </footer>
  </aside>

  <!-- Teleported: the sidebar scrolls, so an in-flow popover would be clipped. -->
  <Teleport to="body">
    <div v-if="menuOpen" ref="menu" class="sidebar-menu" :style="menuStyle" role="menu">
      <div class="sidebar-menu__lang">
        <span>{{ $t('label.language') }}</span>
        <segmented-control :model-value="$i18n.locale" :options="localeOptions" :aria-label="$t('label.language')"
          @update:model-value="setLocale" />
      </div>
      <!-- each swatch carries its theme's data-theme, so it paints with that theme's gradient -->
      <div class="sidebar-menu__theme">
        <span class="sidebar-menu__theme-head">{{ $t('theme.title') }}<b>{{ $t(`theme.${theme}`) }}</b></span>
        <div class="theme-swatches" role="radiogroup" :aria-label="$t('theme.title')">
          <button v-for="id in themes" :key="id" type="button" class="theme-swatch" :class="{ 'is-active': theme === id }"
            :data-theme="id" role="radio" :aria-checked="theme === id" :title="$t(`theme.${id}`)"
            :aria-label="$t(`theme.${id}`)" @click="pickTheme(id)"></button>
        </div>
      </div>
      <div class="sidebar-menu__sep"></div>
      <button class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('configOpen')">
        <span class="icon"><i class="fas fa-gear"></i></span>{{ $t('title.generalConfig') }}
      </button>
      <button v-if="isElectron" class="sidebar-menu__item" type="button" role="menuitem"
        @click="openFromMenu('serverOpen')">
        <span class="icon"><i class="fas fa-server"></i></span>{{ $t('desktop.serverConfig') }}
      </button>
      <button v-else class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('downloadOpen')">
        <span class="icon"><i class="fas fa-download"></i></span>{{ $t('desktop.downloadApp') }}
      </button>
      <button class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('creditsOpen')">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('credits.title') }}
      </button>
      <template v-if="showUser">
        <div class="sidebar-menu__sep"></div>
        <button class="sidebar-menu__item" type="button" role="menuitem" @click="signOut">
          <span class="icon"><i class="fas fa-right-from-bracket"></i></span>{{ $t('auth.signOut') }}
        </button>
      </template>
    </div>
  </Teleport>

  <!-- sidebar action modals (config / desktop sync+server / download) -->
  <general-config-modal :open="configOpen" :config="midiStore.appConfig" @save="saveConfig" @close="configOpen = false"
    :tags="midiStore.tagList" />
  <server-config-modal v-if="isElectron" :open="serverOpen" @close="serverOpen = false" @saved="onServerSaved" />
  <sync-modal v-if="isElectron" :open="syncOpen" @close="syncOpen = false" @applied="onSyncApplied" />
  <download-modal v-if="!isElectron" :open="downloadOpen" @close="downloadOpen = false" />
  <credits-modal :open="creditsOpen" @close="creditsOpen = false" />
</template>

<script>
import { markRaw } from 'vue'
import { mapStores } from 'pinia'
import { WebMidi } from 'webmidi'
import logoSrc from '@/assets/logo_tesla_player.svg'
import labelSrc from '@/assets/label_high_black.svg'
import { useMidiStore } from '@/stores/midi'
import { useAuthStore } from '@/stores/auth'
import { coilColor } from '@/ui/coil-colors'
import { THEMES, setTheme, storedTheme } from '@/ui/themes'
import { notify } from '@/utils/toast'
import { getTeslaSynth, SYNTH_OUTPUT_ID } from '@/audio/tesla-synth'
import { SERIAL_OUTPUT_ID, SerialMidiOutput } from '@/serial/serial-midi'
import { WebMidiLink } from '@/serial/webmidi-link'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import GeneralConfigModal from '@/components/settings/GeneralConfigModal.vue'
import ServerConfigModal from '@/components/desktop/ServerConfigModal.vue'
import SyncModal from '@/components/desktop/SyncModal.vue'
import DownloadModal from '@/components/desktop/DownloadModal.vue'
import CreditsModal from '@/components/layout/CreditsModal.vue'

/**
 * The application sidebar: brand, navigation, the collapse/compact toggle, MIDI
 * output selection (incl. the built-in synth + WebMIDI device resolution), the
 * coil legend, and a footer (account / connection status + a menu holding the
 * language, config, desktop sync/server, download and credits actions). Owns the WebMIDI lifecycle + output resolution (it IS the
 * output picker) and the connection ping. App.vue stays a thin shell.
 */
export default {
  name: 'AppSidebar',
  components: { SegmentedControl, GeneralConfigModal, ServerConfigModal, SyncModal, DownloadModal, CreditsModal },
  data() {
    return {
      labelSrc,
      themes: THEMES,
      theme: storedTheme(),
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
      // Electron: whether a remote server URL is set. Sync is meaningless (and
      // hidden) until one is configured.
      serverConfigured: false,
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
      creditsOpen: false,
      menuOpen: false,
      menuStyle: {}
    }
  },
  computed: {
    ...mapStores(useMidiStore, useAuthStore),
    // quoted: Vite inlines this small SVG as a data URI whose ' and ( are
    // illegal in an unquoted url(), which silently drops the whole declaration
    emblemStyle() {
      return { '--emblem-src': `url("${logoSrc}")` }
    },
    isSynthSelected() { return this.selectedOutputId === SYNTH_OUTPUT_ID },
    outputs() {
      return this.midiStore.midiOutputList || []
    },
    // false while output 1 is still the synth fallback (no device picked yet)
    selectedOutputListed() {
      return this.outputs.some(o => o.id === this.selectedOutputId)
    },
    showUser() {
      return this.authStore.enabled && this.authStore.authenticated
    },
    userInitials() {
      const words = (this.authStore.displayName || '').trim().split(/\s+/).filter(Boolean)
      return words.slice(0, 2).map(w => w[0].toUpperCase()).join('')
    },
    connLabel() {
      return this.isConnected ? this.$t('label.online') : this.$t('label.offline')
    },
    localeOptions() {
      return this.$i18n.availableLocales.map(l => ({ value: l, label: l.toUpperCase() }))
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
  watch: {
    menuOpen(open) { this.setMenuListeners(open) },
    $route() { this.menuOpen = false }
  },
  methods: {
    coilColor,
    saveConfig({ config, tags }) {
      const savedConfig = this.axios.put('/api/settings', config)
        .then(r => { this.midiStore.setAppConfig(r.data) })
        .catch(err => console.error('Save config failed', err))
      const savedTags = this.axios.put('/api/tags/sync', tags)
        .then(r => {
          this.midiStore.setTagList(r.data)
          // A deleted tag is gone from song_tags too, so the songs in memory
          // still carry stale pills until they are re-read.
          return this.axios.get('/api/songs')
            .then(s => { this.midiStore.setMidiSongList(s.data) })
        })
        .catch(err => console.error('Save tags failed', err))
      Promise.all([savedConfig, savedTags]).then(() => {
        notify('label.settingsSaved')
        this.configOpen = false
      })
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
        this.setMidiDeviceLink(dev);
      } else {
        this.midiStore.setMidiOutput(getTeslaSynth());
        this.selectedOutputId = SYNTH_OUTPUT_ID;
        this.setMidiDeviceLink(null);
      }
      this.midiStore.setMidiOutput2(this.outputs.find(o => o.id === this.selectedOutput2Id) || null);
    },
    // Config read-back over Web MIDI: pair the output with the device's input of
    // the same name (e.g. the ESP32 Syntherrupter's native USB-MIDI port). A
    // plain interface without such an input gives no link (config page stays off).
    setMidiDeviceLink(dev) {
      const cur = this.midiStore.deviceLink
      if (cur instanceof WebMidiLink) cur.dispose()
      const link = dev && WebMidi.enabled ? WebMidiLink.pair(dev, WebMidi.inputs) : null
      this.midiStore.setDeviceLink(link ? markRaw(link) : null)
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
      if (mode === 'serial') this.setMidiDeviceLink(null) // the serial link provides it once connected
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
      this.midiStore.setDeviceLink(out)
      this.midiStore.setSerialConnection(label)
    },
    async closeSerial() {
      const out = this.midiStore.midiOutput
      this.midiStore.setSerialConnection(null)
      if (this.midiStore.deviceLink === out) this.midiStore.setDeviceLink(null)
      if (out && out.id === SERIAL_OUTPUT_ID) { try { await out.close() } catch { /* */ } }
    },
    async disconnectSerial() {
      await this.closeSerial()
      this.resolveOutputs() // fall back to the synth
    },
    onSerialClosed() {
      // stream ended (physical unplug or close) — drop the link + fall back
      this.midiStore.setSerialConnection(null)
      if (this.midiStore.deviceLink instanceof SerialMidiOutput) this.midiStore.setDeviceLink(null)
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
    setLocale(locale) {
      this.$i18n.locale = locale
      localStorage.setItem('locale', locale)
    },
    pickTheme(id) {
      this.theme = id
      setTheme(id)
    },
    signOut() {
      this.menuOpen = false
      this.authStore.logout()
    },
    // --- footer menu ---
    toggleMenu() {
      if (this.menuOpen) {
        this.menuOpen = false
        return
      }
      // pinned in viewport coords (the menu is teleported out of the sidebar):
      // above the button when expanded, beside the rail when compact
      const r = this.$refs.moreBtn.getBoundingClientRect()
      this.menuStyle = this.sidebarCompact
        ? { left: `${r.right + 10}px`, bottom: `${window.innerHeight - r.bottom}px` }
        : { right: `${window.innerWidth - r.right}px`, bottom: `${window.innerHeight - r.top + 8}px` }
      this.menuOpen = true
    },
    closeMenu() {
      this.menuOpen = false
    },
    onDocPointer(e) {
      if (this.$refs.menu?.contains(e.target) || this.$refs.moreBtn?.contains(e.target)) return
      this.menuOpen = false
    },
    onMenuKey(e) {
      if (e.key !== 'Escape') return
      this.menuOpen = false
      this.$refs.moreBtn?.focus()
    },
    setMenuListeners(on) {
      const fn = on ? 'addEventListener' : 'removeEventListener'
      document[fn]('pointerdown', this.onDocPointer, true)
      document[fn]('keydown', this.onMenuKey)
      window[fn]('resize', this.closeMenu)
    },
    openFromMenu(modalFlag) {
      this.menuOpen = false
      this[modalFlag] = true
    },
    toggleSidebar() {
      this.sidebarCompact = !this.sidebarCompact
      localStorage.setItem('sidebarCompact', this.sidebarCompact ? '1' : '0')
    },
    // --- Desktop app (Electron-only sync/server) ---
    // Reflect whether a remote server URL is set (drives the Sync button's visibility).
    async refreshServerConfigured() {
      if (!this.isElectron || !window.teslaElectron) return
      try {
        const cfg = await window.teslaElectron.getServerConfig()
        this.serverConfigured = !!(cfg && cfg.url)
      } catch {
        this.serverConfigured = false
      }
    },
    onServerSaved() {
      notify('label.settingsSaved')
      this.refreshServerConfigured() // a URL may have just been added/removed
    },
    onSyncApplied() {
      // A pull may have changed the local DB — refresh the cached lists, and
      // bump the data revision so views that fetch ad-hoc (playlists) re-read.
      this.axios.get('/api/midi').then(r => this.midiStore.setMidiFileList(r.data)).catch(() => { })
      this.axios.get('/api/songs').then(r => this.midiStore.setMidiSongList(r.data)).catch(() => { })
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
        .then(ports => { if (ports[0]) this.openSerial(ports[0]).catch(() => { }) })
        .catch(() => { })
    }
    this.ping()
    this.pingTimer = setInterval(this.ping, 10000)
    // Native menu "Server configuration…" opens the modal.
    if (this.isElectron && window.teslaElectron) {
      this.unsubServerConfig = window.teslaElectron.onOpenServerConfig(() => { this.serverOpen = true })
      this.refreshServerConfigured() // hide Sync until a server URL is set
    }
  },
  beforeUnmount() {
    this.setMenuListeners(false)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.unsubServerConfig) this.unsubServerConfig()
    if (WebMidi.enabled) {
      WebMidi.removeListener('connected', this.refreshOutputs)
      WebMidi.removeListener('disconnected', this.refreshOutputs)
    }
  }
}
</script>
