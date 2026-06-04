import { BrowserWindow, ipcMain } from 'electron';
import {
  getServerConfigPublic,
  setServerUrl,
  type ServerConfigInput,
} from './config-store';
import { getStatus, getValidAccessToken, login, logout } from './oidc-auth';
import { applySync, previewSync, type Fetcher, type SyncSelection } from './sync-engine';

/** The local sync peer: its base URL + the transport to reach it (real `fetch`
 *  for the dev HTTP backend, or the in-process dispatch adapter when packaged). */
export interface LocalPeer {
  base: string;
  fetch: Fetcher;
}

/**
 * Wires the preload bridge to the main-process logic. Tokens never cross into
 * the renderer: the OIDC flow and the sync calls run here, in main. The local
 * peer is reached via `getLocalPeer()` (in-process dispatch when packaged).
 */
export function registerIpc(
  getLocalPeer: () => LocalPeer,
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle('server-config:get', () => getServerConfigPublic());
  ipcMain.handle('server-config:set', (_e, cfg: ServerConfigInput) =>
    setServerUrl(cfg),
  );

  // --- OIDC sign-in (only relevant for sync against an auth-enabled server) ---
  ipcMain.handle('auth:status', async () => {
    const { url } = await getServerConfigPublic();
    return getStatus(url);
  });
  ipcMain.handle('auth:login', async () => {
    const { url } = await getServerConfigPublic();
    const status = await login(url);
    getWindow()?.focus(); // bring the app back to front after the browser detour
    return status;
  });
  ipcMain.handle('auth:logout', () => logout());

  ipcMain.handle('sync:preview', async (e) => {
    const { url } = await getServerConfigPublic();
    const bearer = await getValidAccessToken(url);
    const local = getLocalPeer();
    return previewSync(
      { localBase: local.base, localFetch: local.fetch, remote: { url, bearer } },
      (msg) => e.sender.send('sync:progress', msg),
    );
  });

  ipcMain.handle('sync:apply', async (e, selections: SyncSelection[]) => {
    const { url } = await getServerConfigPublic();
    const bearer = await getValidAccessToken(url);
    const local = getLocalPeer();
    return applySync(
      { localBase: local.base, localFetch: local.fetch, remote: { url, bearer } },
      selections ?? [],
      (msg) => e.sender.send('sync:progress', msg),
    );
  });
}
