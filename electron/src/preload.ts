import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * The ONLY bridge between the renderer (the same Vue bundle the web build runs)
 * and the desktop host. Its presence is how the SPA detects it is running in
 * Electron and unlocks the sync + server-config UI.
 */
contextBridge.exposeInMainWorld('teslaElectron', {
  isElectron: true,

  // Server configuration: just the remote URL now (no basic-auth fields).
  getServerConfig: () => ipcRenderer.invoke('server-config:get'),
  setServerConfig: (cfg: unknown) => ipcRenderer.invoke('server-config:set', cfg),

  // OIDC sign-in to the remote server (the loopback flow runs in main; tokens
  // never reach the renderer). Only relevant when the server requires auth.
  getAuthStatus: () => ipcRenderer.invoke('auth:status'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Sync. The actual HTTP calls (incl. the bearer token) run in the main process.
  previewSync: () => ipcRenderer.invoke('sync:preview'),
  applySync: (selections: unknown) => ipcRenderer.invoke('sync:apply', selections),

  /** Subscribe to sync progress steps (i18n key + params). Returns unsubscribe. */
  onSyncProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, p: unknown): void => cb(p);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  },

  // LAN HTTPS server for camera-assisted tuning (the phone joins over Wi-Fi).
  lanStart: () => ipcRenderer.invoke('lan:start'),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  lanStatus: () => ipcRenderer.invoke('lan:status'),

  // Live channel of a tuning session, carried by IPC (the renderer cannot open
  // a WebSocket over app://). Frames are the hub's, tagged by the caller's sid.
  tuningOpen: (opts: unknown) => ipcRenderer.invoke('tuning:open', opts),
  tuningSend: (sid: string, msg: unknown) => ipcRenderer.invoke('tuning:send', sid, msg),
  tuningClose: (sid: string) => ipcRenderer.invoke('tuning:close', sid),
  onTuningMessage: (cb: (sid: string, msg: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, sid: string, msg: unknown): void => cb(sid, msg);
    ipcRenderer.on('tuning:message', listener);
    return () => ipcRenderer.removeListener('tuning:message', listener);
  },

  /** Native menu "Server configuration…" asks the renderer to open the modal. */
  onOpenServerConfig: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('open-server-config', listener);
    return () => ipcRenderer.removeListener('open-server-config', listener);
  },
});
