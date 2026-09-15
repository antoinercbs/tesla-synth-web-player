<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ArcHeatmap from './ArcHeatmap.vue';
import CameraJoin from './CameraJoin.vue';
import type { HeatPayload } from './heat';
import type { CameraStatus, LiveMeasure } from './protocol';

/**
 * The camera, centre stage: how the phone joins (QR / link), what it sees right
 * now (length readout + live arc silhouette), and the silhouettes of the best
 * and the last trials side by side. Presentation only; the parent owns the
 * session and the trials.
 */
const props = defineProps<{
  url: string | null;
  altUrls?: string[];
  online: boolean;
  ready: boolean;
  status: CameraStatus | null;
  live: LiveMeasure | null;
  liveHeat: HeatPayload | null;
  bestHeat: HeatPayload | null;
  lastHeat: HeatPayload | null;
  bestTitle: string;
  lastTitle: string;
  linkError: string | null;
  busy: boolean;
  isElectron: boolean;
  /** Keep the QR / link out of the card and behind a button (no room for it once trials are running). */
  linkInModal?: boolean;
  labels: {
    title: string; connect: string; scan: string; openHere: string; copy: string; copied: string; showQr: string;
    online: string; offline: string; ready: string; notReady: string; stop: string; end: string;
    lanHint: string; webHint: string; moved: string; measuring: string; idle: string; linkLost: string; sessionGone: string;
    liveHeat: string; heatHint: string; noHeatYet: string; link: string; joinTitle: string; close: string;
  };
}>();
const emit = defineEmits<{ (e: 'connect'): void; (e: 'stop'): void; (e: 'end'): void }>();

const qrOpen = ref(false);
const linkOpen = ref(false);
// the QR is the way in: prominent until the camera is online, tucked away after
const showQr = computed(() => !props.online || qrOpen.value);
const moved = computed(() => !!props.live && (Math.abs(props.live.dx) > 6 || Math.abs(props.live.dy) > 6));
</script>

<template>
  <article class="cam-card">
    <header class="cam-card__head">
      <span class="cam-card__title"><span class="icon"><i class="fas fa-camera"></i></span>{{ labels.title }}</span>
      <span class="cam-card__head-right">
        <button v-if="url && linkInModal" class="btn btn--ghost btn--xs" type="button" @click="linkOpen = true">
          <span class="icon"><i class="fas fa-qrcode"></i></span>{{ labels.link }}
        </button>
        <span v-if="url" class="cam-dot" :class="{ 'is-on': online, 'is-ready': online && ready }">
          {{ !online ? labels.offline : ready ? labels.ready : labels.notReady }}
        </span>
      </span>
    </header>

    <!-- not connected yet -->
    <div v-if="!url" class="cam-card__connect">
      <p class="player-hint"><span class="icon"><i class="fas fa-circle-info"></i></span>{{ isElectron ? labels.lanHint : labels.webHint }}</p>
      <button class="btn btn--volt cam-connect" type="button" :disabled="busy" @click="emit('connect')">
        <span class="icon"><i class="fas" :class="busy ? 'fa-spinner fa-spin' : 'fa-qrcode'"></i></span>{{ labels.connect }}
      </button>
    </div>

    <template v-else>
      <!-- the way in: QR + link, in place while the session is being set up -->
      <camera-join v-if="!linkInModal" class="cam-card__join" :class="{ 'is-compact': online && !qrOpen }"
        :url="url" :alt-urls="altUrls" :show-qr="showQr" :can-toggle-qr="online" :scan-hint="!online" :link-error="linkError" :labels="labels"
        @toggle-qr="qrOpen = !qrOpen" />
      <p v-else-if="linkError" class="cam-warn"><i class="fas fa-triangle-exclamation"></i>{{ linkError === 'session-gone' || linkError === 'session-token' ? labels.sessionGone : labels.linkLost }}</p>

      <!-- what the camera sees: the silhouette gets the room, the figures a column -->
      <div v-if="online" class="cam-live" :class="{ 'is-measuring': live?.measuring }">
        <div class="cam-live__readout">
          <div class="cam-live__l">
            <span class="cam-live__value">{{ live ? live.L.toFixed(0) : '–' }}</span>
            <span class="cam-live__unit">px</span>
          </div>
          <span class="cam-live__state">{{ live?.measuring ? labels.measuring : (status?.message || labels.idle) }}</span>
          <dl class="cam-live__meta mono">
            <div><dt>P90 · 1 s</dt><dd>{{ live ? live.p90.toFixed(0) : '–' }} px</dd></div>
            <div><dt>fps</dt><dd>{{ live ? live.fps.toFixed(0) : '–' }}</dd></div>
            <div><dt>conf</dt><dd>{{ live ? live.conf.toFixed(2) : '–' }}</dd></div>
            <div :class="{ 'is-warn': moved }"><dt>Δ px</dt><dd>{{ live ? `${live.dx}, ${live.dy}` : '–' }}</dd></div>
          </dl>
          <span v-if="moved" class="cam-warn"><i class="fas fa-triangle-exclamation"></i>{{ labels.moved }}</span>
        </div>
        <div class="cam-live__heat">
          <arc-heatmap :heat="liveHeat" :width="640" :title="labels.liveHeat" />
          <span v-if="!liveHeat" class="cam-live__note">{{ labels.noHeatYet }}</span>
        </div>
      </div>

      <!-- best vs last -->
      <div v-if="bestHeat || lastHeat" class="cam-compare">
        <arc-heatmap :heat="bestHeat" :width="280" :title="bestTitle" />
        <arc-heatmap :heat="lastHeat" :width="280" :title="lastTitle" />
        <p class="dim small cam-compare__hint">{{ labels.heatHint }}</p>
      </div>

      <div class="cam-card__foot">
        <button class="btn btn--danger cam-stop" type="button" @click="emit('stop')">
          <span class="icon"><i class="fas fa-stop"></i></span>{{ labels.stop }}
        </button>
        <button class="btn btn--ghost" type="button" @click="emit('end')">{{ labels.end }}</button>
      </div>
    </template>

    <base-modal :open="linkOpen" :title="labels.joinTitle" icon="fa-qrcode" :close-label="labels.close" @close="linkOpen = false">
      <camera-join v-if="url" class="cam-card__join-modal" :url="url" :alt-urls="altUrls" :show-qr="true" :scan-hint="true" :link-error="linkError" :labels="labels" />
      <template #actions>
        <button class="btn btn--volt" type="button" @click="linkOpen = false">{{ labels.close }}</button>
      </template>
    </base-modal>
  </article>
</template>

<style scoped>
.cam-card { background: linear-gradient(180deg, var(--panel-2), var(--panel)); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 1rem; }
.cam-card__head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; }
.cam-card__title { font-family: var(--font-display); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.5rem; }
.cam-dot { font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-mute); display: inline-flex; align-items: center; gap: 0.4rem; }
.cam-dot::before { content: ""; width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--text-mute); }
.cam-dot.is-on { color: var(--amber); } .cam-dot.is-on::before { background: var(--amber); box-shadow: 0 0 8px var(--amber); }
.cam-dot.is-ready { color: var(--ok); } .cam-dot.is-ready::before { background: var(--ok); box-shadow: 0 0 8px var(--ok); }

.cam-card__connect { display: flex; flex-direction: column; gap: 0.9rem; align-items: center; text-align: center; padding: 1.4rem 0.5rem 1.6rem; }
.cam-card__connect .player-hint { max-width: 40ch; }
.cam-connect { font-size: 1rem; padding: 0.7rem 1.4rem; }

.cam-card__head-right { display: inline-flex; align-items: center; gap: 0.7rem; }
.btn--xs { padding: 0.25rem 0.65rem; font-size: 0.74rem; }
.cam-card__join.is-compact { padding-bottom: 0.9rem; border-bottom: 1px solid var(--line); }
.cam-card__join-modal { margin-top: 0.8rem; min-width: min(30rem, 80vw); }
.dim { color: var(--text-dim); font-size: 0.85rem; margin: 0; }
.small { font-size: 0.72rem; }
.mono { font-family: var(--font-mono); }
.cam-warn { color: var(--danger); font-size: 0.8rem; display: inline-flex; gap: 0.4rem; align-items: center; margin: 0; }

/* the silhouette is what you watch during a trial: it gets the width, the figures a single narrow column */
.cam-live { display: grid; grid-template-columns: minmax(6.5rem, 8.5rem) minmax(0, 1fr); gap: 0.8rem 1rem; align-items: start; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0.9rem 1rem; }
@media (max-width: 460px) { .cam-live { grid-template-columns: 1fr; } }
.cam-live.is-measuring { border-color: var(--volt-30); box-shadow: inset 0 0 0 1px var(--volt-10), 0 0 18px -8px var(--volt); }
.cam-live__readout { display: flex; flex-direction: column; gap: 0.5rem; }
.cam-live__l { display: flex; align-items: baseline; gap: 0.35rem; }
.cam-live__value { font-family: var(--font-display); font-size: 2.4rem; font-weight: 700; line-height: 1; color: var(--volt); font-variant-numeric: tabular-nums; }
.cam-live__unit { color: var(--text-dim); font-family: var(--font-mono); }
.cam-live__state { font-size: 0.85rem; color: var(--text); }
.cam-live__meta { display: grid; grid-template-columns: 1fr; gap: 0.15rem; margin: 0; font-size: 0.74rem; }
.cam-live__meta div { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.cam-live__meta dt { color: var(--text-mute); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.64rem; }
.cam-live__meta dd { margin: 0; color: var(--text); font-variant-numeric: tabular-nums; }
.cam-live__meta .is-warn dd { color: var(--danger); }
.cam-live__heat { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; position: relative; }
.cam-live__heat :deep(.arc-heat) { max-width: 100%; }
/* one compact line under the drawing, never a paragraph */
.cam-live__heat :deep(.arc-heat__cap) { font-size: 0.68rem; line-height: 1.2; white-space: nowrap; overflow: hidden; }
.cam-live__heat :deep(.arc-heat__cap span:first-child) { overflow: hidden; text-overflow: ellipsis; }
.cam-live__note { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); max-width: 80%; text-align: center; font-size: 0.72rem; color: var(--text-mute); pointer-events: none; }

.cam-compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; align-items: start; }
.cam-compare :deep(.arc-heat) { width: 100% !important; }
.cam-compare__hint { grid-column: 1 / -1; margin: 0; font-size: 0.68rem; line-height: 1.25; color: var(--text-mute); }

.cam-card__foot { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.cam-stop { font-size: 1rem; padding-inline: 1.4rem; letter-spacing: 0.08em; }
</style>
