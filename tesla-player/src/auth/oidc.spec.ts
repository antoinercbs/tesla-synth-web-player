import { beforeEach, describe, it, expect, vi } from 'vitest';

/** What the fake IdP client holds and answers, set per test. */
const idp = {
  stored: null as null | { expired: boolean; refresh_token?: string; state?: unknown },
  renew: null as null | { expired: boolean },
  callbackError: null as null | { error: string; state: unknown },
  redirects: [] as unknown[],
  removed: 0,
};

vi.mock('oidc-client-ts', () => {
  class ErrorResponse extends Error {
    error: string;
    state: unknown;
    constructor(args: { error: string; userState?: unknown }) {
      super(args.error);
      this.error = args.error;
      this.state = args.userState;
    }
  }
  class UserManager {
    events = { addUserLoaded: () => {}, addUserUnloaded: () => {} };
    async getUser() { return idp.stored; }
    async signinSilent() {
      if (!idp.renew) throw new Error('invalid_grant');
      return idp.renew;
    }
    async signinRedirect(args: unknown) { idp.redirects.push(args); }
    async signinRedirectCallback() {
      if (idp.callbackError) throw new ErrorResponse({ error: idp.callbackError.error, userState: idp.callbackError.state });
      return { expired: false, state: '/play' };
    }
    async removeUser() { idp.removed++; idp.stored = null; }
  }
  return { ErrorResponse, UserManager, User: class {}, WebStorageStateStore: class {} };
});

function storage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const CONFIG = { enabled: true, issuer: 'https://idp', clientId: 'tesla-player' };

async function freshOidc() {
  vi.resetModules();
  const oidc = await import('./oidc');
  await oidc.initOidc(CONFIG);
  return oidc;
}

beforeEach(() => {
  Object.assign(idp, { stored: null, renew: null, callbackError: null, redirects: [], removed: 0 });
  vi.stubGlobal('window', { location: { origin: 'http://app' }, localStorage: storage() });
  vi.stubGlobal('sessionStorage', storage());
});

describe('a session kept from an earlier visit', () => {
  it('is renewed at start when its access token has expired', async () => {
    idp.stored = { expired: true, refresh_token: 'r' };
    idp.renew = { expired: false };
    const oidc = await freshOidc();
    expect(oidc.getCurrentUser()).toBe(idp.renew);
  });

  it('is used as it is while its access token lives', async () => {
    idp.stored = { expired: false, refresh_token: 'r' };
    const oidc = await freshOidc();
    expect(oidc.getCurrentUser()).toBe(idp.stored);
  });
});

describe('the silent check with the IdP', () => {
  it('asks once per tab, without a page of its own, for a browser that signed in before', async () => {
    idp.stored = { expired: true, refresh_token: 'dead' };
    const oidc = await freshOidc();
    expect(oidc.getCurrentUser()).toBeNull();
    expect(await oidc.checkSso('/edit/3')).toBe(true);
    expect(idp.redirects).toEqual([{ prompt: 'none', state: '/edit/3' }]);
    expect(await oidc.checkSso('/edit/3')).toBe(false);
    expect(idp.redirects).toHaveLength(1);
  });

  it('never bothers a visitor who never signed in', async () => {
    const oidc = await freshOidc();
    expect(await oidc.checkSso('/play')).toBe(false);
    expect(idp.redirects).toEqual([]);
  });

  it('takes "no session" back to the page asked for, and forgets the old session', async () => {
    idp.stored = { expired: true };
    const oidc = await freshOidc();
    idp.callbackError = { error: 'login_required', state: '/edit/3' };
    expect(await oidc.completeLogin()).toBe('/edit/3');
    expect(idp.removed).toBe(1);
    sessionStorage.removeItem('tp_auth_sso_at');
    expect(await oidc.checkSso('/play')).toBe(false);
  });

  it('still reports a real sign-in failure', async () => {
    const oidc = await freshOidc();
    idp.callbackError = { error: 'access_denied', state: '/play' };
    await expect(oidc.completeLogin()).rejects.toThrow('access_denied');
  });
});
