// Stages the backend + front-end into electron/resources/ for packaging.
//
// The NestJS backend is BUNDLED with esbuild (see bundle-backend.mjs) into a
// couple of self-contained files, so we ship ~3 MB of JS + a tiny sqlite3-only
// node_modules instead of the whole ~85 MB prod dependency tree. Run after
// `build:front` + `build:back` (which produce tesla-player/dist and
// nest-backend/dist).
import { execSync } from 'child_process';
import { cp, copyFile, mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = resolve(fileURLToPath(import.meta.url), '..', '..'); // electron/
const repo = resolve(here, '..');
const nestRoot = join(repo, 'nest-backend');
const frontDist = join(repo, 'tesla-player', 'dist');
const resBackend = join(here, 'resources', 'backend');
const resPublic = join(here, 'resources', 'public');

await rm(join(here, 'resources'), { recursive: true, force: true });
await mkdir(resBackend, { recursive: true });
await mkdir(resPublic, { recursive: true });

// 1) Bundle the compiled backend (dist/main.js + dist/scripts/init-db.js).
console.log('[stage] bundling backend with esbuild ...');
execSync(
  `node ${JSON.stringify(join(here, 'scripts', 'bundle-backend.mjs'))} ` +
    `${JSON.stringify(nestRoot)} ${JSON.stringify(join(resBackend, 'dist'))}`,
  { stdio: 'inherit' },
);

// 2) Schema baseline (read on first run by init-db).
await copyFile(join(nestRoot, 'schema.sql'), join(resBackend, 'schema.sql'));

// 3) Minimal node_modules: only the native sqlite3 (everything else is bundled).
//    A fresh install of just sqlite3 pulls its small runtime deps; it is then
//    rebuilt for Electron's ABI by the `rebuild:native` step.
const nestPkg = JSON.parse(await readFile(join(nestRoot, 'package.json'), 'utf8'));
const sqliteVersion = nestPkg.dependencies.sqlite3;
await writeFile(
  join(resBackend, 'package.json'),
  JSON.stringify(
    {
      name: 'tesla-player-backend-runtime',
      version: nestPkg.version,
      private: true,
      dependencies: { sqlite3: sqliteVersion },
    },
    null,
    2,
  ),
);
console.log(`[stage] installing sqlite3@${sqliteVersion} (runtime-only) ...`);
execSync('npm install --omit=dev --no-audit --no-fund', {
  cwd: resBackend,
  stdio: 'inherit',
});

// 4) Front-end bundle (built with empty VITE_BASE_URL -> same-origin /api).
await cp(frontDist, resPublic, { recursive: true });

console.log('[stage] done: resources/backend (bundled) + resources/public ready.');
