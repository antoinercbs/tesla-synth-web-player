/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
  /** "1" in the showcase site's build (`vite build --mode site`, .env.site). */
  readonly VITE_SITE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json's version, set by vite.config.js. */
declare const __APP_VERSION__: string;

// The Electron bridge types + the `window.teslaElectron` augmentation live in
// src/types/electron.ts (an importable module).
