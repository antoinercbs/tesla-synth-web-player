// Bundles the compiled NestJS backend (nest-backend/dist) into a couple of
// self-contained CommonJS files with esbuild, so the desktop app ships a few MB
// of JS instead of the whole ~85 MB prod node_modules. The TypeScript is
// compiled by `nest build` first (so decorator metadata is already emitted into
// the .js); we only bundle the emitted JS here.
//
// Only the native sqlite3 (and DB drivers TypeORM lazy-loads but we never use)
// stay external — sqlite3 is shipped as a tiny standalone node_modules and
// rebuilt for Electron's ABI. `keepNames` is required: NestJS/TypeORM rely on
// class/function names at runtime.
//
// Usage: node scripts/bundle-backend.mjs <nestRoot> <outDir>
import { build } from 'esbuild';
import { resolve } from 'path';

const nestRoot = resolve(process.argv[2] ?? '../nest-backend');
const outdir = resolve(process.argv[3] ?? './resources/backend/dist');

// Native + every optional DB driver TypeORM may `require(name)` by string, plus
// the optional Nest transports loaded lazily by @nestjs/core. None are used at
// runtime (we only open sqlite), so leaving them as unresolved external
// requires is safe — the code paths that would require them never execute.
const external = [
  'sqlite3',
  'better-sqlite3',
  'mysql',
  'mysql2',
  'pg',
  'pg-native',
  'pg-query-stream',
  'oracledb',
  'mssql',
  'mongodb',
  'redis',
  'ioredis',
  'sql.js',
  'react-native-sqlite-storage',
  '@sap/hana-client',
  '@sap/hdbext',
  'hdb-pool',
  'typeorm-aurora-data-api-driver',
  '@google-cloud/spanner',
  '@nestjs/microservices',
  '@nestjs/microservices/*',
  '@nestjs/websockets',
  '@nestjs/websockets/*',
  '@nestjs/platform-socket.io',
  '@nestjs/platform-fastify',
  '@nestjs/platform-ws',
  'fastify',
  '@fastify/static',
  '@fastify/middie',
  'cache-manager',
];

await build({
  entryPoints: [
    resolve(nestRoot, 'dist/main.js'),
    resolve(nestRoot, 'dist/scripts/init-db.js'),
  ],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: true,
  keepNames: true, // NestJS DI / TypeORM rely on runtime names
  outdir,
  outbase: resolve(nestRoot, 'dist'),
  external,
  logLevel: 'warning',
});

console.log(`[bundle-backend] bundled main.js + scripts/init-db.js -> ${outdir}`);
