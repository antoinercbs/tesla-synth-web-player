import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

/** What the renderer is allowed to see (no tokens, ever). */
export interface ServerConfigPublic {
  url: string;
}

/** What the renderer may send to update config. */
export interface ServerConfigInput {
  url: string;
}

/** OIDC tokens for sync — main-process only, refresh token encrypted at rest. */
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Cached display name ("prénom nom") for the sign-in UI. */
  displayName?: string;
}

/** On-disk shape. `tokens` is base64 of the encrypted StoredTokens JSON. */
interface StoredConfig {
  url: string;
  tokens?: string;
}

const file = (): string => join(app.getPath('userData'), 'server-config.json');

async function read(): Promise<StoredConfig> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as StoredConfig;
  } catch {
    return { url: '' };
  }
}

async function write(cfg: StoredConfig): Promise<void> {
  await fs.writeFile(file(), JSON.stringify(cfg), 'utf8');
}

function encrypt(plain: string): string {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain)
    : Buffer.from(plain, 'utf8');
  return buf.toString('base64');
}

function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(buf)
    : buf.toString('utf8');
}

export async function getServerConfigPublic(): Promise<ServerConfigPublic> {
  const c = await read();
  return { url: c.url || '' };
}

/** Sets the remote server URL, preserving any stored tokens. */
export async function setServerUrl(
  input: ServerConfigInput,
): Promise<ServerConfigPublic> {
  const current = await read();
  await write({ url: input.url ?? '', tokens: current.tokens });
  return getServerConfigPublic();
}

export async function getStoredTokens(): Promise<StoredTokens | null> {
  const c = await read();
  if (!c.tokens) return null;
  try {
    return JSON.parse(decrypt(c.tokens)) as StoredTokens;
  } catch {
    return null;
  }
}

export async function setStoredTokens(tokens: StoredTokens): Promise<void> {
  const current = await read();
  await write({ url: current.url || '', tokens: encrypt(JSON.stringify(tokens)) });
}

export async function clearStoredTokens(): Promise<void> {
  const current = await read();
  await write({ url: current.url || '' });
}
