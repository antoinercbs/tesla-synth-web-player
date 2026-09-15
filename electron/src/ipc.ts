import { BrowserWindow, ipcMain } from 'electron';
import {
  getServerConfigPublic,
  setServerUrl,
  type ServerConfigInput,
} from './config-store';
import type { EmbeddedBackend } from './embedded-backend';
import { lanStatus, startLan, stopLan } from './lan-server';
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
  getBackend: () => EmbeddedBackend | null = () => null,
): void {
  // --- LAN HTTPS server for camera-assisted tuning (on demand) ---
  ipcMain.handle('lan:start', () => {
    const backend = getBackend();
    const hub = backend?.tuning ?? null;
    return startLan(backend?.express ?? null, hub ? (srv) => hub.attach(srv) : undefined);
  });
  ipcMain.handle('lan:stop', () => stopLan());
  ipcMain.handle('lan:status', () => lanStatus());

  // --- Live channel of a tuning session for the renderer (no socket over app://):
  // the same hub connection the phone gets over WebSocket, carried by IPC.
  interface TuningOpen { sid: string; id: string; token: string; after: number; who: 'desktop' | 'camera' }
  const liveConns = new Map<string, { onMessage(raw: unknown): void; dispose(): void }>();
  ipcMain.handle('tuning:open', (e, opts: TuningOpen) => {
    const hub = getBackend()?.tuning;
    if (!hub) return { ok: false, status: 503, message: 'backend-not-in-process' };
    const wc = e.sender;
    const sid = String(opts?.sid ?? '');
    if (!sid) return { ok: false, status: 400, message: 'missing sid' };
    try {
      const conn = hub.connect(String(opts.id), opts.token, Math.max(0, Number(opts.after) || 0), opts.who === 'camera' ? 'camera' : 'desktop', {
        send: (msg) => { if (!wc.isDestroyed()) wc.send('tuning:message', sid, msg); },
        close: () => { liveConns.delete(sid); },
      });
      liveConns.get(sid)?.dispose();
      liveConns.set(sid, conn);
      wc.once('destroyed', () => { conn.dispose(); liveConns.delete(sid); });
      return { ok: true };
    } catch (err) {
      const withStatus = err as { status?: number; getStatus?: () => number; message?: string };
      const status = typeof withStatus.getStatus === 'function' ? withStatus.getStatus() : withStatus.status ?? 500;
      return { ok: false, status, message: String(withStatus.message ?? err) };
    }
  });
  ipcMain.handle('tuning:send', (_e, sid: string, msg: unknown) => { liveConns.get(String(sid))?.onMessage(msg); });
  ipcMain.handle('tuning:close', (_e, sid: string) => {
    const c = liveConns.get(String(sid));
    liveConns.delete(String(sid));
    c?.dispose();
  });

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
