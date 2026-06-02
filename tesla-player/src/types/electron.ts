// Shared types for the Electron desktop bridge injected by the preload.
// The bridge is ABSENT in the web build — always guard with `window.teslaElectron`.

export type TeslaEntityType = 'song' | 'playlist' | 'midiFile';
export type TeslaSyncChoice = 'local' | 'remote' | 'skip';

export interface TeslaServerConfigPublic {
  url: string;
  username: string;
  hasPassword: boolean;
}

export interface TeslaSyncDiffItem {
  type: TeslaEntityType;
  uuid: string;
  name: string;
  status: 'only-local' | 'only-remote' | 'conflict';
  localUpdatedAt: number | null;
  remoteUpdatedAt: number | null;
  defaultChoice: TeslaSyncChoice;
  /** Same content/name exists on the other side under a different id — syncing
   *  would create a duplicate (defaults to skip). */
  duplicate?: boolean;
}

export interface TeslaSyncDiff {
  serverUrl: string;
  items: TeslaSyncDiffItem[];
}

export interface TeslaSyncSelection {
  type: TeslaEntityType;
  uuid: string;
  choice: TeslaSyncChoice;
}

export interface TeslaApplyOutcome {
  pulled: number;
  pushed: number;
  warnings: string[];
}

/** A sync progress step: an i18n key (under `desktop.prog`) + optional params. */
export interface TeslaSyncProgress {
  key: string;
  params?: Record<string, string | number>;
}

export interface TeslaElectronBridge {
  isElectron: true;
  getServerConfig(): Promise<TeslaServerConfigPublic>;
  setServerConfig(cfg: {
    url: string;
    username: string;
    password?: string;
  }): Promise<TeslaServerConfigPublic>;
  previewSync(): Promise<TeslaSyncDiff>;
  applySync(selections: TeslaSyncSelection[]): Promise<TeslaApplyOutcome>;
  onSyncProgress(cb: (p: TeslaSyncProgress) => void): () => void;
  onOpenServerConfig(cb: () => void): () => void;
}

declare global {
  interface Window {
    teslaElectron?: TeslaElectronBridge;
  }
}
