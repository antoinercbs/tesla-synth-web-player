import { isAxiosError } from 'axios';

/** What the server said of a refused request (Nest: `message`, a string or a list), if anything. */
export function serverMessage(err: unknown): string | null {
  if (!isAxiosError(err)) return null;
  const m = (err.response?.data as { message?: unknown } | undefined)?.message;
  if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(' · ') || null;
  return typeof m === 'string' && m ? m : null;
}
