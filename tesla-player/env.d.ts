/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The Electron bridge types + the `window.teslaElectron` augmentation live in
// src/types/electron.ts (an importable module).
