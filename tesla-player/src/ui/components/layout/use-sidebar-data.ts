import axios from 'axios';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import { useScenesStore } from '@/app/stores/scenes';
import { listScenes } from '@/api/scenes';
import type { AppTag } from '@/model/domain';
import { notify } from '@/ui/helpers/toast';

/**
 * What the sidebar's footer does with the server: whether it answers (pinged),
 * the tags saved from their modal, the lists read again after a restore or a
 * desktop sync, and on the desktop app the server's configuration (Sync only
 * shows once a remote server is set).
 */
export function useSidebarData() {
  const midiStore = useMidiStore();
  const scenesStore = useScenesStore();
  // the server didn't answer the last ping
  const offline = ref(false);
  // Electron desktop bridge (absent in the web build).
  const isElectron = typeof window !== 'undefined' && window.teslaElectron?.isElectron === true;
  // Electron: whether a remote server URL is set. Sync is meaningless (and hidden) until one is configured.
  const serverConfigured = ref(false);
  const modals = { tagsOpen: ref(false), serverOpen: ref(false), syncOpen: ref(false), backupOpen: ref(false), downloadOpen: ref(false) };
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let unsubServerConfig: (() => void) | null = null;

  function ping(): void {
    axios.get('/api/ping')
      .then(() => { offline.value = false; })
      .catch(() => { offline.value = true; });
  }
  async function saveTags(tags: AppTag[]): Promise<void> {
    try {
      const r = await axios.put('/api/tags/sync', tags);
      midiStore.setTagList(r.data);
    } catch (err) {
      console.error('Save tags failed', err);
      notify('label.saveFailed', 'error');
      return;
    }
    notify('label.settingsSaved');
    modals.tagsOpen.value = false;
    // A deleted tag is gone from song_tags too, so the songs in memory
    // still carry stale pills until they are re-read.
    axios.get('/api/songs')
      .then((s) => { midiStore.setMidiSongList(s.data); })
      .catch((err) => console.error('Reload songs failed', err));
  }
  // Reflect whether a remote server URL is set (drives the Sync button's visibility).
  async function refreshServerConfigured(): Promise<void> {
    if (!isElectron || !window.teslaElectron) return;
    try {
      const cfg = await window.teslaElectron.getServerConfig();
      serverConfigured.value = !!(cfg && cfg.url);
    } catch {
      serverConfigured.value = false;
    }
  }
  function onServerSaved(): void {
    notify('label.settingsSaved');
    void refreshServerConfigured(); // a URL may have just been added/removed
  }
  function onSyncApplied(): void {
    // A pull may have changed the local DB — refresh the cached lists, and
    // bump the data revision so views that fetch ad-hoc (playlists) re-read.
    axios.get('/api/songs').then((r) => midiStore.setMidiSongList(r.data)).catch(() => { });
    axios.get('/api/envelopes').then((r) => midiStore.setEnvelopeList(r.data)).catch(() => { });
    axios.get('/api/coils').then((r) => midiStore.setCoilList(r.data)).catch(() => { });
    listScenes().then((list) => scenesStore.setList(list)).catch(() => { });
    midiStore.bumpDataRevision();
  }
  // a restore also brings tags and settings back
  function onRestored(): void {
    onSyncApplied();
    axios.get('/api/tags').then((r) => midiStore.setTagList(r.data)).catch(() => { });
    axios.get('/api/settings').then((r) => midiStore.setAppConfig(r.data)).catch(() => { });
  }

  onMounted(() => {
    ping();
    pingTimer = setInterval(ping, 10000);
    // Native menu "Server configuration…" opens the modal.
    if (isElectron && window.teslaElectron) {
      unsubServerConfig = window.teslaElectron.onOpenServerConfig(() => { modals.serverOpen.value = true; });
      void refreshServerConfigured(); // hide Sync until a server URL is set
    }
  });
  onBeforeUnmount(() => {
    if (pingTimer) clearInterval(pingTimer);
    if (unsubServerConfig) unsubServerConfig();
  });

  return { offline, isElectron, serverConfigured, ...modals, saveTags, onServerSaved, onSyncApplied, onRestored };
}
