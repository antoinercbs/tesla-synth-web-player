import { utilityProcess, type UtilityProcess } from 'electron';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import { setTimeout as delay } from 'timers/promises';

export interface StartOptions {
  /** Folder containing dist/, node_modules/, schema.sql. */
  backendRoot: string;
  /** Built front-end served by the backend at '/'. */
  publicDir: string;
  /** Per-user data dir (DB + uploads + electron downloads). */
  dataRoot: string;
  /** Localhost port the backend should listen on. */
  port: number;
}

export interface BackendHandle {
  proc: UtilityProcess;
  stop: () => Promise<void>;
}

function backendEnv(opts: StartOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1', // never expose the embedded backend on the LAN
    PORT: String(opts.port),
    DATA_ROOT: opts.dataRoot,
    DATABASE_PATH: join(opts.dataRoot, 'database.db'),
    UPLOADS_DIR: join(opts.dataRoot, 'uploads'),
    ELECTRON_DIR: join(opts.dataRoot, 'electron'),
    PUBLIC_DIR: opts.publicDir,
  };
}

/** Runs init-db once (creates schema.sql baseline) on a brand-new data dir. */
function runInitDb(opts: StartOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(
      join(opts.backendRoot, 'dist/scripts/init-db.js'),
      [],
      { cwd: opts.backendRoot, env: backendEnv(opts), stdio: 'pipe' },
    );
    let errOut = '';
    let settled = false;
    // Never let a hung init-db block startup forever.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error('init-db timed out (>30s)'));
    }, 30000);
    child.stdout?.on('data', (b: Buffer) => process.stdout.write(`[init-db] ${b}`));
    child.stderr?.on('data', (b: Buffer) => {
      errOut += String(b);
      process.stderr.write(`[init-db] ${b}`);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      // Surface the child's actual error (e.g. SQL/path) in the dialog, not just a code.
      const tail = errOut.trim().split('\n').slice(-3).join(' ');
      reject(new Error(`init-db exited with ${code}${tail ? `: ${tail}` : ''}`));
    });
  });
}

async function waitForReady(port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ping`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await delay(150);
  }
  throw new Error(
    `Backend not ready on :${port} after ${timeoutMs}ms${
      lastErr ? ` (${String(lastErr)})` : ''
    }`,
  );
}

/**
 * Forks the compiled NestJS backend (the same dist/main.js Docker runs) as an
 * Electron utility process, waits for /api/ping, and returns a stop() handle.
 */
export async function startBackend(opts: StartOptions): Promise<BackendHandle> {
  const t0 = Date.now();
  const ms = (): number => Date.now() - t0;
  await fs.mkdir(join(opts.dataRoot, 'uploads'), { recursive: true });
  await fs.mkdir(join(opts.dataRoot, 'electron'), { recursive: true });

  if (!existsSync(join(opts.dataRoot, 'database.db'))) {
    console.log(`[startup +${ms()}ms] first run — initialising database…`);
    await runInitDb(opts);
    console.log(`[startup +${ms()}ms] database initialised`);
  }

  console.log(`[startup +${ms()}ms] forking backend on :${opts.port}…`);
  const proc = utilityProcess.fork(join(opts.backendRoot, 'dist/main.js'), [], {
    cwd: opts.backendRoot,
    env: backendEnv(opts),
    stdio: 'pipe',
  });
  proc.stdout?.on('data', (b: Buffer) => process.stdout.write(`[backend] ${b}`));
  proc.stderr?.on('data', (b: Buffer) => process.stderr.write(`[backend] ${b}`));

  await waitForReady(opts.port);
  console.log(`[startup +${ms()}ms] backend ready`);

  const stop = (): Promise<void> =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      proc.once('exit', finish);
      try {
        proc.kill();
      } catch {
        finish();
      }
      setTimeout(finish, 3000); // never hang the quit
    });

  return { proc, stop };
}
