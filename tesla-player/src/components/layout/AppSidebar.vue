<template>
  <aside ref="aside" class="sidebar" :class="{ 'sidebar--compact': sidebarCompact }">
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
      <router-link class="nav-item" :class="{ 'router-link-active': $route.meta.nav === 'midi' }" :to="{ name: 'midi' }"
        :title="sidebarCompact ? $t('nav.midi') : null">
        <span class="icon"><i class="fas fa-folder-open"></i></span>
        <span class="nav-item__label nav-item__label--long">{{ $t('nav.midi') }}</span>
        <span class="nav-item__label nav-item__label--short">{{ $t('nav.midiShort') }}</span>
      </router-link>
      <!-- --wide: not offered by the phone layout (ui/viewport.ts) -->
      <router-link class="nav-item nav-item--wide" :to="{ name: 'envelopes' }"
        :title="sidebarCompact ? $t('nav.envelopes') : null">
        <span class="icon"><i class="fas fa-chart-line"></i></span><span class="nav-item__label">{{ $t('nav.envelopes')
          }}</span>
      </router-link>
      <!-- content above, hardware below -->
      <span class="nav__sep" aria-hidden="true"></span>
      <router-link class="nav-item nav-item--wide" :to="{ name: 'tune' }" :title="sidebarCompact ? $t('nav.tune') : null">
        <span class="icon"><i class="fas fa-bullseye"></i></span><span class="nav-item__label">{{ $t('nav.tune')
        }}</span>
      </router-link>
      <!-- device config: only reachable over a link with read-back (serial, or a
           Web MIDI output paired with the device's input, e.g. native USB-MIDI) -->
      <router-link v-if="midiStore.deviceLink" class="nav-item nav-item--wide" :to="{ name: 'syntherrupter' }"
        :title="sidebarCompact ? $t('nav.syntherrupter') : null">
        <span class="icon"><i class="fas fa-sliders"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter')
        }}</span>
      </router-link>
      <span v-else class="nav-item nav-item--wide is-disabled" :title="$t('label.serialNeededForConfig')">
        <span class="icon"><i class="fas fa-sliders"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter')
        }}</span>
        <i class="fas fa-lock nav-item__lock"></i>
      </span>
    </nav>

    <div class="sidebar__spacer"></div>

    <section class="sidebar-section">
      <h2 class="sidebar-section__title">{{ $t('title.output') }}</h2>
      <!-- what plays, not what was chosen: a missing device shows as such, the synth standing in -->
      <button v-for="row in outRows" :key="row.id" class="sidebar-out" type="button"
        :class="[`sidebar-out--${row.id}`, `is-${row.state}`, { 'is-open': outMenu === row.id }]" aria-haspopup="menu"
        :aria-expanded="outMenu === row.id" @click="toggleOutMenu(row.id, $event)">
        <span class="sidebar-out__icon"><i class="fas" :class="row.icon"></i></span>
        <span class="sidebar-out__text">
          <span class="sidebar-out__key">{{ row.label }}</span>
          <span class="sidebar-out__value">{{ row.name }}</span>
          <span v-if="row.sub" class="sidebar-out__sub">{{ row.sub }}</span>
        </span>
        <span class="sidebar-out__dot" aria-hidden="true"></span>
        <i class="fas fa-chevron-right sidebar-out__chev" aria-hidden="true"></i>
      </button>
    </section>

    <section class="sidebar-section sidebar-section--coils">
      <!-- in the title: it follows the title wherever a look puts it -->
      <h2 class="sidebar-section__title">{{ $t('title.coils') }}<button class="sidebar-section__edit" type="button"
          :title="$t('label.editCoils')" :aria-label="$t('label.editCoils')" @click="coilsOpen = true"><i
            class="fas fa-pen"></i></button></h2>
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
      <span class="cstat" :class="{ 'is-synth': midiStore.isSynthOutput || midiStore.isSerialOutput, 'is-warn': coilsOut.state === 'warn' }"
        :title="`${$t('output.coils')} · ${coilsOut.name}`">
        <i class="fas" :class="output1Icon"></i>
      </span>
      <span v-if="selectedOutput2Id" class="cstat cstat--spk" :class="{ 'is-warn': speakersOut.state === 'warn' }"
        :title="`${$t('output.speakers')} · ${speakersOut.name}`">
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
        <span class="icon"><i class="fas fa-ellipsis"></i></span>
        <!-- the tab's label, in the phone layout's bottom bar -->
        <span class="sidebar-more__label">{{ $t('nav.more') }}</span>
      </button>
    </footer>
  </aside>

  <!-- Teleported: the sidebar scrolls, so an in-flow popover would be clipped. -->
  <Teleport to="body">
    <div v-if="menuOpen" ref="menu" class="sidebar-menu" :style="menuStyle" role="menu">
      <div class="sidebar-menu__row">
        <span>{{ $t('label.language') }}</span>
        <locale-picker />
      </div>
      <div class="sidebar-menu__row">
        <span>{{ $t('skin.title') }}</span>
        <skin-picker />
      </div>
      <theme-picker class="sidebar-menu__theme" />
      <div class="sidebar-menu__sep"></div>
      <!-- the coils' own place is their sidebar list: here only when it isn't shown -->
      <button v-if="coilsInMenu" class="sidebar-menu__item" type="button" role="menuitem"
        @click="openFromMenu('coilsOpen')">
        <span class="icon"><i class="fas fa-bolt"></i></span>{{ $t('title.coils') }}
      </button>
      <button class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('tagsOpen')">
        <span class="icon"><i class="fas fa-tags"></i></span>{{ $t('label.tags') }}
      </button>
      <button v-if="isElectron" class="sidebar-menu__item" type="button" role="menuitem"
        @click="openFromMenu('serverOpen')">
        <span class="icon"><i class="fas fa-server"></i></span>{{ $t('desktop.serverConfig') }}
      </button>
      <button v-else class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('downloadOpen')">
        <span class="icon"><i class="fas fa-download"></i></span>{{ $t('desktop.downloadApp') }}
      </button>
      <button class="sidebar-menu__item" type="button" role="menuitem" @click="startTourFromMenu">
        <span class="icon"><i class="fas fa-route"></i></span>{{ $t('tour.start') }}
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

  <!-- An output's menu, beside the sidebar: the footer menu's classes, so every look dresses it. -->
  <Teleport to="body">
    <div v-if="outMenu" ref="outMenu" class="sidebar-menu sidebar-menu--output" :style="outMenuStyle" role="menu"
      :aria-label="outMenu === 'coils' ? $t('output.coils') : $t('output.speakers')" @keydown="onOutMenuKey">
      <template v-if="outMenu === 'coils'">
        <p class="sidebar-menu__group">{{ $t('output.groupEmulation') }}</p>
        <button class="sidebar-menu__item" :class="{ 'is-current': coilsOn === 'synth' }" type="button"
          role="menuitemradio" :aria-checked="coilsOn === 'synth'" @click="pickSynth">
          <span class="sidebar-menu__check"><i v-if="coilsOn === 'synth'" class="fas fa-check"></i></span>
          <span class="icon"><i class="fas fa-wave-square"></i></span>{{ $t('output.synth') }}
        </button>
        <!-- whatever the output: the editor and the envelope audition play on this synth too -->
        <div class="sidebar-menu__row sidebar-menu__row--sub">
          <label for="synth-model">{{ $t('label.synthModel') }}</label>
          <div class="select-field">
            <select id="synth-model" :value="synthModel" :title="$t(`label.synthModelHint.${synthModel}`)"
              @change="setSynthModel($event.target.value)">
              <option v-for="m in synthModels" :key="m" :value="m">{{ $t(`label.synthModelName.${m}`) }}</option>
            </select>
          </div>
        </div>
        <div class="sidebar-menu__sep"></div>
        <p class="sidebar-menu__group">{{ $t('output.groupMidi') }}</p>
        <button v-if="coilsOn === 'missing'" class="sidebar-menu__item is-current" type="button" role="menuitemradio"
          aria-checked="true" disabled>
          <span class="sidebar-menu__check"><i class="fas fa-check"></i></span>
          <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>{{ $t('output.missing', { name: coilsOut.name }) }}
        </button>
        <button v-for="o in outputs" :key="o.id" class="sidebar-menu__item"
          :class="{ 'is-current': coilsOn === 'midi' && selectedOutputId === o.id }" type="button" role="menuitemradio"
          :aria-checked="coilsOn === 'midi' && selectedOutputId === o.id" @click="pickMidi(o)">
          <span class="sidebar-menu__check"><i v-if="coilsOn === 'midi' && selectedOutputId === o.id"
              class="fas fa-check"></i></span>
          <span class="icon"><i class="fas fa-plug"></i></span><span class="sidebar-menu__name">{{ o.name }}</span>
        </button>
        <p v-if="!outputs.length" class="sidebar-menu__note">{{ $t('output.noInterface') }}</p>
        <div class="sidebar-menu__sep"></div>
        <p class="sidebar-menu__group">{{ $t('output.groupSerial') }}</p>
        <template v-if="midiStore.serialConnected">
          <button class="sidebar-menu__item is-current" type="button" role="menuitemradio" aria-checked="true"
            @click="closeOutMenu(true)">
            <span class="sidebar-menu__check"><i class="fas fa-check"></i></span>
            <span class="icon"><i class="fas fa-bolt"></i></span><span class="sidebar-menu__name">{{
              midiStore.serialPortLabel }}</span>
          </button>
          <button class="sidebar-menu__item" type="button" role="menuitem" @click="disconnectSerial">
            <span class="sidebar-menu__check"></span>
            <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>{{ $t('output.disconnect') }}
          </button>
        </template>
        <template v-else>
          <button class="sidebar-menu__item" :class="{ 'is-current': coilsOn === 'serial' }" type="button"
            role="menuitem" :disabled="!serialSupported" @click="connectSerial">
            <span class="sidebar-menu__check"><i v-if="coilsOn === 'serial'" class="fas fa-check"></i></span>
            <span class="icon"><i class="fas fa-plug"></i></span>{{ $t('output.connect') }}
          </button>
          <p v-if="!serialSupported" class="sidebar-menu__note">{{ $t('label.serialUnsupported') }}</p>
        </template>
      </template>

      <template v-else>
        <button class="sidebar-menu__item" :class="{ 'is-current': !selectedOutput2Id }" type="button"
          role="menuitemradio" :aria-checked="!selectedOutput2Id" @click="pickSpeakers(null)">
          <span class="sidebar-menu__check"><i v-if="!selectedOutput2Id" class="fas fa-check"></i></span>
          <span class="icon"><i class="fas fa-volume-xmark"></i></span>{{ $t('output.none') }}
        </button>
        <div class="sidebar-menu__sep"></div>
        <p class="sidebar-menu__group">{{ $t('output.groupMidi') }}</p>
        <button v-if="speakersOut.state === 'warn'" class="sidebar-menu__item is-current" type="button"
          role="menuitemradio" aria-checked="true" disabled>
          <span class="sidebar-menu__check"><i class="fas fa-check"></i></span>
          <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>{{ $t('output.missing', { name: speakersOut.name }) }}
        </button>
        <button v-for="o in outputs" :key="o.id" class="sidebar-menu__item"
          :class="{ 'is-current': selectedOutput2Id === o.id }" type="button" role="menuitemradio"
          :aria-checked="selectedOutput2Id === o.id" @click="pickSpeakers(o)">
          <span class="sidebar-menu__check"><i v-if="selectedOutput2Id === o.id" class="fas fa-check"></i></span>
          <span class="icon"><i class="fas fa-plug"></i></span><span class="sidebar-menu__name">{{ o.name }}</span>
        </button>
        <p v-if="!outputs.length" class="sidebar-menu__note">{{ $t('output.noInterface') }}</p>
        <template v-if="selectedOutput2Id">
          <div class="sidebar-menu__sep"></div>
          <!-- hardware calibration: interfaces answer with different delays -->
          <label class="sidebar-menu__group" for="out2-offset">{{ $t('output.offset') }}</label>
          <div class="sidebar-menu__sub sidebar-offset" :title="$t('label.output2OffsetHint')">
            <input id="out2-offset" class="sidebar-offset__range" type="range" min="-200" max="200" step="5"
              v-model.number="output2Offset">
            <span class="sidebar-offset__val">{{ offsetLabel }}</span>
          </div>
        </template>
      </template>
    </div>
  </Teleport>

  <!-- sidebar action modals (coils, tags / desktop sync+server / download) -->
  <coils-modal :open="coilsOpen" :config="midiStore.appConfig" @save="saveCoils" @close="coilsOpen = false" />
  <tags-modal :open="tagsOpen" :tags="midiStore.tagList" @save="saveTags" @close="tagsOpen = false" />
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
import { startTour } from '@/tour/tour'
import { notify } from '@/utils/toast'
import { mobileLayout } from '@/ui/viewport'
import { getTeslaSynth, SYNTH_MODELS, SYNTH_OUTPUT_ID } from '@/audio/tesla-synth'
import { SERIAL_OUTPUT_ID, SerialMidiOutput } from '@/serial/serial-midi'
import { WebMidiLink } from '@/serial/webmidi-link'
import CoilsModal from '@/components/settings/CoilsModal.vue'
import TagsModal from '@/components/settings/TagsModal.vue'
import ServerConfigModal from '@/components/desktop/ServerConfigModal.vue'
import SyncModal from '@/components/desktop/SyncModal.vue'
import DownloadModal from '@/components/desktop/DownloadModal.vue'
import CreditsModal from '@/components/layout/CreditsModal.vue'
import LocalePicker from '@/components/settings/LocalePicker.vue'
import ThemePicker from '@/components/settings/ThemePicker.vue'
import SkinPicker from '@/components/settings/SkinPicker.vue'

/**
 * The application sidebar: brand, navigation, the collapse/compact toggle, MIDI
 * output selection (incl. the built-in synth + WebMIDI device resolution), the
 * coil legend (which opens the coils' settings), and a footer (account / connection
 * status + a menu holding the language, look, tags, desktop sync/server, download and
 * credits actions). Owns the WebMIDI lifecycle + output resolution (it IS the
 * output picker) and the connection ping. App.vue stays a thin shell.
 */
export default {
  name: 'AppSidebar',
  components: {
    CoilsModal, TagsModal, ServerConfigModal, SyncModal, DownloadModal, CreditsModal, LocalePicker, ThemePicker, SkinPicker,
  },
  data() {
    return {
      labelSrc,
      // output-1 transport mode: 'synth' | 'midi' | 'serial' (persisted). Defaults
      // from the legacy persisted device id (synth vs a real MIDI output).
      output1Mode: localStorage.getItem('output1Mode')
        || ((localStorage.getItem('midiOutput1Id') || SYNTH_OUTPUT_ID) === SYNTH_OUTPUT_ID ? 'synth' : 'midi'),
      // built-in synth timbre (persisted); an unknown stored value falls back to the coil
      synthModels: SYNTH_MODELS,
      synthModel: SYNTH_MODELS.includes(localStorage.getItem('synthModel'))
        ? localStorage.getItem('synthModel') : 'tesla',
      // the persisted serial port is being reopened: no "disconnected" before it's tried
      serialRestoring: localStorage.getItem('output1Mode') === 'serial' && 'serial' in navigator,
      isConnected: false,
      pingTimer: null,
      coilsOpen: false,
      tagsOpen: false,
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
      // names of the devices picked, to say which one is unplugged
      savedOutput1Name: localStorage.getItem('midiOutput1Name') || '',
      savedOutput2Name: localStorage.getItem('midiOutput2Name') || '',
      outMenu: null, // 'coils' | 'speakers': the output whose menu is open
      outMenuStyle: {},
      // narrow icon-rail sidebar (persisted); nav stays, the verbose cards collapse
      sidebarCompact: localStorage.getItem('sidebarCompact') === '1',
      creditsOpen: false,
      menuOpen: false,
      menuStyle: {},
      menuWidth: 0
    }
  },
  computed: {
    ...mapStores(useMidiStore, useAuthStore),
    // quoted: Vite inlines this small SVG as a data URI whose ' and ( are
    // illegal in an unquoted url(), which silently drops the whole declaration
    emblemStyle() {
      return { '--emblem-src': `url("${logoSrc}")` }
    },
    outputs() {
      return this.midiStore.midiOutputList || []
    },
    // false while output 1 is still the synth fallback (no device picked yet)
    selectedOutputListed() {
      return this.outputs.some(o => o.id === this.selectedOutputId)
    },
    // the coil list is a section of the full sidebar only
    coilsInMenu() {
      return this.sidebarCompact || mobileLayout.value
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
    // until Web MIDI answers, a device not listed yet isn't a device unplugged
    midiReady() {
      return this.midiStore.midiOutputList !== null
    },
    // the coils' output as it is: 'synth', 'midi', 'serialOn', or chosen but not there:
    // 'missing' (a MIDI interface), 'serial' (no link)
    coilsOn() {
      if (this.output1Mode === 'serial') return this.midiStore.serialConnected ? 'serialOn' : 'serial'
      if (this.output1Mode === 'midi' && this.selectedOutputId !== SYNTH_OUTPUT_ID) {
        return this.selectedOutputListed ? 'midi' : 'missing'
      }
      return 'synth'
    },
    coilsOut() {
      const t = this.$t
      const midiName = this.savedOutput1Name || t('output.midiSub')
      switch (this.coilsOn) {
        case 'serialOn':
          return { icon: 'fa-bolt', name: this.midiStore.serialPortLabel, sub: t('output.serialSub'), state: 'ok' }
        case 'serial':
          return this.serialRestoring
            ? { icon: 'fa-bolt', name: t('output.serialName'), sub: t('output.serialSub'), state: 'idle' }
            : { icon: 'fa-plug-circle-xmark', name: t('output.serialName'), sub: t('output.disconnected'), state: 'warn' }
        case 'midi':
          return {
            icon: 'fa-bolt', name: this.outputs.find(o => o.id === this.selectedOutputId).name,
            sub: t('output.midiSub'), state: 'ok',
          }
        case 'missing':
          return this.midiReady
            ? { icon: 'fa-plug-circle-xmark', name: midiName, sub: t('output.unplugged'), state: 'warn' }
            : { icon: 'fa-bolt', name: midiName, sub: t('output.midiSub'), state: 'idle' }
        default:
          return {
            icon: 'fa-bolt', name: t('output.synth'),
            sub: `${t(`label.synthModelName.${this.synthModel}`)} · ${t('output.synthSub')}`, state: 'emu',
          }
      }
    },
    speakersOut() {
      const t = this.$t
      if (!this.selectedOutput2Id) return { icon: 'fa-volume-high', name: t('output.none'), sub: '', state: 'none' }
      const dev = this.outputs.find(o => o.id === this.selectedOutput2Id)
      if (dev) return { icon: 'fa-volume-high', name: dev.name, sub: this.output2Offset ? this.offsetLabel : '', state: 'ok' }
      const name = this.savedOutput2Name || t('output.midiSub')
      return this.midiReady
        ? { icon: 'fa-plug-circle-xmark', name, sub: t('output.speakersUnplugged'), state: 'warn' }
        : { icon: 'fa-volume-high', name, sub: '', state: 'idle' }
    },
    outRows() {
      return [
        { id: 'coils', label: this.$t('output.coils'), ...this.coilsOut },
        { id: 'speakers', label: this.$t('output.speakers'), ...this.speakersOut },
      ]
    },
    offsetLabel() {
      return `${this.output2Offset > 0 ? '+' : ''}${this.output2Offset} ms`
    },
    // manual 2nd-output timing offset (ms), persisted per-machine in the store
    output2Offset: {
      get() { return this.midiStore.output2OffsetMs },
      set(v) { this.midiStore.setOutput2Offset(Number(v)) }
    }
  },
  watch: {
    menuOpen(open) { this.setMenuListeners(open) },
    outMenu(id, was) { if (!id !== !was) this.setOutMenuListeners(!!id) },
    $route() {
      this.menuOpen = false
      this.outMenu = null
    }
  },
  methods: {
    coilColor,
    // on failure the modal stays open with what was typed
    async saveCoils(config) {
      try {
        const r = await this.axios.put('/api/settings', config)
        this.midiStore.setAppConfig(r.data)
      } catch (err) {
        console.error('Save coils failed', err)
        notify('label.saveFailed', 'error')
        return
      }
      notify('label.settingsSaved')
      this.coilsOpen = false
    },
    async saveTags(tags) {
      try {
        const r = await this.axios.put('/api/tags/sync', tags)
        this.midiStore.setTagList(r.data)
      } catch (err) {
        console.error('Save tags failed', err)
        notify('label.saveFailed', 'error')
        return
      }
      notify('label.settingsSaved')
      this.tagsOpen = false
      // A deleted tag is gone from song_tags too, so the songs in memory
      // still carry stale pills until they are re-read.
      this.axios.get('/api/songs')
        .then(s => { this.midiStore.setMidiSongList(s.data) })
        .catch(err => console.error('Reload songs failed', err))
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
        if (dev) this.rememberName(1, dev.name);
      } else {
        this.midiStore.setMidiOutput(getTeslaSynth());
        this.selectedOutputId = SYNTH_OUTPUT_ID;
        this.setMidiDeviceLink(null);
      }
      const dev2 = this.outputs.find(o => o.id === this.selectedOutput2Id) || null;
      this.midiStore.setMidiOutput2(dev2);
      if (dev2) this.rememberName(2, dev2.name);
    },
    rememberName(n, name) {
      this[`savedOutput${n}Name`] = name
      localStorage.setItem(`midiOutput${n}Name`, name)
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
      const before = this.midiStore.midiOutput
      this.midiStore.setMidiOutputList(WebMidi.outputs)
      this.resolveOutputs()
      const after = this.midiStore.midiOutput
      if (this.output1Mode !== 'midi' || after === before) return
      if (after?.id === SYNTH_OUTPUT_ID && before && before.id !== SYNTH_OUTPUT_ID) this.reportOutputLost(before.name)
      else if (after && after.id !== SYNTH_OUTPUT_ID) this.reportOutputBack(after.name)
    },
    // the synth stands in so that sound never stops, which is exactly what must not go unnoticed
    reportOutputLost(name) {
      this.midiStore.setOutputLost(name)
      notify(this.$t('player.outputLostToast', { name }), 'error')
    },
    reportOutputBack(name) {
      if (!this.midiStore.outputLost) return
      this.midiStore.setOutputLost(null)
      notify(this.$t('player.outputBack', { name }))
    },
    onEnabled() {
      this.midiStore.setMidiOutputList(WebMidi.outputs)
      WebMidi.addListener('connected', this.refreshOutputs)
      WebMidi.addListener('disconnected', this.refreshOutputs)
      this.resolveOutputs() // restore the persisted output selection
    },
    // --- output-1 mode switch + serial (Syntherrupter) link ---
    onMode1Change(mode) {
      localStorage.setItem('output1Mode', mode)
      this.midiStore.setOutputLost(null)
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
    setSynthModel(model) {
      this.synthModel = model
      localStorage.setItem('synthModel', model)
      getTeslaSynth().setModel(model)
    },
    // --- the outputs' menus ---
    pickSynth() {
      this.closeOutMenu(true)
      if (this.coilsOn === 'synth') return
      this.output1Mode = 'synth'
      this.onMode1Change('synth')
    },
    pickMidi(dev) {
      this.closeOutMenu(true)
      this.selectedOutputId = dev.id
      localStorage.setItem('midiOutput1Id', dev.id)
      this.rememberName(1, dev.name)
      this.output1Mode = 'midi'
      this.onMode1Change('midi')
    },
    pickSpeakers(dev) {
      this.closeOutMenu(true)
      this.selectedOutput2Id = dev ? dev.id : null
      if (dev) this.rememberName(2, dev.name)
      this.onOutput2Change()
    },
    // the output becomes the serial link once there is one: a dismissed picker changes nothing
    async connectSerial() {
      this.closeOutMenu(true)
      if (!this.serialSupported) return
      try {
        const port = await navigator.serial.requestPort()
        this.setMidiDeviceLink(null)
        await this.openSerial(port)
      } catch (err) {
        if (err && err.name !== 'NotFoundError') { // NotFoundError = picker dismissed
          notify('label.serialError', 'error')
          console.error('Serial connect failed', err)
        }
        return
      }
      this.output1Mode = 'serial'
      localStorage.setItem('output1Mode', 'serial')
      this.midiStore.setOutputLost(null)
    },
    async openSerial(port) {
      const label = this.portLabel(port)
      const out = await SerialMidiOutput.open(port, label, () => this.onSerialClosed(label))
      this.midiStore.setMidiOutput(markRaw(out))
      this.midiStore.setDeviceLink(out)
      this.midiStore.setSerialConnection(label)
      this.reportOutputBack(label)
    },
    async closeSerial() {
      const out = this.midiStore.midiOutput
      this.midiStore.setSerialConnection(null)
      if (this.midiStore.deviceLink === out) this.midiStore.setDeviceLink(null)
      if (out && out.id === SERIAL_OUTPUT_ID) { try { await out.close() } catch { /* */ } }
    },
    disconnectSerial() {
      this.closeOutMenu(true)
      this.output1Mode = 'synth'
      this.onMode1Change('synth') // closes the link
    },
    onSerialClosed(label) {
      // stream ended (physical unplug or close) — drop the link + fall back
      const wasOpen = this.midiStore.serialConnected
      this.midiStore.setSerialConnection(null)
      if (this.midiStore.deviceLink instanceof SerialMidiOutput) this.midiStore.setDeviceLink(null)
      if (this.output1Mode === 'serial') this.resolveOutputs()
      if (wasOpen && this.output1Mode === 'serial') this.reportOutputLost(label)
    },
    // A port this app was allowed before, plugged back (or the device rebooted, from
    // its config page): reopen it without the picker, as at startup.
    onSerialPortConnect(e) {
      if (this.output1Mode !== 'serial' || this.midiStore.serialConnected || !e.target) return
      this.openSerial(e.target).catch(err => console.error('Serial reconnect failed', err))
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
    startTourFromMenu() {
      this.menuOpen = false
      startTour()
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
      // pinned in viewport coords (the menu is teleported out of the sidebar): above
      // the button when expanded and in the phone's bottom bar, beside the rail when compact
      const r = this.$refs.moreBtn.getBoundingClientRect()
      this.menuStyle = this.sidebarCompact && !mobileLayout.value
        ? { left: `${r.right + 10}px`, bottom: `${window.innerHeight - r.bottom}px` }
        : { right: `${Math.max(8, window.innerWidth - r.right)}px`, bottom: `${window.innerHeight - r.top + 8}px` }
      this.menuWidth = window.innerWidth
      this.outMenu = null
      this.menuOpen = true
    },
    closeMenu() {
      // a phone's toolbars showing and hiding change the height only: the menu stays put
      if (window.innerWidth !== this.menuWidth) {
        this.menuOpen = false
        this.outMenu = null
      }
    },
    // beside the sidebar, level with its button, kept on screen once its height is known
    toggleOutMenu(id, e) {
      if (this.outMenu === id) {
        this.closeOutMenu()
        return
      }
      this.menuOpen = false
      this.outAnchor = e.currentTarget
      const btn = this.outAnchor.getBoundingClientRect()
      const side = this.$refs.aside.getBoundingClientRect()
      this.outMenuStyle = { left: `${side.right + 8}px`, top: `${btn.top}px` }
      this.menuWidth = window.innerWidth
      this.outMenu = id
      this.$nextTick(() => {
        const el = this.$refs.outMenu
        if (!el) return
        const top = Math.max(8, Math.min(btn.top, window.innerHeight - 8 - el.offsetHeight))
        this.outMenuStyle = { ...this.outMenuStyle, top: `${top}px` }
        const items = el.querySelectorAll('.sidebar-menu__item:not(:disabled)')
        ;([...items].find(i => i.classList.contains('is-current')) || items[0])?.focus()
      })
    },
    closeOutMenu(refocus = false) {
      if (!this.outMenu) return
      this.outMenu = null
      if (refocus) this.outAnchor?.focus()
    },
    onOutDocPointer(e) {
      if (this.$refs.outMenu?.contains(e.target) || this.outAnchor?.contains(e.target)) return
      this.closeOutMenu()
    },
    onOutDocKey(e) {
      if (e.key === 'Escape') this.closeOutMenu(true)
    },
    // up and down through the items; the timbre and the offset keep their own arrows
    onOutMenuKey(e) {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.target.closest('.segmented, input')) return
      const items = [...this.$refs.outMenu.querySelectorAll('.sidebar-menu__item:not(:disabled)')]
      if (!items.length) return
      e.preventDefault()
      const i = items.indexOf(document.activeElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
    },
    setOutMenuListeners(on) {
      const fn = on ? 'addEventListener' : 'removeEventListener'
      document[fn]('pointerdown', this.onOutDocPointer, true)
      document[fn]('keydown', this.onOutDocKey)
      window[fn]('resize', this.closeMenu)
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
      this.axios.get('/api/envelopes').then(r => this.midiStore.setEnvelopeList(r.data)).catch(() => { })
      this.midiStore.bumpDataRevision()
    },
    ping() {
      this.axios.get('/api/ping')
        .then(() => { this.isConnected = true })
        .catch(() => { this.isConnected = false })
    }
  },
  mounted() {
    getTeslaSynth().setModel(this.synthModel)
    this.resolveOutputs() // built-in synth available immediately, even before/without WebMIDI
    WebMidi.enable({ sysex: true }).then(this.onEnabled).catch(err => console.error('WebMIDI:', err))
    // Serial mode persisted → silently reopen a previously-authorized port (no prompt).
    if (this.output1Mode === 'serial' && this.serialSupported) {
      navigator.serial.getPorts()
        .then(ports => (ports[0] ? this.openSerial(ports[0]) : undefined))
        .catch(() => { })
        .finally(() => { this.serialRestoring = false })
    }
    if (this.serialSupported) navigator.serial.addEventListener('connect', this.onSerialPortConnect)
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
    this.setOutMenuListeners(false)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.unsubServerConfig) this.unsubServerConfig()
    if (this.serialSupported) navigator.serial.removeEventListener('connect', this.onSerialPortConnect)
    if (WebMidi.enabled) {
      WebMidi.removeListener('connected', this.refreshOutputs)
      WebMidi.removeListener('disconnected', this.refreshOutputs)
    }
  }
}
</script>
