import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * The ONLY bridge between the renderer (the same Vue bundle the web build runs)
 * and the desktop host. Its presence is how the SPA detects it is running in
 * Electron and unlocks the sync + server-config UI.
 */
contextBridge.exposeInMainWorld('teslaElectron', {
  isElectron: true,

  // Server configuration (URL + basic-auth). The raw password never comes back.
  getServerConfig: () => ipcRenderer.invoke('server-config:get'),
  setServerConfig: (cfg: unknown) => ipcRenderer.invoke('server-config:set', cfg),

  // Sync. The actual HTTP calls (incl. credentials) run in the main process.
  previewSync: () => ipcRenderer.invoke('sync:preview'),
  applySync: (selections: unknown) => ipcRenderer.invoke('sync:apply', selections),

  /** Subscribe to sync progress messages. Returns an unsubscribe function. */
  onSyncProgress: (cb: (message: string) => void) => {
    const listener = (_e: IpcRendererEvent, message: string) => cb(message);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  },

  /** Native menu "Server configuration…" asks the renderer to open the modal. */
  onOpenServerConfig: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('open-server-config', listener);
    return () => ipcRenderer.removeListener('open-server-config', listener);
  },
});
