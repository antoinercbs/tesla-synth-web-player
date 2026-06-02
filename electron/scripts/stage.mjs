// Stages the built backend + front-end into electron/resources/ for packaging.
// Non-destructive: installs a PROD-only node_modules inside resources/backend
// (a fresh `npm ci --omit=dev`), so the dev nest-backend/node_modules is left
// intact. Run after `build:front` + `build:back`.
import { execSync } from 'child_process';
import { cp, copyFile, mkdir, rm } from 'fs/promises';
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

// Backend: compiled output + the schema baseline + manifest files for the install.
await cp(join(nestRoot, 'dist'), join(resBackend, 'dist'), { recursive: true });
await copyFile(join(nestRoot, 'schema.sql'), join(resBackend, 'schema.sql'));
await copyFile(join(nestRoot, 'package.json'), join(resBackend, 'package.json'));
await copyFile(
  join(nestRoot, 'package-lock.json'),
  join(resBackend, 'package-lock.json'),
);

// Prod-only deps (includes native sqlite3, rebuilt for Electron in a later step).
console.log('[stage] installing prod backend deps into resources/backend ...');
execSync('npm ci --omit=dev', { cwd: resBackend, stdio: 'inherit' });

// Front-end bundle (built with an empty VITE_BASE_URL -> same-origin /api).
await cp(frontDist, resPublic, { recursive: true });

console.log('[stage] done: resources/backend + resources/public ready.');
