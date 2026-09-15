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
      <p v-if="scanHint" class="dim">{{ labels.scan }}</p>
      <code class="cam-url">{{ url }}</code>
      <div class="cam-join__btns">
        <button class="btn btn--ghost" type="button" @click="copy"><span class="icon"><i class="fas fa-copy"></i></span>{{ labels.copy }}</button>
        <button class="btn btn--ghost" type="button" @click="openHere"><span class="icon"><i class="fas fa-laptop"></i></span>{{ labels.openHere }}</button>
        <button v-if="canToggleQr" class="btn btn--ghost" type="button" :aria-pressed="showQr" @click="emit('toggle-qr')"><span class="icon"><i class="fas fa-qrcode"></i></span>{{ labels.showQr }}</button>
      </div>
      <p v-if="altUrls && altUrls.length" class="dim mono small">{{ altUrls.join(' · ') }}</p>
      <p v-if="linkError" class="cam-warn"><i class="fas fa-triangle-exclamation"></i>{{ linkError === 'session-gone' || linkError === 'session-token' ? labels.sessionGone : labels.linkLost }}</p>
    </div>
  </div>
</template>

<style scoped>
.cam-join { display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-start; }
.cam-join__qr { border-radius: 8px; flex: 0 0 auto; max-width: 100%; height: auto; }
.cam-join__side { flex: 1 1 14rem; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.cam-url { font-family: var(--font-mono); font-size: 0.72rem; word-break: break-all; color: var(--text-dim); background: var(--bg-2); padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid var(--line); }
.cam-join__btns { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.dim { color: var(--text-dim); font-size: 0.85rem; margin: 0; }
.small { font-size: 0.72rem; }
.mono { font-family: var(--font-mono); }
.cam-warn { color: var(--danger); font-size: 0.8rem; display: inline-flex; gap: 0.4rem; align-items: center; margin: 0; }
</style>
