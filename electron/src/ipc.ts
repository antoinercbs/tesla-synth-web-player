import { ipcMain } from 'electron';
import {
  getServerConfigPublic,
  getServerConfigSecret,
  setServerConfig,
  type ServerConfigInput,
} from './config-store';
import { applySync, previewSync, type SyncSelection } from './sync-engine';

/**
 * Wires the preload bridge to the main-process logic. The remote credentials
 * never cross into the renderer: the sync HTTP calls run here, in main.
 */
export function registerIpc(getLocalBase: () => string): void {
  ipcMain.handle('server-config:get', () => getServerConfigPublic());
  ipcMain.handle('server-config:set', (_e, cfg: ServerConfigInput) =>
    setServerConfig(cfg),
  );

  ipcMain.handle('sync:preview', async (e) => {
    const remote = await getServerConfigSecret();
    return previewSync({ localBase: getLocalBase(), remote }, (msg) =>
      e.sender.send('sync:progress', msg),
    );
  });

  ipcMain.handle('sync:apply', async (e, selections: SyncSelection[]) => {
    const remote = await getServerConfigSecret();
    return applySync({ localBase: getLocalBase(), remote }, selections ?? [], (msg) =>
      e.sender.send('sync:progress', msg),
    );
  });
}
