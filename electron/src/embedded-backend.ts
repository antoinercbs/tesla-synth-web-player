import { existsSync, promises as fs, readFileSync } from 'fs';
import { inject } from 'light-my-request';
import { join } from 'path';
import type { Fetcher } from './sync-engine';

/**
 * Runs the SAME compiled NestJS backend the hosted server runs, but IN-PROCESS:
 * it `require()`s the bundle, calls the exported `createApp()` (no `listen()`),
 * and serves requests by INJECTING them into the app's Express instance via
 * light-my-request — no TCP port, no forked HTTP server. The app:// protocol
 * handler (app-protocol.ts) and the sync engine talk to it through `dispatch()`.
 *
 * The fresh-DB one-shot `init-db` (applies the schema.sql baseline) also runs
 * in-process: it reuses the SAME native sqlite3 the in-process backend loads, so
 * everything lives in this process. (It used to be a utilityProcess.fork of
 * dist/scripts/init-db.js, but on Windows that forked process crashed during
 * Electron's bootstrap — asar fs-wrapper / integrity check — and exited 1 before
 * our code ran. Running in-process sidesteps that fork entirely.)
 */

export interface EmbeddedOptions {
  /** Folder containing dist/, node_modules/, schema.sql (resources/backend or nest-backend). */
  backendRoot: string;
  /** Per-user data dir (DB + uploads + electron downloads). */
  dataRoot: string;
}

export interface DispatchRequest {
  method: string;
  /** Path + query, e.g. "/api/songs?x=1". */
  url: string;
  headers: Record<string, string>;
  /** Raw request body (JSON or multipart); omit for GET/HEAD. */
  body?: Buffer;
}

export interface DispatchResponse {
  status: number;
  // light-my-request returns Node OutgoingHttpHeaders (values may be numbers).
  headers: Record<string, string | number | string[] | undefined>;
  body: Buffer;
}

export interface EmbeddedBackend {
  dispatch(req: DispatchRequest): Promise<DispatchResponse>;
  stop(): Promise<void>;
}

/** The slice of the Nest application we use (avoids needing @nestjs types here). */
interface InProcessNestApp {
  init(): Promise<unknown>;
  close(): Promise<unknown>;
  getHttpAdapter(): { getInstance(): unknown };
}
type BackendModule = { createApp: () => Promise<InProcessNestApp> };
type DispatchFunc = Parameters<typeof inject>[0];

function applyEnv(opts: EmbeddedOptions): void {
  // config/paths.ts reads these at import time, so they MUST be set before the
  // backend bundle is require()d below.
  process.env.NODE_ENV = 'production';
  process.env.DATA_ROOT = opts.dataRoot;
  process.env.DATABASE_PATH = join(opts.dataRoot, 'database.db');
  process.env.UPLOADS_DIR = join(opts.dataRoot, 'uploads');
  process.env.ELECTRON_DIR = join(opts.dataRoot, 'electron');
}

/** Minimal slice of the `sqlite3` module — just what applying the baseline needs. */
interface Sqlite3Database {
  exec(sql: string, cb: (err: Error | null) => void): void;
  close(cb?: (err: Error | null) => void): void;
}
interface Sqlite3Module {
  Database: new (
    path: string,
    cb?: (err: Error | null) => void,
  ) => Sqlite3Database;
}

/**
 * Applies the schema.sql baseline to a brand-new DB, IN-PROCESS — no fork.
 * Mirrors what dist/scripts/init-db.js did, but loads the native sqlite3 from
 * the backend's own node_modules (the bundle keeps sqlite3 external and resolves
 * it from there too), so it's the exact module the in-process backend uses.
 */
function runInitDb(opts: EmbeddedOptions): Promise<void> {
  // Resolve sqlite3 by absolute path: the backend tree (incl. its node_modules)
  // ships OUTSIDE the asar via extraResources, so this loads the real .node and
  // doesn't go through Node's normal asar-aware lookup from this file.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sqlite3 = require(
    join(opts.backendRoot, 'node_modules', 'sqlite3'),
  ) as Sqlite3Module;
  const schema = readFileSync(join(opts.backendRoot, 'schema.sql'), 'utf-8');
  const dbPath = join(opts.dataRoot, 'database.db');

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (openErr) => {
      if (openErr) {
        reject(new Error(`init-db: failed to open ${dbPath}: ${openErr.message}`));
        return;
      }
      db.exec(schema, (execErr) => {
        db.close(() => {
          if (execErr) {
            reject(new Error(`init-db: schema apply failed: ${execErr.message}`));
          } else {
            resolve();
          }
        });
      });
    });
  });
}

/**
 * Boots the in-process backend: ensures data dirs, runs the one-shot init-db on a
 * fresh install, then creates + initialises the Nest app (this is where TypeORM
 * migrations run) and returns a dispatch/stop handle. Awaiting this resolves only
 * once the backend is fully ready, so the caller can load the window with no race.
 */
export async function startEmbeddedBackend(
  opts: EmbeddedOptions,
): Promise<EmbeddedBackend> {
  const t0 = Date.now();
  const ms = (): number => Date.now() - t0;

  await Promise.all([
    fs.mkdir(join(opts.dataRoot, 'uploads'), { recursive: true }),
    fs.mkdir(join(opts.dataRoot, 'electron'), { recursive: true }),
  ]);

  applyEnv(opts);

  if (!existsSync(join(opts.dataRoot, 'database.db'))) {
    console.log(`[startup +${ms()}ms] first run — initialising database…`);
    await runInitDb(opts);
    console.log(`[startup +${ms()}ms] database initialised`);
  }

  console.log(`[startup +${ms()}ms] starting in-process backend…`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(join(opts.backendRoot, 'dist', 'main.js')) as BackendModule;
  const app = await mod.createApp();
  await app.init(); // registers routes + runs migrations (NO listen)
  const express = app.getHttpAdapter().getInstance() as DispatchFunc;
  console.log(`[startup +${ms()}ms] backend ready (in-process)`);

  const dispatch = async (req: DispatchRequest): Promise<DispatchResponse> => {
    const res = await inject(express, {
      method: req.method as 'GET',
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });
    return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
  };

  const stop = async (): Promise<void> => {
    try {
      await app.close();
    } catch {
      /* best-effort on quit */
    }
  };

  return { dispatch, stop };
}

const HOP_BY_HOP = new Set(['content-length', 'transfer-encoding', 'connection']);

/**
 * Adapts an EmbeddedBackend's `dispatch` into a `fetch`-shaped function, so the
 * sync engine can talk to the local in-process backend exactly like it talks to
 * the remote one over real HTTP. Serializes a Web FormData body to bytes +
 * boundary (so Multer parses the local /sync/file upload) and returns a real
 * Response (so `.ok`/`.json()`/`.arrayBuffer()` work unchanged).
 */
export function makeDispatchFetch(backend: EmbeddedBackend): Fetcher {
  return async (url, init = {}) => {
    const u = new URL(url);
    const headers: Record<string, string> = {};
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers)) headers[k] = v;
    }
    let body: Buffer | undefined;
    if (init.body != null) {
      if (typeof init.body === 'string') {
        body = Buffer.from(init.body);
      } else {
        // FormData/Blob/ArrayBuffer → materialize bytes + the multipart boundary.
        const r = new Request('http://local', { method: 'POST', body: init.body });
        body = Buffer.from(await r.arrayBuffer());
        const ct = r.headers.get('content-type');
        if (ct && !headers['content-type'] && !headers['Content-Type']) {
          headers['content-type'] = ct;
        }
      }
    }
    const res = await backend.dispatch({
      method: init.method ?? 'GET',
      url: u.pathname + u.search,
      headers,
      body,
    });
    const out = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v == null || HOP_BY_HOP.has(k.toLowerCase())) continue;
      for (const item of Array.isArray(v) ? v : [v]) out.append(k, String(item));
    }
    return new Response(res.body.length ? new Uint8Array(res.body) : null, {
      status: res.status,
      headers: out,
    });
  };
}
