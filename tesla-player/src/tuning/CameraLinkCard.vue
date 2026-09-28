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
      <p v-else-if="linkError" class="cam-card__warn"><i class="fas fa-triangle-exclamation"></i>{{ linkError === 'session-gone' || linkError === 'session-token' ? labels.sessionGone : labels.linkLost }}</p>

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
          <span v-if="moved" class="cam-card__warn"><i class="fas fa-triangle-exclamation"></i>{{ labels.moved }}</span>
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
        <p class="cam-card__dim cam-card__small cam-compare__hint">{{ labels.heatHint }}</p>
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
