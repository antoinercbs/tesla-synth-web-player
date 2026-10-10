<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/stores/midi';
import { notify } from '@/utils/toast';
import { coilColor } from '@/ui/coil-colors';
import { buildCommand, buildStringFrames, reassembleString, type DecodedFrame } from '@/sysex/syntherrupter';
import {
  COIL_PARAMS, SYSTEM_PARAMS, UI_PARAMS, SYSTEM_INFO, USER_PARAMS, USER_COUNT, ACTION_PN,
  type SynthParam,
} from '@/sysex/syntherrupter-params';
import type { DeviceLink } from '@/serial/device-link';
import { readTrips } from '@/devices/board-watch';
import { boardState } from '@/sysex/board';
import ParamRow from '@/components/settings/ParamRow.vue';
import ParamCell from '@/components/settings/ParamCell.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import FirmwareUpdateModal from '@/components/settings/FirmwareUpdateModal.vue';
import { listFirmware, newestFor, type FirmwareRelease } from '@/firmware/api';
import { boardVersion, formatVersion, versionNumber } from '@/firmware/version';
import BaseModal from '@/components/ui/BaseModal.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';
import { ICONS } from '@/ui/icons';

/**
 * Syntherrupter hardware config page (needs a link with read-back: Web Serial, or
 * a Web MIDI port whose input carries the device's replies). Reads the static device
 * settings on open — a single-parameter wildcard GET to discover the coils, then
 * targeted per-coil GETs for the rest, one GET for the system range, one per
 * user — then lets the operator edit + Apply per section (with a confirm on
 * safety-critical limits), and offers Save-to-EEPROM / Reload / Reboot. Reachable
 * only while the serial link is up.
 *
 * NB: coil discovery uses a SINGLE-parameter wildcard GET (0x260 on tg=0x7f) —
 * one reply per coil the firmware actually has (its wildcard loop bound is the
 * compile-time COIL_COUNT). We never wildcard a RANGE: that emits
 * nbParams×COIL_COUNT replies through the firmware's blocking spin-write loop
 * (Sysex.cpp) and the device hangs. The remaining coil params are read with
 * targeted per-coil GETs (safe — those coils are confirmed to exist).
 */
const router = useRouter();
const midiStore = useMidiStore();
const { t } = useI18n();

type Val = number | string | boolean;
interface Entry { p: SynthParam; target: number; key: string }

const device = reactive<Record<string, Val>>({}); // last value read from the device
const edited = reactive<Record<string, Val>>({}); // editable copy (display units)
const unread = reactive<Record<string, boolean>>({}); // true = device gave no reply → disable + warn
const coils = ref<number[]>([]);
const loading = ref(false);
const errored = ref(false);
const loadPct = ref(0); // 0..100, drives the progress bar
const loadLabel = ref(''); // subtitle describing the current read step
const confirm = ref<{ title: string; message: string; label?: string; action: () => void } | null>(null);
const info = ref<SynthParam | null>(null);
function showInfo(p: SynthParam): void { info.value = p; }

const link = (): DeviceLink | null => midiStore.deviceLink;
const profile = computed(() => midiStore.deviceProfile);
/** The parameters the board has: the Tiva's touchscreen and accounts, say, are not everywhere. */
const onBoard = (p: SynthParam): boolean => !p.feature || profile.value.features[p.feature];
const coilParams = computed(() => COIL_PARAMS.filter(onBoard));
const userParams = computed(() => USER_PARAMS.filter(onBoard));

const coilKey = (c: number, pn: number): string => `c${c}:${pn}`;
const sysKey = (pn: number): string => `s${pn}`;
const userKey = (u: number, pn: number): string => `u${u}:${pn}`;

const coilEntries = (c: number): Entry[] => coilParams.value.map((p) => ({ p, target: c, key: coilKey(c, p.pn) }));
const sysEntries = computed<Entry[]>(() =>
  [...SYSTEM_PARAMS, ...SYSTEM_INFO].filter(onBoard).map((p) => ({ p, target: 0, key: sysKey(p.pn) })),
);
const uiEntries = computed<Entry[]>(() => UI_PARAMS.filter(onBoard).map((p) => ({ p, target: 0, key: sysKey(p.pn) })));
const userEntries = (u: number): Entry[] => userParams.value.map((p) => ({ p, target: u, key: userKey(u, p.pn) }));
const users = computed(() => (profile.value.features.users ? Array.from({ length: USER_COUNT }, (_, u) => u) : []));

/** What the board says of itself (devices/board-monitor.ts keeps it up to date). */
const boardTiles = computed(() => {
  const s = midiStore.boardStatus;
  if (!s) return [];
  const trips = midiStore.boardTrips.reduce((sum, n) => sum + n, 0);
  const state = boardState(s);
  return [
    {
      key: 'protection', icon: 'fa-shield-halved', tone: s.latched ? 'alarm' : s.monitored ? 'ok' : 'warn',
      title: t('board.protection'),
      value: t(s.latched ? 'board.protectionLatched' : s.monitored ? 'board.protectionOk' : 'board.protectionNone'),
      sub: s.monitored ? t('board.tripsSince', { n: trips }, trips) : t('board.unmonitoredSub'),
    },
    {
      key: 'arming', icon: 'fa-bolt', tone: state === 'stop' || !s.armed ? 'warn' : 'ok',
      title: t('board.arming'),
      value: t(state === 'stop' ? 'board.stop' : s.armed ? 'board.armed' : 'board.disarmed'),
      sub: t(!s.supplySensed ? 'board.supplyUnknown' : s.supplyOn ? 'board.supplyOn' : 'board.supplyOff'),
    },
    {
      key: 'outputs', icon: ICONS.fiber, tone: s.outputError ? 'warn' : 'ok',
      title: t('board.outputsTitle'),
      value: s.outputError ? t('board.outputsError') : t('board.outputsReady', { n: profile.value.coils }),
      sub: t(s.outputError ? 'board.outputsErrorSub' : 'board.noError'),
    },
  ];
});

// the board's thresholds are typical values, each channel measured at bring-up: warn a bit below
const NEAR_LIMIT = 0.9;
function nearLimit(c: number, p: SynthParam): string {
  const hw = profile.value.hardwareLimits;
  const v = Number(edited[coilKey(c, p.pn)]);
  if (!hw || !Number.isFinite(v)) return '';
  if (p.pn === 0x260 && v >= hw.ontimeUs * NEAR_LIMIT) return t('board.nearLimit', { limit: `${hw.ontimeUs} µs` });
  if (p.pn === 0x261 && v >= hw.duty * 100 * NEAR_LIMIT) return t('board.nearLimit', { limit: `${hw.duty * 100} %` });
  return '';
}
const flash = computed(() => profile.value.settingsMemory === 'flash');

/* ------------------------------------------------- firmware update (ESP32) */
const firmwares = ref<FirmwareRelease[]>([]);
const runningVersion = ref<number | null>(null); // 0x204 as read
const firmwareOpen = ref(false);
// what the dialog installs: the board reading its new version must not take it away
const firmwareTarget = ref<FirmwareRelease | null>(null);
const firmwareFrom = ref<number | null>(null);
const updating = ref(false);
const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
/** A newer firmware for this board than the one it runs. */
const update = computed(() => {
  if (!profile.value.features.firmwareUpdate || !serialSupported || runningVersion.value == null) return null;
  const newest = newestFor(profile.value.id, firmwares.value);
  return newest && versionNumber(newest.version) > runningVersion.value ? newest : null;
});
function loadFirmwares(): void {
  if (!profile.value.features.firmwareUpdate) return;
  listFirmware()
    .then((list) => { firmwares.value = list; })
    .catch((err) => console.error('Firmware list failed', err));
}
function openUpdate(): void {
  firmwareTarget.value = update.value;
  firmwareFrom.value = runningVersion.value;
  firmwareOpen.value = true;
}
function onUpdated(): void {
  notify('fw.updated');
  void loadAll();
}

function toDisplay(p: SynthParam, f: DecodedFrame): Val {
  if (p.key === 'firmwareVersion') return formatVersion(boardVersion(f.valueInt));
  if (p.kind === 'bool') return f.valueInt !== 0;
  const raw = p.isFloat ? f.valueFloat : f.valueInt;
  return Math.round(raw * (p.displayScale ?? 1) * 1000) / 1000;
}
function seed(key: string, v: Val): void {
  device[key] = v;
  edited[key] = v;
}
/** Seed a number/bool param from its reply frame, or mark it unread (→ disabled
 *  + orange warning) when the device returned no value — rather than showing a
 *  misleading default. */
function seedRead(key: string, p: SynthParam, f: DecodedFrame | undefined): void {
  if (f) {
    unread[key] = false;
    seed(key, toDisplay(p, f));
  } else {
    unread[key] = true;
    delete device[key];
    delete edited[key];
  }
}
function isDirty(e: Entry): boolean {
  return !e.p.readOnly && String(edited[e.key] ?? '') !== String(device[e.key] ?? '');
}
function sectionDirty(entries: Entry[]): boolean {
  return entries.some(isDirty);
}

async function loadAll(): Promise<void> {
  const out = link();
  if (!out) return;
  loading.value = true;
  errored.value = false;
  loadPct.value = 0;
  loadLabel.value = t('sp.loadDiscovering');
  try {
    // Discover the real coil count from the device: a SINGLE-parameter wildcard
    // GET (0x260 on tg=0x7f) yields exactly one reply per coil the firmware has
    // (its wildcard loop bound is the compile-time COIL_COUNT). Never wildcard a
    // RANGE — that emits nbParams×COIL_COUNT replies through the firmware's
    // blocking spin-write and it hangs. Fall back to defaultCoilCount if mute.
    const probe = await out.read(0x260, 0x7f);
    const discovered = [...new Set(probe.filter((f) => f.pnFull === 0x260).map((f) => f.target & 0xff))].sort(
      (a, b) => a - b,
    );
    coils.value = discovered.length
      ? discovered
      : Array.from({ length: midiStore.appConfig.defaultCoilCount }, (_, i) => i);
    // one read per coil + one for system + one per user → drives the progress bar
    const total = coils.value.length + 1 + users.value.length;
    let done = 0;
    const step = (label: string): void => {
      loadLabel.value = label;
      loadPct.value = Math.round((done / total) * 100);
    };
    // 0x260 comes from the probe; read the rest (0x261..0x265) targeted per coil
    // (safe — those coils are confirmed to exist).
    for (const c of coils.value) {
      step(t('sp.loadCoil', { n: c }));
      const rest = await out.read(0x261, c, 0x265);
      for (const p of coilParams.value) {
        const f =
          p.pn === 0x260
            ? probe.find((fr) => fr.pnFull === 0x260 && (fr.target & 0xff) === c)
            : rest.find((fr) => fr.pnFull === p.pn && (fr.target & 0xff) === c);
        seedRead(coilKey(c, p.pn), p, f);
      }
      done++;
    }
    // system settings: one GET over 0x201..0x266
    step(t('sp.loadSystem'));
    const sysFrames = await out.read(0x201, 0, 0x266);
    const version = sysFrames.find((fr) => fr.pnFull === 0x204);
    runningVersion.value = version ? boardVersion(version.valueInt) : null;
    for (const p of [...SYSTEM_PARAMS, ...UI_PARAMS, ...SYSTEM_INFO].filter(onBoard)) {
      seedRead(sysKey(p.pn), p, sysFrames.find((fr) => fr.pnFull === p.pn));
    }
    if (profile.value.features.boardStatus) midiStore.setBoardTrips(await readTrips(out));
    done++;
    // users: one GET per user over 0x240..0x244 (name/password = char-group frames)
    for (const u of users.value) {
      step(t('sp.loadUser', { n: u }));
      const uf = await out.read(0x240, u, 0x244);
      for (const p of userParams.value) {
        if (p.kind === 'string') {
          const groups = uf.filter((fr) => fr.pnFull === p.pn);
          unread[userKey(u, p.pn)] = false; // names/passwords stay editable (empty = unset)
          seed(userKey(u, p.pn), groups.length ? reassembleString(groups) : '');
        } else {
          seedRead(userKey(u, p.pn), p, uf.find((fr) => fr.pnFull === p.pn));
        }
      }
      done++;
    }
    loadPct.value = 100;
  } catch (err) {
    console.error('Syntherrupter read failed', err);
    errored.value = true;
  } finally {
    loading.value = false;
  }
}

/** Clamp a display value to the parameter's documented [min, max] (HTML min/max
 *  don't stop typing, so enforce the rules here before sending). */
function clampDisplay(p: SynthParam, value: number): number {
  let v = Number.isFinite(value) ? value : 0;
  if (p.min !== undefined) v = Math.max(p.min, v);
  if (p.max !== undefined) v = Math.min(p.max, v);
  return v;
}

function writeEntry(out: DeviceLink, e: Entry): void {
  if (unread[e.key]) return; // never write a value we couldn't read back
  const v = edited[e.key];
  if (e.p.kind === 'string') {
    for (const f of buildStringFrames(e.p.pn, e.target, String(v ?? ''))) out.send(f);
  } else if (e.p.kind === 'bool') {
    out.send(buildCommand({ pn: e.p.pn, target: e.target, value: v ? 1 : 0 }));
  } else {
    const display = clampDisplay(e.p, Number(v));
    edited[e.key] = display; // reflect the clamp back into the field
    out.send(buildCommand({
      pn: e.p.pn, target: e.target, value: display / (e.p.displayScale ?? 1), isFloat: !!e.p.isFloat,
    }));
  }
  device[e.key] = edited[e.key]; // optimistic (no device ACK; use Reload to re-confirm)
}

function doApply(entries: Entry[]): void {
  const out = link();
  if (!out) return;
  for (const e of entries) writeEntry(out, e);
  notify('sp.applied');
}

function applySection(entries: Entry[]): void {
  const dirty = entries.filter(isDirty);
  if (!dirty.length) return;
  const critical = dirty.filter((e) => e.p.critical);
  const safety = dirty.filter((e) => e.p.safety);
  if (critical.length) {
    // extremely sensitive (e.g. output polarity) → confirm twice before writing
    const names = critical.map((e) => t('sp.' + e.p.key)).join(', ');
    confirm.value = {
      title: t('sp.criticalTitle'),
      message: t('sp.criticalMsg', { list: names }),
      action: () => {
        confirm.value = {
          title: t('sp.criticalTitle2'),
          message: t('sp.criticalMsg2', { list: names }),
          action: () => doApply(dirty),
        };
      },
    };
  } else if (safety.length) {
    confirm.value = {
      title: t('sp.confirmTitle'),
      message: t('sp.confirmMsg', { list: safety.map((e) => t('sp.' + e.p.key)).join(', ') }),
      action: () => doApply(dirty),
    };
  } else {
    doApply(dirty);
  }
}

// the device saves the values it runs on: an edit not applied yet is not among them
function saveEeprom(): void {
  const pending = [...coils.value.flatMap(coilEntries), ...sysEntries.value, ...uiEntries.value, ...users.value.flatMap(userEntries)]
    .filter(isDirty).length;
  const msg = t(flash.value ? 'sp.flashMsg' : 'sp.eepromMsg');
  confirm.value = {
    title: t(flash.value ? 'sp.flashTitle' : 'sp.eepromTitle'),
    message: pending ? `${msg} ${t('sp.eepromPending', { n: pending }, pending)}` : msg,
    label: t('sp.save'),
    action: () => {
      const out = link();
      if (!out) return;
      out.send(buildCommand({ pn: ACTION_PN.EEPROM_UPDATE, value: 1 }));
      notify(flash.value ? 'sp.savedFlash' : 'sp.savedEeprom');
    },
  };
}
// a board that leaves USB while it reboots: the page waits for it instead of closing
const REBOOT_WAIT_MS = 20000;
const rebooting = ref(false);
let rebootGone = false;
let rebootTimer: ReturnType<typeof setTimeout> | null = null;
function endReboot(): void {
  rebooting.value = false;
  rebootGone = false;
  if (rebootTimer) clearTimeout(rebootTimer);
  rebootTimer = null;
}
function reboot(): void {
  const dropsUsb = profile.value.quirks.rebootDropsUsb;
  confirm.value = {
    title: t('sp.rebootTitle'),
    message: t(dropsUsb ? 'sp.rebootMsgUsb' : 'sp.rebootMsg'),
    label: t('sp.reboot'),
    action: () => {
      link()?.send(buildCommand({ pn: ACTION_PN.RESET, value: ACTION_PN.RESET_MAGIC }));
      if (!dropsUsb) {
        notify('sp.rebooting');
        return;
      }
      rebooting.value = true;
      rebootTimer = setTimeout(() => {
        endReboot();
        notify('sp.rebootLost', 'error');
        if (!midiStore.deviceLink) router.replace({ name: 'play' });
      }, REBOOT_WAIT_MS);
    },
  };
}
function runConfirm(): void {
  const c = confirm.value;
  confirm.value = null;
  c?.action();
}

// losing the link (unplug / reboot / output change) closes the page — there's
// nothing to configure
watch(() => midiStore.deviceLink, (l) => {
  // a firmware update takes the board away, the update dialog waits for it
  if (updating.value) return;
  if (rebooting.value) {
    if (!l) rebootGone = true;
    else if (rebootGone) {
      endReboot();
      notify('sp.rebootBack');
      void loadAll();
    }
    return;
  }
  if (!l) router.replace({ name: 'play' });
});
onBeforeUnmount(endReboot);

onMounted(() => {
  if (!midiStore.deviceLink) { router.replace({ name: 'play' }); return; }
  void loadAll();
  loadFirmwares();
});
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.syntherrupter') }}<page-tour-button id="syntherrupter" /></h1>
      <div class="sy-head">
        <span class="sy-dev"><i class="fas" :class="ICONS.interrupter"></i>{{ profile.label }}<span
            v-if="device[sysKey(0x204)]" class="sy-dev__ver">{{ device[sysKey(0x204)] }}</span></span>
        <button v-if="update" class="btn btn--volt btn--xs" type="button" @click="openUpdate">
          <span class="icon"><i class="fas fa-download"></i></span>{{ $t('fw.available', { version: `v${update.version}` })
          }}<template v-if="update.prerelease"> ({{ $t('fw.beta') }})</template>
        </button>
        <span class="sy-port"><span class="conn__dot"></span>{{ midiStore.serialPortLabel || midiStore.deviceLink?.name }}</span>
      </div>
    </header>

    <div class="screen-body sy">
      <div v-if="rebooting" class="sy-load">
        <div class="sy-load__title">{{ $t('sp.rebootWait') }}</div>
      </div>
      <div v-else-if="loading" class="sy-load">
        <div class="sy-load__title">{{ $t('sp.loading') }}…</div>
        <div class="sy-load__bar"><div class="sy-load__fill" :style="{ width: loadPct + '%' }"></div></div>
        <div class="sy-load__sub">
          <span>{{ loadLabel }}</span><span class="sy-load__pct">{{ loadPct }}%</span>
        </div>
      </div>
      <p v-else-if="errored" class="sy-state is-error">
        <i class="fas fa-circle-exclamation"></i> {{ $t('sp.readError') }}
        <button class="btn btn--ghost" type="button" @click="loadAll">{{ $t('sp.reload') }}</button>
      </p>

      <div v-else class="sy-content">
        <!-- BOARD — what it says of itself, on the boards that tell -->
        <section v-if="profile.features.boardStatus" class="sy-block">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas fa-microchip"></i>{{ $t('board.title') }}</h2>
            <p class="sy-block__hint">{{ midiStore.boardSilent ? $t('board.silentAlert') : $t('board.hint') }}</p>
          </header>
          <div v-if="boardTiles.length" class="sy-board">
            <div v-for="tile in boardTiles" :key="tile.key" class="sy-tile" :class="`is-${tile.tone}`">
              <span class="sy-tile__icon"><i class="fas" :class="tile.icon"></i></span>
              <div>
                <div class="sy-tile__k">{{ tile.title }}</div>
                <div class="sy-tile__v">{{ tile.value }}</div>
                <div class="sy-tile__s">{{ tile.sub }}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- COILS — one row per coil, columns = the physical safety envelope -->
        <section class="sy-block sy-block--coils">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas" :class="ICONS.coil"></i>{{ $t('sp.coilsTitle') }}</h2>
            <p class="sy-block__hint">{{ $t('sp.coilsHint') }}</p>
          </header>
          <div class="sy-panel">
            <table class="sy-tbl">
              <thead>
                <tr>
                  <th scope="col" class="sy-tbl__rowhead">{{ $t('sp.coil') }}</th>
                  <th scope="col" v-for="p in coilParams" :key="p.pn">
                    {{ $t('sp.' + p.key) }}
                    <span v-if="p.safety" class="sy-tbl__flag is-safety" :title="$t('sp.safetyHint')"><i class="fas fa-triangle-exclamation"></i></span>
                    <button type="button" class="sy-info" :title="$t('label.info')" @click="showInfo(p)"><i class="fas fa-circle-info"></i></button>
                  </th>
                  <th v-if="profile.features.boardStatus" scope="col" :title="$t('board.tripsHint')">{{ $t('board.tripsColumn') }}</th>
                  <th scope="col" class="sy-tbl__act"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in coils" :key="c">
                  <th scope="row" class="sy-tbl__rowhead"><span class="sy-dot" :style="{ '--c': coilColor(c) }"></span>{{ c }}</th>
                  <td v-for="p in coilParams" :key="p.pn">
                    <param-cell :param="p" :device-value="device[coilKey(c, p.pn)]" :unread="unread[coilKey(c, p.pn)]"
                      :warn="nearLimit(c, p)" v-model="edited[coilKey(c, p.pn)]" />
                  </td>
                  <td v-if="profile.features.boardStatus">
                    <span class="sy-trips" :class="{ 'is-hot': midiStore.boardTrips[c] }">{{ midiStore.boardTrips[c] ?? 0 }}</span>
                  </td>
                  <td class="sy-tbl__act">
                    <button class="btn btn--volt sy-tbl__apply" type="button"
                      :disabled="!sectionDirty(coilEntries(c))" @click="applySection(coilEntries(c))">{{ $t('sp.apply') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- SYSTEM — device behaviour + info -->
        <section class="sy-block">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas fa-gear"></i>{{ $t('sp.system') }}</h2>
            <p class="sy-block__hint">{{ $t('sp.systemHint') }}</p>
          </header>
          <article class="sy-card">
            <header class="sy-card__head">
              <span class="sy-card__title">{{ $t('sp.deviceSettings') }}</span>
              <button class="btn btn--volt sy-card__apply" type="button"
                :disabled="!sectionDirty(sysEntries)" @click="applySection(sysEntries)">{{ $t('sp.apply') }}</button>
            </header>
            <div class="sy-card__body sy-card__body--grid">
              <param-row v-for="e in sysEntries" :key="e.key" :param="e.p"
                :device-value="device[e.key]" :unread="unread[e.key]" v-model="edited[e.key]" @info="showInfo" />
            </div>
          </article>
        </section>

        <!-- DISPLAY — the device's own touchscreen -->
        <section v-if="uiEntries.length" class="sy-block">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas" :class="ICONS.deviceScreen"></i>{{ $t('sp.displayTitle') }}</h2>
            <p class="sy-block__hint">{{ $t('sp.displayHint') }}</p>
          </header>
          <article class="sy-card">
            <header class="sy-card__head">
              <span class="sy-card__title">{{ $t('sp.displayTitle') }}</span>
              <button class="btn btn--volt sy-card__apply" type="button"
                :disabled="!sectionDirty(uiEntries)" @click="applySection(uiEntries)">{{ $t('sp.apply') }}</button>
            </header>
            <div class="sy-card__body sy-card__body--grid">
              <param-row v-for="e in uiEntries" :key="e.key" :param="e.p"
                :device-value="device[e.key]" :unread="unread[e.key]" v-model="edited[e.key]" @info="showInfo" />
            </div>
          </article>
        </section>

        <!-- USERS — one row per account, columns = permission limits -->
        <section v-if="users.length" class="sy-block">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas fa-users"></i>{{ $t('sp.usersTitle') }}</h2>
            <p class="sy-block__hint">{{ $t('sp.usersHint') }}</p>
          </header>
          <div class="sy-panel">
            <table class="sy-tbl">
              <thead>
                <tr>
                  <th scope="col" class="sy-tbl__rowhead">{{ $t('sp.user') }}</th>
                  <th scope="col" v-for="p in userParams" :key="p.pn">
                    {{ $t('sp.' + p.key) }}
                    <button type="button" class="sy-info" :title="$t('label.info')" @click="showInfo(p)"><i class="fas fa-circle-info"></i></button>
                  </th>
                  <th scope="col" class="sy-tbl__act"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in users" :key="u">
                  <th scope="row" class="sy-tbl__rowhead"><span class="icon sy-tbl__usericon"><i class="fas fa-user"></i></span>{{ u }}</th>
                  <td v-for="p in userParams" :key="p.pn">
                    <param-cell :param="p" :device-value="device[userKey(u, p.pn)]" :unread="unread[userKey(u, p.pn)]" v-model="edited[userKey(u, p.pn)]" />
                  </td>
                  <td class="sy-tbl__act">
                    <button class="btn btn--volt sy-tbl__apply" type="button"
                      :disabled="!sectionDirty(userEntries(u))" @click="applySection(userEntries(u))">{{ $t('sp.apply') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>

    <!-- sticky global action bar -->
    <footer v-if="!loading && !errored && !rebooting" class="sy-bar">
      <button class="btn btn--volt" type="button" @click="saveEeprom">
        <span class="icon"><i class="fas fa-floppy-disk"></i></span>{{ $t(flash ? 'sp.saveFlash' : 'sp.saveEeprom') }}
      </button>
      <button class="btn" type="button" @click="loadAll">
        <span class="icon"><i class="fas fa-rotate-left"></i></span>{{ $t('sp.reload') }}
      </button>
      <button class="btn btn--danger-ghost sy-bar__reboot" type="button" @click="reboot">
        <span class="icon"><i class="fas fa-power-off"></i></span>{{ $t('sp.reboot') }}
      </button>
    </footer>

    <firmware-update-modal :open="firmwareOpen" :release="firmwareTarget" :current="firmwareFrom"
      @running="updating = $event" @done="onUpdated" @close="firmwareOpen = false" />

    <confirm-modal :open="!!confirm" :title="confirm?.title ?? ''" :message="confirm?.message ?? ''"
      :confirm-label="confirm?.label ?? $t('sp.apply')" :cancel-label="$t('label.cancel')"
      @confirm="runConfirm" @close="confirm = null" />

    <!-- per-parameter explanation -->
    <base-modal :open="!!info" :title="info ? $t('sp.' + info.key) : ''" icon="fa-circle-info"
      :close-label="$t('label.close')" @close="info = null">
      <template v-if="info">
        <p class="sy-info__body">{{ $t('sp.' + info.key + 'Info') }}</p>
        <ul class="sy-info__meta">
          <li v-if="info.min !== undefined || info.max !== undefined">
            <span class="sy-info__k">{{ $t('sp.infoRange') }}</span>
            <span>{{ info.min ?? '' }}–{{ info.max ?? '' }}{{ info.unit ? ' ' + info.unit : '' }}</span>
          </li>
          <li v-else-if="info.unit">
            <span class="sy-info__k">{{ $t('sp.infoUnit') }}</span><span>{{ info.unit }}</span>
          </li>
          <li v-if="info.safety" class="is-safety"><i class="fas fa-triangle-exclamation"></i>{{ $t('sp.safetyHint') }}</li>
          <li v-if="!info.eeprom && !info.readOnly"><i class="fas fa-clock-rotate-left"></i>{{ $t('sp.volatileHint') }}</li>
        </ul>
      </template>
    </base-modal>
  </div>
</template>
