<script setup lang="ts">
import QRCode from 'qrcode';
import { ref, watch } from 'vue';
import { notify } from '@/utils/toast';

/**
 * How the phone joins a tuning session: the QR code to scan, the link behind it,
 * and the fallback addresses on a machine with several network interfaces.
 * Shown in place while the session is being set up, and tucked into a modal once
 * the trials are running (the parent decides).
 */
const props = defineProps<{
  url: string;
  altUrls?: string[];
  /** Draw the QR code (the parent hides it once the phone is in). */
  showQr: boolean;
  /** Offer the QR toggle (never inside the modal, where the code is always drawn). */
  canToggleQr?: boolean;
  /** Show the "scan this" line (only while nobody has joined). */
  scanHint?: boolean;
  linkError: string | null;
  labels: { scan: string; openHere: string; copy: string; copied: string; showQr: string; linkLost: string; sessionGone: string };
}>();
const emit = defineEmits<{ (e: 'toggle-qr'): void }>();

const canvas = ref<HTMLCanvasElement | null>(null);
watch([() => props.url, canvas, () => props.showQr], async ([url, c, show]) => {
  if (!url || !c || !show) return;
  try {
    await QRCode.toCanvas(c, url, { width: 200, margin: 1, color: { dark: '#08111a', light: '#e8f4ff' } });
  } catch { /* canvas unavailable */ }
}, { immediate: true, flush: 'post' });

async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(props.url); notify(props.labels.copied); } catch { /* no clipboard */ }
}
function openHere(): void { window.open(props.url, '_blank', 'noopener'); }
</script>

<template>
  <div class="cam-join">
    <canvas v-if="showQr" ref="canvas" width="200" height="200" class="cam-join__qr"></canvas>
    <div class="cam-join__side">
      <p v-if="scanHint" class="cam-join__dim">{{ labels.scan }}</p>
      <code class="cam-url">{{ url }}</code>
      <div class="cam-join__btns">
        <button class="btn btn--ghost" type="button" @click="copy"><span class="icon"><i class="fas fa-copy"></i></span>{{ labels.copy }}</button>
        <button class="btn btn--ghost" type="button" @click="openHere"><span class="icon"><i class="fas fa-laptop"></i></span>{{ labels.openHere }}</button>
        <button v-if="canToggleQr" class="btn btn--ghost" type="button" :aria-pressed="showQr" @click="emit('toggle-qr')"><span class="icon"><i class="fas fa-qrcode"></i></span>{{ labels.showQr }}</button>
      </div>
      <p v-if="altUrls && altUrls.length" class="cam-join__dim mono cam-join__small">{{ altUrls.join(' · ') }}</p>
      <p v-if="linkError" class="cam-join__warn"><i class="fas fa-triangle-exclamation"></i>{{ linkError === 'session-gone' || linkError === 'session-token' ? labels.sessionGone : labels.linkLost }}</p>
    </div>
  </div>
</template>
