import { BrowserWindow, ipcMain } from 'electron';
import {
  getServerConfigPublic,
  setServerUrl,
  type ServerConfigInput,
} from './config-store';
import { getStatus, getValidAccessToken, login, logout } from './oidc-auth';
import { applySync, previewSync, type SyncSelection } from './sync-engine';

/**
 * Wires the preload bridge to the main-process logic. Tokens never cross into
 * the renderer: the OIDC flow and the sync HTTP calls run here, in main.
 */
export function registerIpc(
  getLocalBase: () => string,
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
    return previewSync({ localBase: getLocalBase(), remote: { url, bearer } }, (msg) =>
      e.sender.send('sync:progress', msg),
    );
  });

  ipcMain.handle('sync:apply', async (e, selections: SyncSelection[]) => {
    const { url } = await getServerConfigPublic();
    const bearer = await getValidAccessToken(url);
    return applySync(
      { localBase: getLocalBase(), remote: { url, bearer } },
      selections ?? [],
      (msg) => e.sender.send('sync:progress', msg),
    );
  });
}
