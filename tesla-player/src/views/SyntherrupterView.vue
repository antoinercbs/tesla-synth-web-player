<script setup lang="ts">
import { reactive, ref, watch, onMounted } from 'vue';
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
import type { SerialMidiOutput } from '@/serial/serial-midi';
import ParamRow from '@/components/settings/ParamRow.vue';
import ParamCell from '@/components/settings/ParamCell.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import BaseModal from '@/components/ui/BaseModal.vue';

/**
 * Syntherrupter hardware config page (serial only). Reads the static device
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
const confirm = ref<{ title: string; message: string; action: () => void } | null>(null);
const info = ref<SynthParam | null>(null);
function showInfo(p: SynthParam): void { info.value = p; }

const link = (): SerialMidiOutput | null =>
  (midiStore.midiOutput as unknown as SerialMidiOutput | null) ?? null;

const coilKey = (c: number, pn: number): string => `c${c}:${pn}`;
const sysKey = (pn: number): string => `s${pn}`;
const userKey = (u: number, pn: number): string => `u${u}:${pn}`;

const coilEntries = (c: number): Entry[] => COIL_PARAMS.map((p) => ({ p, target: c, key: coilKey(c, p.pn) }));
const sysEntries: Entry[] = [...SYSTEM_PARAMS, ...SYSTEM_INFO].map((p) => ({ p, target: 0, key: sysKey(p.pn) }));
const uiEntries: Entry[] = UI_PARAMS.map((p) => ({ p, target: 0, key: sysKey(p.pn) }));
const userEntries = (u: number): Entry[] => USER_PARAMS.map((p) => ({ p, target: u, key: userKey(u, p.pn) }));
const users = Array.from({ length: USER_COUNT }, (_, u) => u);

/** Decode the firmware-version bitfield (0x204): [0-7] beta (255 = release),
 *  [8-15] bugfix, [16-23] sub, [24-31] main → e.g. "v4.2.2" / "v4.2.0-beta.26". */
function formatFwVersion(n: number): string {
  const beta = n & 0xff;
  const bugfix = (n >>> 8) & 0xff;
  const sub = (n >>> 16) & 0xff;
  const main = (n >>> 24) & 0xff;
  return `v${main}.${sub}.${bugfix}` + (beta === 255 ? '' : `-beta.${beta}`);
}

function toDisplay(p: SynthParam, f: DecodedFrame): Val {
  if (p.key === 'firmwareVersion') return formatFwVersion(f.valueInt);
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
    const total = coils.value.length + 1 + users.length;
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
      for (const p of COIL_PARAMS) {
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
    for (const p of [...SYSTEM_PARAMS, ...UI_PARAMS, ...SYSTEM_INFO]) {
      seedRead(sysKey(p.pn), p, sysFrames.find((fr) => fr.pnFull === p.pn));
    }
    done++;
    // users: one GET per user over 0x240..0x244 (name/password = char-group frames)
    for (const u of users) {
      step(t('sp.loadUser', { n: u }));
      const uf = await out.read(0x240, u, 0x244);
      for (const p of USER_PARAMS) {
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

function writeEntry(out: SerialMidiOutput, e: Entry): void {
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

function saveEeprom(): void {
  const out = link();
  if (!out) return;
  out.send(buildCommand({ pn: ACTION_PN.EEPROM_UPDATE, value: 1 }));
  notify('sp.savedEeprom');
}
function reboot(): void {
  confirm.value = {
    title: t('sp.rebootTitle'),
    message: t('sp.rebootMsg'),
    action: () => {
      link()?.send(buildCommand({ pn: ACTION_PN.RESET, value: ACTION_PN.RESET_MAGIC }));
      notify('sp.rebooting');
    },
  };
}
function runConfirm(): void {
  const c = confirm.value;
  confirm.value = null;
  c?.action();
}

// leaving serial (unplug / reboot) closes the page — there's nothing to configure
watch(() => midiStore.serialConnected, (up) => { if (!up) router.replace({ name: 'play' }); });

onMounted(() => {
  if (!midiStore.serialConnected) { router.replace({ name: 'play' }); return; }
  void loadAll();
});
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.syntherrupter') }}</h1>
      <span class="sy-port"><span class="conn__dot"></span>{{ midiStore.serialPortLabel }}</span>
    </header>

    <div class="screen-body sy">
      <div v-if="loading" class="sy-load">
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
        <!-- COILS — one row per coil, columns = the physical safety envelope -->
        <section class="sy-block">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas fa-bolt"></i>{{ $t('sp.coilsTitle') }}</h2>
            <p class="sy-block__hint">{{ $t('sp.coilsHint') }}</p>
          </header>
          <div class="sy-panel">
            <table class="sy-tbl">
              <thead>
                <tr>
                  <th scope="col" class="sy-tbl__rowhead">{{ $t('sp.coil') }}</th>
                  <th scope="col" v-for="p in COIL_PARAMS" :key="p.pn">
                    {{ $t('sp.' + p.key) }}
                    <span v-if="p.safety" class="sy-tbl__flag is-safety" :title="$t('sp.safetyHint')"><i class="fas fa-triangle-exclamation"></i></span>
                    <button type="button" class="sy-info" :title="$t('label.info')" @click="showInfo(p)"><i class="fas fa-circle-info"></i></button>
                  </th>
                  <th scope="col" class="sy-tbl__act"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in coils" :key="c">
                  <th scope="row" class="sy-tbl__rowhead"><span class="sy-dot" :style="{ '--c': coilColor(c) }"></span>{{ c }}</th>
                  <td v-for="p in COIL_PARAMS" :key="p.pn">
                    <param-cell :param="p" :device-value="device[coilKey(c, p.pn)]" :unread="unread[coilKey(c, p.pn)]" v-model="edited[coilKey(c, p.pn)]" />
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
        <section class="sy-block">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas fa-display"></i>{{ $t('sp.displayTitle') }}</h2>
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
        <section class="sy-block">
          <header class="sy-block__head">
            <h2 class="sy-block__title"><i class="fas fa-users"></i>{{ $t('sp.usersTitle') }}</h2>
            <p class="sy-block__hint">{{ $t('sp.usersHint') }}</p>
          </header>
          <div class="sy-panel">
            <table class="sy-tbl">
              <thead>
                <tr>
                  <th scope="col" class="sy-tbl__rowhead">{{ $t('sp.user') }}</th>
                  <th scope="col" v-for="p in USER_PARAMS" :key="p.pn">
                    {{ $t('sp.' + p.key) }}
                    <button type="button" class="sy-info" :title="$t('label.info')" @click="showInfo(p)"><i class="fas fa-circle-info"></i></button>
                  </th>
                  <th scope="col" class="sy-tbl__act"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in users" :key="u">
                  <th scope="row" class="sy-tbl__rowhead"><span class="icon sy-tbl__usericon"><i class="fas fa-user"></i></span>{{ u }}</th>
                  <td v-for="p in USER_PARAMS" :key="p.pn">
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
    <footer v-if="!loading && !errored" class="sy-bar">
      <button class="btn btn--volt" type="button" @click="saveEeprom">
        <span class="icon"><i class="fas fa-floppy-disk"></i></span>{{ $t('sp.saveEeprom') }}
      </button>
      <button class="btn" type="button" @click="loadAll">
        <span class="icon"><i class="fas fa-rotate-left"></i></span>{{ $t('sp.reload') }}
      </button>
      <button class="btn btn--danger sy-bar__reboot" type="button" @click="reboot">
        <span class="icon"><i class="fas fa-power-off"></i></span>{{ $t('sp.reboot') }}
      </button>
    </footer>

    <confirm-modal :open="!!confirm" :title="confirm?.title ?? ''" :message="confirm?.message ?? ''"
      :confirm-label="$t('sp.apply')" :cancel-label="$t('label.cancel')"
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

<style scoped>
/* scroll container (the body) + a pinned action bar below it */
.sy { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.sy-content { display: flex; flex-direction: column; gap: 1.7rem; }
.sy-port {
  display: inline-flex; align-items: center; gap: 0.45rem; margin-left: auto;
  font-family: var(--font-mono); font-size: 0.8rem; color: var(--volt);
}
.sy-port .conn__dot { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
.sy-state { padding: 3rem; text-align: center; color: var(--text-mute); font-family: var(--font-mono); display: flex; align-items: center; justify-content: center; gap: 0.7rem; }
.sy-state.is-error { color: var(--danger); }

/* serial-load progress bar + step subtitle */
.sy-load { max-width: 30rem; margin: 4rem auto; display: flex; flex-direction: column; gap: 0.6rem; }
.sy-load__title { text-align: center; color: var(--text); font-family: var(--font-mono); font-size: 0.95rem; }
.sy-load__bar { height: 7px; border-radius: 999px; background: var(--line); overflow: hidden; }
.sy-load__fill {
  height: 100%; border-radius: 999px; background: var(--volt);
  box-shadow: 0 0 10px var(--volt-30); transition: width 0.3s ease;
}
.sy-load__sub {
  display: flex; align-items: center; justify-content: space-between; gap: 0.7rem;
  color: var(--text-mute); font-family: var(--font-mono); font-size: 0.8rem;
}
.sy-load__pct { color: var(--volt); flex: 0 0 auto; }

/* business blocks */
.sy-block__head { margin-bottom: 0.85rem; }
.sy-block__title {
  display: flex; align-items: center; gap: 0.55rem; margin: 0;
  font-family: var(--font-display); font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.05em;
}
.sy-block__title i { color: var(--volt); }
.sy-block__hint { margin: 0.3rem 0 0; color: var(--text-mute); font-size: 0.82rem; line-height: 1.4; }

/* tables — one row per coil / user; horizontal dividers only (no vertical lines) */
.sy-panel {
  border: 1px solid var(--line); border-radius: var(--radius); overflow-x: auto;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
}
.sy-tbl { width: 100%; border-collapse: collapse; }
.sy-tbl th, .sy-tbl td { padding: 0.5rem 0.7rem; text-align: left; vertical-align: middle; border-bottom: 1px solid var(--line); }
.sy-tbl thead th {
  font-family: var(--font-mono); font-size: 0.68rem; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-mute);
  white-space: nowrap; background: var(--volt-06);
}
.sy-tbl tbody tr:last-child th, .sy-tbl tbody tr:last-child td { border-bottom: 0; }
.sy-tbl tbody tr:hover td, .sy-tbl tbody tr:hover th { background: var(--line-005); }
.sy-tbl__rowhead { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.8rem; color: var(--text); white-space: nowrap; }
.sy-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px -1px var(--c); margin-right: 0.5rem; vertical-align: middle; }
.sy-tbl__usericon { color: var(--volt); margin-right: 0.4rem; }
.sy-tbl__unit { color: var(--text-mute); margin-left: 0.3rem; text-transform: none; }
.sy-tbl__flag { margin-left: 0.3rem; color: var(--text-mute); }
.sy-tbl__flag.is-safety { color: var(--danger); }
.sy-tbl__act { width: 1%; white-space: nowrap; text-align: right; }
.sy-tbl__apply { padding: 0.3rem 0.85rem; font-size: 0.72rem; }
.sy-tbl td .param-cell { min-width: 5.5rem; }

/* per-field info button + explanation modal */
.sy-info {
  border: 0; background: transparent; cursor: pointer; color: var(--text-mute);
  padding: 0; margin-left: 0.3rem; font-size: 0.8rem; line-height: 1; vertical-align: middle;
}
.sy-info:hover { color: var(--volt); }
.sy-info__body { margin: 0 0 1rem; color: var(--text-dim); line-height: 1.55; }
.sy-info__meta {
  list-style: none; margin: 0; padding: 0.8rem 0 0; border-top: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.85rem;
}
.sy-info__meta li { display: flex; align-items: center; gap: 0.5rem; color: var(--text-dim); }
.sy-info__meta li.is-safety, .sy-info__meta li.is-safety i { color: var(--danger); }
.sy-info__meta li i { color: var(--text-mute); }
.sy-info__k { color: var(--text-mute); font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; min-width: 4rem; }

/* system card — single entity, params flow in a responsive grid */
.sy-card {
  border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
}
.sy-card__head {
  display: flex; align-items: center; gap: 0.55rem; padding: 0.6rem 0.8rem;
  background: var(--volt-06); border-bottom: 1px solid var(--line);
}
.sy-card__title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.8rem; color: var(--text); }
.sy-card__apply { margin-left: auto; padding: 0.3rem 0.85rem; font-size: 0.72rem; }
.sy-card__body { padding: 0.7rem; }
.sy-card__body--grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.4rem 1.2rem; }

.sy-bar {
  flex: 0 0 auto; display: flex; align-items: center; gap: 0.6rem;
  padding: 0.8rem 2rem; border-top: 1px solid var(--line);
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
}
.sy-bar__reboot { margin-left: auto; }
</style>
