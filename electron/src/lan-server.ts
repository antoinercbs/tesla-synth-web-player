import { app } from 'electron';
import { promises as fs } from 'fs';
import { createServer, type Server } from 'https';
import { networkInterfaces } from 'os';
import { join } from 'path';

/**
 * Optional HTTPS server on the local network, used ONLY for camera-assisted
 * tuning: the phone must reach the app to join a session, and browsers only
 * expose the camera to secure origins. The server wraps the SAME in-process
 * Nest/Express instance the app:// protocol talks to (so sessions are shared),
 * with a self-signed certificate generated once and cached in userData. The
 * phone shows a certificate warning the first time; that is expected.
 *
 * Started on demand from the tuning screen and stopped when the session ends
 * or the app quits. Nothing listens otherwise.
 */
export interface LanStatus {
  ok: boolean;
  running: boolean;
  port: number | null;
  /** Origins to reach this machine, most likely LAN address first. */
  urls: string[];
  error?: string;
}

interface SelfSignedPems {
  private: string;
  cert: string;
}
interface SelfSignedModule {
  generate(
    attrs: { name: string; value: string }[],
    options: Record<string, unknown>,
  ): SelfSignedPems | Promise<SelfSignedPems>;
}

const PREFERRED_PORT = 5443;
let server: Server | null = null;
let boundPort: number | null = null;
let detachLive: (() => void) | null = null;

/** IPv4 addresses of this machine, private LAN ranges first, loopback last. */
export function lanAddresses(): string[] {
  const out: { ip: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address;
      let rank = 3;
      if (ip.startsWith('192.168.')) rank = 0;
      else if (ip.startsWith('10.')) rank = 1;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) rank = 1;
      // virtual adapters (docker, vbox…) usually carry a telling name
      if (/docker|veth|br-|vbox|vmnet|virbr/i.test(name)) rank += 5;
      out.push({ ip, rank });
    }
  }
  out.sort((x, y) => x.rank - y.rank);
  return out.map((x) => x.ip);
}

async function loadOrCreateCert(ips: string[]): Promise<{ key: string; cert: string }> {
  const file = join(app.getPath('userData'), 'lan-cert.json');
  try {
    const j = JSON.parse(await fs.readFile(file, 'utf8')) as { key?: string; cert?: string; expires?: number; ips?: string[] };
    const sameIps = Array.isArray(j.ips) && ips.every((ip) => j.ips!.includes(ip));
    if (j.key && j.cert && typeof j.expires === 'number' && j.expires > Date.now() + 7 * 86_400_000 && sameIps) {
      return { key: j.key, cert: j.cert };
    }
  } catch {
    /* no cached certificate yet */
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const selfsigned = require('selfsigned') as SelfSignedModule;
  const days = 825; // the longest lifetime mobile browsers still accept
  const pems = await Promise.resolve(
    selfsigned.generate([{ name: 'commonName', value: 'tesla-player.local' }], {
      keySize: 2048,
      days,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: true },
        {
          name: 'subjectAltName',
          altNames: [{ type: 2, value: 'tesla-player.local' }, { type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip })), { type: 7, ip: '127.0.0.1' }],
        },
      ],
    }),
  );
  const rec = { key: pems.private, cert: pems.cert, expires: Date.now() + days * 86_400_000, ips };
  await fs.writeFile(file, JSON.stringify(rec), 'utf8');
  return { key: rec.key, cert: rec.cert };
}

function listen(srv: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      srv.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      srv.removeListener('error', onError);
      const addr = srv.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    };
    srv.once('error', onError);
    srv.once('listening', onListening);
    srv.listen(port, '0.0.0.0');
  });
}

/**
 * Starts (or reports) the LAN server on top of the in-process Express app.
 * `express` is the Nest HTTP adapter instance; null when the backend is not
 * in-process (plain dev mode), in which case LAN tuning is unavailable.
 * `attachLive` plugs the tuning WebSocket hub on the server's `upgrade` events
 * (the phone's live channel); it returns the detach function.
 */
export async function startLan(
  express: unknown | null,
  attachLive?: (server: Server) => () => void,
): Promise<LanStatus> {
  if (server && boundPort) return lanStatus();
  if (!express) return { ok: false, running: false, port: null, urls: [], error: 'backend-not-in-process' };
  const ips = lanAddresses();
  try {
    const { key, cert } = await loadOrCreateCert(ips);
    const srv = createServer({ key, cert }, express as Parameters<typeof createServer>[1]);
    let port: number;
    try {
      port = await listen(srv, PREFERRED_PORT);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      port = await listen(srv, 0);
    }
    server = srv;
    boundPort = port;
    detachLive = attachLive ? attachLive(srv) : null;
    srv.on('close', () => {
      if (server === srv) { server = null; boundPort = null; }
    });
    return lanStatus();
  } catch (e) {
    return { ok: false, running: false, port: null, urls: [], error: String((e as Error).message ?? e) };
  }
}

export function lanStatus(): LanStatus {
  if (!server || !boundPort) return { ok: true, running: false, port: null, urls: [] };
  const port = boundPort;
  const urls = lanAddresses().map((ip) => `https://${ip}:${port}`);
  return { ok: urls.length > 0, running: true, port, urls, error: urls.length ? undefined : 'no-lan-address' };
}

export function stopLan(): Promise<void> {
  return new Promise((resolve) => {
    const srv = server;
    server = null;
    boundPort = null;
    detachLive?.();
    detachLive = null;
    if (!srv) { resolve(); return; }
    srv.closeAllConnections?.();
    srv.close(() => resolve());
  });
}
