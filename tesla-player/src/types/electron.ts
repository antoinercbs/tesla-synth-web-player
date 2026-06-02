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
  onSyncProgress(cb: (message: string) => void): () => void;
  onOpenServerConfig(cb: () => void): () => void;
}

declare global {
  interface Window {
    teslaElectron?: TeslaElectronBridge;
  }
}
