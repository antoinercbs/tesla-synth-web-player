import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

/** What the renderer is allowed to see — never the raw password. */
export interface ServerConfigPublic {
  url: string;
  username: string;
  hasPassword: boolean;
}

/** What the main process keeps internally (password = base64 of encrypted). */
interface StoredConfig {
  url: string;
  username: string;
  password?: string;
}

/** What the renderer may send to update config. */
export interface ServerConfigInput {
  url: string;
  username: string;
  /** Omit/empty to keep the existing password unchanged. */
  password?: string;
}

const file = (): string => join(app.getPath('userData'), 'server-config.json');

async function read(): Promise<StoredConfig> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as StoredConfig;
  } catch {
    return { url: '', username: '' };
  }
}

export async function getServerConfigPublic(): Promise<ServerConfigPublic> {
  const c = await read();
  return {
    url: c.url || '',
    username: c.username || '',
    hasPassword: Boolean(c.password),
  };
}

/** Full config incl. decrypted password — main-process use only (sync calls). */
export async function getServerConfigSecret(): Promise<{
  url: string;
  username: string;
  password: string;
}> {
  const c = await read();
  let password = '';
  if (c.password) {
    try {
      const buf = Buffer.from(c.password, 'base64');
      password = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8');
    } catch {
      password = '';
    }
  }
  return { url: c.url || '', username: c.username || '', password };
}

export async function setServerConfig(
  input: ServerConfigInput,
): Promise<ServerConfigPublic> {
  const current = await read();
  const next: StoredConfig = {
    url: input.url ?? '',
    username: input.username ?? '',
  };
  if (input.password) {
    const enc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(input.password)
      : Buffer.from(input.password, 'utf8');
    next.password = enc.toString('base64');
  } else {
    // Empty/omitted password -> keep the existing one.
    next.password = current.password;
  }
  await fs.writeFile(file(), JSON.stringify(next), 'utf8');
  return getServerConfigPublic();
}
