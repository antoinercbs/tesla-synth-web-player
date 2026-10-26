<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Output } from 'webmidi';
import logoSrc from '@/ui/images/logo_tesla_player.svg';
import labelSrc from '@/ui/images/label_high_black.svg';
import { useMidiStore } from '@/app/stores/midi';
import { useAuthStore } from '@/app/stores/auth';
import { useScenesStore } from '@/app/stores/scenes';
import type { DeviceId } from '@/model/devices/types';
import type { SynthModel } from '@/engine/audio/synth';
import { coilColor, UNPLUGGED_COLOR } from '@/ui/helpers/coil-colors';
import { ICONS } from '@/ui/helpers/icons';
import { startTour } from '@/ui/tour/tour';
import { mobileLayout } from '@/ui/helpers/viewport';
import { useClearLatch } from '@/ui/helpers/use-clear-latch';
import { beginner, uiMode } from '@/ui/helpers/ui-mode';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import TagsModal from '@/ui/components/settings/TagsModal.vue';
import ServerConfigModal from '@/ui/components/desktop/ServerConfigModal.vue';
import SyncModal from '@/ui/components/desktop/SyncModal.vue';
import DownloadModal from '@/ui/components/desktop/DownloadModal.vue';
import BackupModal from '@/ui/components/settings/BackupModal.vue';
import LocalePicker from '@/ui/components/settings/LocalePicker.vue';
import ThemePicker from '@/ui/components/settings/ThemePicker.vue';
import SkinPicker from '@/ui/components/settings/SkinPicker.vue';
import UiModePicker from '@/ui/components/settings/UiModePicker.vue';
import FiberIcon from '@/ui/components/coils/FiberIcon.vue';
import { useOutputPicker } from './use-output-picker';
import { useSidebarMenus } from './use-sidebar-menus';
import { useSidebarData } from './use-sidebar-data';

/**
 * The application sidebar: brand, navigation, the collapse/compact toggle, MIDI
 * output selection (incl. the built-in synth + WebMIDI device resolution), the
 * coil legend (which opens the coils' settings), and a footer (account, the server when
 * it doesn't answer, a menu holding the language, look, tags, desktop sync/server, download, the
 * tour and the project's pages). Owns the WebMIDI lifecycle + output resolution (it IS the
 * output picker: useOutputPicker) and the connection ping. app/App.vue stays a thin shell.
 */
const midiStore = useMidiStore();
const authStore = useAuthStore();
const scenesStore = useScenesStore();
const router = useRouter();
const route = useRoute();
const { asking: latchAsking, busy: latchBusy, ask: askClear, cancel: cancelClear, confirm: confirmClear } = useClearLatch();

const aside = ref<HTMLElement | null>(null);
const moreBtn = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const outMenuEl = ref<HTMLElement | null>(null);

// narrow icon-rail sidebar (persisted); nav stays, the verbose cards collapse
const sidebarCompact = ref(localStorage.getItem('sidebarCompact') === '1');
function toggleSidebar(): void {
  sidebarCompact.value = !sidebarCompact.value;
  localStorage.setItem('sidebarCompact', sidebarCompact.value ? '1' : '0');
}

const picker = useOutputPicker();
const {
  profiles, synthModels, synthModel, serialSupported, outputs, boardOutputs, interfaceOutputs, selectedOutputId, selectedOutput2Id,
  coilsOn, boardChoiceAt, output1Icon, coilsOut, speakersOut, outRows, boardBlock, output2Offset, offsetLabel, setSynthModel,
} = picker;
const {
  offline, isElectron, serverConfigured, tagsOpen, serverOpen, syncOpen, backupOpen, downloadOpen,
  saveTags, onServerSaved, onSyncApplied, onRestored,
} = useSidebarData();
const { menuOpen, menuStyle, outMenu, outMenuStyle, toggleMenu, toggleOutMenu, closeOutMenu, onOutMenuKey } = useSidebarMenus({ aside, moreBtn, menu, outMenuEl }, sidebarCompact);

// the coils by fibre output, the unplugged after them in the list's order
const sidebarCoils = computed(() => {
  const out = (uuid: string): number => { const o = midiStore.outputOf(uuid); return o < 0 ? Infinity : o; };
  return [...midiStore.coilList].sort((a, b) => out(a.uuid) - out(b.uuid));
});
function fiberColor(uuid: string): string {
  const o = midiStore.outputOf(uuid);
  return o >= 0 ? coilColor(o) : UNPLUGGED_COLOR;
}
// quoted: Vite inlines this small SVG as a data URI whose ' and ( are
// illegal in an unquoted url(), which silently drops the whole declaration
const emblemStyle = { '--emblem-src': `url("${logoSrc}")` };
const isMobile = computed(() => mobileLayout.value);
// on a phone the Débutant pill has no room: the menu's tab, which it opens, takes its look
const levelTab = computed(() => beginner.value && isMobile.value);
// the coil list is a section of the full sidebar only
const coilsInMenu = computed(() => sidebarCompact.value || isMobile.value);
const showUser = computed(() => authStore.enabled && authStore.authenticated);
const userInitials = computed(() => {
  const words = (authStore.displayName || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
});

// --- the outputs' menus: a pick closes the menu, back on its row ---
function pickSynth(): void {
  closeOutMenu(true);
  picker.pickSynth();
}
function pickMidi(dev: Output): void {
  closeOutMenu(true);
  picker.pickMidi(dev);
}
function pickSpeakers(dev: Output | null): void {
  closeOutMenu(true);
  picker.pickSpeakers(dev);
}
function connectSerial(): void {
  closeOutMenu(true);
  void picker.connectSerial();
}
function disconnectSerial(): void {
  closeOutMenu(true);
  picker.disconnectSerial();
}
function askClearFromMenu(): void {
  closeOutMenu(true);
  askClear();
}
function seeLimitsFromMenu(): void {
  closeOutMenu(true);
  router.push({ name: 'syntherrupter' });
}

// --- the footer menu ---
const menuModals = { tagsOpen, backupOpen, serverOpen, downloadOpen };
function openFromMenu(modal: keyof typeof menuModals): void {
  menuOpen.value = false;
  menuModals[modal].value = true;
}
// the project's pages (site/views), with the way back to the app
function openAbout(): void {
  menuOpen.value = false;
  router.push({ name: 'site-home', query: { redirect: route.fullPath } });
}
function startTourFromMenu(): void {
  menuOpen.value = false;
  startTour();
}
function signOut(): void {
  menuOpen.value = false;
  authStore.logout();
}
function toExpert(): void {
  uiMode.value = 'expert';
}
const onSynthModel = (e: Event): void => setSynthModel((e.target as HTMLSelectElement).value as SynthModel);
const onBoardId = (e: Event): void => midiStore.setBoardId((e.target as HTMLSelectElement).value as DeviceId);
</script>

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
      <router-link class="nav-item" :to="{ name: 'play' }" :title="sidebarCompact ? $t('nav.play') : undefined">
        <span class="icon"><i class="fas fa-play"></i></span><span class="nav-item__label">{{ $t('nav.play') }}</span>
      </router-link>
      <router-link class="nav-item" :class="{ 'router-link-active': $route.meta.nav === 'edit' }" :to="{ name: 'edit' }"
        :title="sidebarCompact ? $t('nav.edit') : undefined">
        <span class="icon"><i class="fas fa-pencil"></i></span><span class="nav-item__label">{{ $t('nav.edit') }}</span>
      </router-link>
      <router-link class="nav-item" :to="{ name: 'playlists' }" :title="sidebarCompact ? $t('nav.playlists') : undefined">
        <span class="icon"><i class="fas fa-list-ul"></i></span><span class="nav-item__label">{{ $t('nav.playlists')
        }}</span>
      </router-link>
      <!-- --wide: not offered by the phone layout (ui/helpers/viewport.ts); a beginner has the three above (ui/helpers/ui-mode.ts) -->
      <router-link v-if="!beginner" class="nav-item nav-item--wide" :to="{ name: 'envelopes' }"
        :title="sidebarCompact ? $t('nav.envelopes') : undefined">
        <span class="icon"><i class="fas" :class="ICONS.envelope"></i></span><span class="nav-item__label">{{ $t('nav.envelopes')
          }}</span>
      </router-link>
      <!-- content above, hardware below -->
      <span class="nav__sep" aria-hidden="true"></span>
      <router-link v-if="!beginner" class="nav-item nav-item--wide" :to="{ name: 'tune' }" :title="sidebarCompact ? $t('nav.tune') : undefined">
        <span class="icon"><i class="fas" :class="ICONS.tuning"></i></span><span class="nav-item__label">{{ $t('nav.tune')
        }}</span>
      </router-link>
      <!-- device config: only reachable over a link with read-back (serial, or a
           Web MIDI output paired with the device's input, e.g. native USB-MIDI) -->
      <router-link v-if="midiStore.deviceLink" class="nav-item nav-item--wide" :to="{ name: 'syntherrupter' }"
        :title="sidebarCompact ? $t('nav.syntherrupter') : undefined">
        <span class="icon"><i class="fas" :class="ICONS.interrupter"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter')
        }}</span>
      </router-link>
      <span v-else class="nav-item nav-item--wide is-disabled" :title="$t('label.serialNeededForConfig')">
        <span class="icon"><i class="fas" :class="ICONS.interrupter"></i></span><span class="nav-item__label">{{ $t('nav.syntherrupter')
        }}</span>
        <i class="fas fa-plug-circle-xmark nav-item__unplugged"></i>
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
      <h2 class="sidebar-section__title">{{ $t('title.coils') }}<router-link v-if="!beginner" class="sidebar-section__edit"
          :to="{ name: 'coils' }" :title="$t('label.editCoils')" :aria-label="$t('label.editCoils')"><i
            class="fas fa-pen"></i></router-link></h2>
      <!-- a link per coil to its sheet, in the order of the board's fibre outputs (the unplugged last): the rows
           stay siblings for the looks that alternate them -->
      <div class="sidebar-coils" role="list">
        <router-link v-for="coil in sidebarCoils" :key="coil.id" class="sidebar-coil" role="listitem"
          :to="{ name: 'coils', params: { id: String(coil.id) } }" :title="$t('label.openCoil', { name: coil.name })">
          <!-- the fibre output it is on (its cap's colour), else nothing: it doesn't play here -->
          <span class="sidebar-coil__dot" :style="{ '--c': fiberColor(coil.uuid) }"></span>
          <span class="sidebar-coil__out" :class="{ 'is-off': midiStore.outputOf(coil.uuid) < 0 }"
            :title="midiStore.outputOf(coil.uuid) >= 0 ? $t('player.wiring.cap', { n: midiStore.outputOf(coil.uuid), color: $t(`player.wiring.caps.${midiStore.outputOf(coil.uuid) % 6}`) }) : $t('player.wiring.none')"><fiber-icon /><span
              class="sidebar-coil__idx">{{ midiStore.outputOf(coil.uuid) >= 0 ? midiStore.outputOf(coil.uuid) : '–' }}</span></span>
          <span class="sidebar-coil__name">{{ coil.name }}</span>
        </router-link>
        <!-- a server that predates the inventory: the names of the settings -->
        <template v-if="!midiStore.coilList.length">
          <div v-for="n in midiStore.appConfig.defaultCoilCount" :key="n - 1" class="sidebar-coil" role="listitem">
            <span class="sidebar-coil__dot" :style="{ '--c': coilColor(n - 1) }"></span>
            <span class="sidebar-coil__idx">{{ n - 1 }}</span>
            <span class="sidebar-coil__name" :class="{ 'is-empty': !midiStore.coilName(n - 1) }">
              {{ midiStore.coilName(n - 1) || $t('label.unnamedCoil') }}
            </span>
          </div>
        </template>
      </div>
      <!-- the scenes they are posed in: how many, their tab -->
      <router-link v-if="!beginner && midiStore.coilList.length" class="sidebar-scene" :to="{ name: 'coilScenes' }" :title="$t('label.scenes')"><span
          class="sidebar-scene__pad"></span><span class="sidebar-coil__out"><i class="fas fa-cubes"></i><span class="sidebar-coil__idx"></span></span><span
          class="sidebar-coil__name">{{ $t('label.scenesN', scenesStore.list.length) }}</span></router-link>
    </section>

    <!-- Desktop app: Sync only makes sense once a remote server is configured. -->
    <button v-if="isElectron && serverConfigured" class="btn btn--volt sidebar-sync" type="button"
      @click="syncOpen = true">
      <span class="icon"><i class="fas fa-rotate"></i></span>{{ $t('desktop.sync') }}
    </button>

    <!-- Compact rail keeps the essentials visible: selected output(s), and the server when it doesn't answer. -->
    <div v-if="sidebarCompact" class="sidebar-cstatus">
      <span class="cstat" :class="{ 'is-synth': midiStore.isSynthOutput || midiStore.isSerialOutput, 'is-warn': coilsOut.state === 'warn', 'is-alarm': coilsOut.state === 'alarm' }"
        :title="`${$t('output.coils')} · ${coilsOut.name}`">
        <i class="fas" :class="output1Icon"></i>
      </span>
      <span v-if="selectedOutput2Id" class="cstat cstat--spk" :class="{ 'is-warn': speakersOut.state === 'warn' }"
        :title="`${$t('output.speakers')} · ${speakersOut.name}`">
        <i class="fas" :class="ICONS.speakers"></i>
      </span>
      <span v-if="!isElectron && offline" class="cstat-conn" :title="$t('label.offline')">
        <span class="conn__dot"></span>
      </span>
    </div>

    <!-- One footer row: who is signed in, "offline" when the server doesn't answer, and a
         menu for the rarely used settings. Never offline on desktop (the backend is local). -->
    <footer class="sidebar-foot">
      <div v-if="showUser" class="sidebar-user" :title="authStore.displayName">
        <span class="sidebar-user__avatar" aria-hidden="true">
          <template v-if="userInitials">{{ userInitials }}</template><i v-else class="fas fa-user"></i>
        </span>
        <span class="sidebar-user__name">{{ authStore.displayName || $t('auth.signedIn') }}</span>
      </div>
      <span v-if="!isElectron && offline" class="sidebar-conn">{{ $t('label.offline') }}</span>
      <!-- Débutant: says why things are missing and leaves it; on a phone the menu's tab
           says it instead -->
      <button v-if="beginner && !isMobile" class="sidebar-level" type="button" :title="$t('uiMode.badgeHint')"
        @click="toExpert">
        <i class="fas fa-seedling"></i><span class="sidebar-level__text">{{ $t('uiMode.beginner') }}</span>
      </button>
      <button ref="moreBtn" class="sidebar-more" :class="{ 'is-open': menuOpen, 'is-beginner': levelTab }" type="button"
        :title="$t('label.moreOptions')" :aria-label="$t('label.moreOptions')" aria-haspopup="menu"
        :aria-expanded="menuOpen" @click="toggleMenu">
        <span class="icon"><i class="fas" :class="levelTab ? 'fa-seedling' : 'fa-ellipsis'"></i></span>
        <!-- the tab's label, in the phone layout's bottom bar -->
        <span class="sidebar-more__label">{{ levelTab ? $t('uiMode.beginner') : $t('nav.more') }}</span>
      </button>
    </footer>
  </aside>

  <!-- Teleported: the sidebar scrolls, so an in-flow popover would be clipped. -->
  <Teleport to="body">
    <div v-if="menuOpen" ref="menu" class="sidebar-menu" :style="menuStyle" role="menu">
      <!-- the phone's way to the arc meter: the Tuning page that offers it isn't in its bar -->
      <template v-if="isMobile">
        <button class="sidebar-menu__item" type="button" role="menuitem" @click="$router.push({ name: 'arc-meter' })">
          <span class="icon"><i class="fas" :class="ICONS.arcMeter"></i></span>{{ $t('tune.meter.title') }}
        </button>
        <div class="sidebar-menu__sep"></div>
      </template>
      <div class="sidebar-menu__row">
        <span>{{ $t('label.language') }}</span>
        <locale-picker />
      </div>
      <div class="sidebar-menu__row">
        <span>{{ $t('skin.title') }}</span>
        <skin-picker />
      </div>
      <div class="sidebar-menu__row" :title="$t('uiMode.hint')">
        <span>{{ $t('uiMode.title') }}</span>
        <ui-mode-picker />
      </div>
      <theme-picker class="sidebar-menu__theme" />
      <div class="sidebar-menu__sep"></div>
      <!-- the coils' own place is their sidebar list: here only when it isn't shown -->
      <button v-if="coilsInMenu" class="sidebar-menu__item" type="button" role="menuitem"
        @click="$router.push({ name: 'coils' })">
        <span class="icon"><i class="fas" :class="ICONS.coil"></i></span>{{ $t('title.coils') }}
      </button>
      <button v-if="!beginner" class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('tagsOpen')">
        <span class="icon"><i class="fas fa-tags"></i></span>{{ $t('label.tags') }}
      </button>
      <button v-if="!beginner" class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('backupOpen')">
        <span class="icon"><i class="fas fa-box-archive"></i></span>{{ $t('backup.title') }}
      </button>
      <button v-if="isElectron" class="sidebar-menu__item" type="button" role="menuitem"
        @click="openFromMenu('serverOpen')">
        <span class="icon"><i class="fas fa-server"></i></span>{{ $t('desktop.serverConfig') }}
      </button>
      <!-- the desktop app doesn't install on a phone -->
      <button v-else-if="!isMobile" class="sidebar-menu__item" type="button" role="menuitem" @click="openFromMenu('downloadOpen')">
        <span class="icon"><i class="fas fa-download"></i></span>{{ $t('desktop.downloadApp') }}
      </button>
      <button class="sidebar-menu__item" type="button" role="menuitem" @click="startTourFromMenu">
        <span class="icon"><i class="fas fa-route"></i></span>{{ $t('tour.start') }}
      </button>
      <button class="sidebar-menu__item" type="button" role="menuitem" @click="openAbout">
        <span class="icon"><i class="fas fa-circle-info"></i></span>{{ $t('nav.about') }}
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
    <div v-if="outMenu" ref="outMenuEl" class="sidebar-menu sidebar-menu--output" :style="outMenuStyle" role="menu"
      :aria-label="outMenu === 'coils' ? $t('output.coils') : $t('output.speakers')" @keydown="onOutMenuKey">
      <template v-if="outMenu === 'coils'">
        <!-- what the board says of itself, when it says something -->
        <div v-if="boardBlock" class="sidebar-board" :class="{ 'is-alarm': boardBlock.alarm }">
          <template v-if="boardBlock.alarm">
            <p class="sidebar-board__title"><i class="fas fa-triangle-exclamation"></i>{{ $t('board.stateLatched') }}</p>
            <p class="sidebar-board__text">{{ boardBlock.coils }}</p>
            <div class="sidebar-board__acts">
              <button class="btn btn--danger" type="button" :disabled="latchBusy" @click="askClearFromMenu">{{
                $t('board.clear') }}</button>
              <button class="btn btn--ghost" type="button" @click="seeLimitsFromMenu">{{ $t('board.seeLimits') }}</button>
            </div>
          </template>
          <template v-else>
            <p class="sidebar-board__title"><i class="fas" :class="ICONS.interrupter"></i>{{ midiStore.deviceProfile.label }}</p>
            <ul class="sidebar-board__lines">
              <li v-for="l in boardBlock.lines" :key="l.text"><span class="sidebar-board__dot" :class="`is-${l.tone}`"></span>{{ l.text }}</li>
            </ul>
          </template>
        </div>
        <button class="sidebar-menu__item" :class="{ 'is-current': coilsOn === 'synth' }" type="button"
          role="menuitemradio" :aria-checked="coilsOn === 'synth'" @click="pickSynth">
          <span class="sidebar-menu__check"><i v-if="coilsOn === 'synth'" class="fas fa-check"></i></span>
          <span class="icon"><i class="fas" :class="ICONS.synth"></i></span>{{ $t('output.synth') }}
        </button>
        <!-- whatever the output: the editor and the envelope audition play on this synth too -->
        <div class="sidebar-menu__row sidebar-menu__row--sub">
          <label for="synth-model">{{ $t('label.synthModel') }}</label>
          <div class="select-field">
            <select id="synth-model" :value="synthModel" :title="$t(`label.synthModelHint.${synthModel}`)"
              @change="onSynthModel">
              <option v-for="m in synthModels" :key="m" :value="m">{{ $t(`label.synthModelName.${m}`) }}</option>
            </select>
          </div>
        </div>
        <!-- the board the synth stands for: per machine, the one a plain interface leads to as well -->
        <div v-if="boardChoiceAt === 'synth'" class="sidebar-menu__row sidebar-menu__row--sub">
          <label for="board-synth">{{ $t('output.board') }}</label>
          <div class="select-field">
            <select id="board-synth" :value="midiStore.boardId" @change="onBoardId">
              <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
          </div>
        </div>
        <template v-if="boardOutputs.length">
          <div class="sidebar-menu__sep"></div>
          <p class="sidebar-menu__group">{{ $t('output.groupBoards') }}</p>
          <button v-for="o in boardOutputs" :key="o.id" class="sidebar-menu__item"
            :class="{ 'is-current': coilsOn === 'midi' && selectedOutputId === o.id }" type="button" role="menuitemradio"
            :aria-checked="coilsOn === 'midi' && selectedOutputId === o.id" @click="pickMidi(o)">
            <span class="sidebar-menu__check"><i v-if="coilsOn === 'midi' && selectedOutputId === o.id"
                class="fas fa-check"></i></span>
            <span class="icon"><i class="fas" :class="ICONS.interrupter"></i></span><span class="sidebar-menu__name">{{ o.name }}</span>
          </button>
        </template>
        <div class="sidebar-menu__sep"></div>
        <p class="sidebar-menu__group">{{ $t('output.groupMidi') }}</p>
        <button v-if="coilsOn === 'missing'" class="sidebar-menu__item is-current" type="button" role="menuitemradio"
          aria-checked="true" disabled>
          <span class="sidebar-menu__check"><i class="fas fa-check"></i></span>
          <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>{{ $t('output.missing', { name: coilsOut.name }) }}
        </button>
        <template v-for="o in interfaceOutputs" :key="o.id">
          <button class="sidebar-menu__item"
            :class="{ 'is-current': coilsOn === 'midi' && selectedOutputId === o.id }" type="button" role="menuitemradio"
            :aria-checked="coilsOn === 'midi' && selectedOutputId === o.id" @click="pickMidi(o)">
            <span class="sidebar-menu__check"><i v-if="coilsOn === 'midi' && selectedOutputId === o.id"
                class="fas fa-check"></i></span>
            <span class="icon"><i class="fas" :class="ICONS.midi"></i></span><span class="sidebar-menu__name">{{ o.name }}</span>
          </button>
          <!-- an interface does not say what it leads to -->
          <template v-if="boardChoiceAt === 'midi' && selectedOutputId === o.id">
            <div class="sidebar-menu__row sidebar-menu__row--sub">
              <label for="board-midi">{{ $t('output.boardFor') }}</label>
              <div class="select-field">
                <select id="board-midi" :value="midiStore.boardId" @change="onBoardId">
                  <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
              </div>
            </div>
            <p class="sidebar-menu__note">{{ $t('output.noReadBack') }}</p>
          </template>
        </template>
        <p v-if="!interfaceOutputs.length" class="sidebar-menu__note">{{ $t('output.noInterface') }}</p>
        <div class="sidebar-menu__sep"></div>
        <p class="sidebar-menu__group">{{ $t('output.groupSerial') }}</p>
        <template v-if="midiStore.serialConnected">
          <button class="sidebar-menu__item is-current" type="button" role="menuitemradio" aria-checked="true"
            @click="closeOutMenu(true)">
            <span class="sidebar-menu__check"><i class="fas fa-check"></i></span>
            <span class="icon"><i class="fas" :class="ICONS.serial"></i></span><span class="sidebar-menu__name">{{
              midiStore.serialPortLabel }}</span>
          </button>
          <div v-if="boardChoiceAt === 'serial'" class="sidebar-menu__row sidebar-menu__row--sub">
            <label for="board-serial">{{ $t('output.boardFor') }}</label>
            <div class="select-field">
              <select id="board-serial" :value="midiStore.boardId" @change="onBoardId">
                <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
            </div>
          </div>
          <button class="sidebar-menu__item" type="button" role="menuitem" @click="disconnectSerial">
            <span class="sidebar-menu__check"></span>
            <span class="icon"><i class="fas fa-plug-circle-xmark"></i></span>{{ $t('output.disconnect') }}
          </button>
        </template>
        <template v-else>
          <button class="sidebar-menu__item" :class="{ 'is-current': coilsOn === 'serial' }" type="button"
            role="menuitem" :disabled="!serialSupported" @click="connectSerial">
            <span class="sidebar-menu__check"><i v-if="coilsOn === 'serial'" class="fas fa-check"></i></span>
            <span class="icon"><i class="fas" :class="ICONS.serial"></i></span>{{ $t('output.connect') }}
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
          <span class="icon"><i class="fas" :class="ICONS.midi"></i></span><span class="sidebar-menu__name">{{ o.name }}</span>
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
  <tags-modal :open="tagsOpen" :tags="midiStore.tagList" @save="saveTags" @close="tagsOpen = false" />
  <server-config-modal v-if="isElectron" :open="serverOpen" @close="serverOpen = false" @saved="onServerSaved" />
  <sync-modal v-if="isElectron" :open="syncOpen" @close="syncOpen = false" @applied="onSyncApplied" />
  <download-modal v-if="!isElectron" :open="downloadOpen" @close="downloadOpen = false" />
  <backup-modal :open="backupOpen" @close="backupOpen = false" @restored="onRestored" />
  <confirm-modal :open="latchAsking" :title="$t('board.clearTitle')" :message="$t('board.clearMsg')"
    :confirm-label="$t('board.clearConfirm')" :cancel-label="$t('label.cancel')" @confirm="confirmClear"
    @close="cancelClear" />
</template>
