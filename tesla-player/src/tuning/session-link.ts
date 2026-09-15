import axios from 'axios';
import type { EventMap, EventType, HubClientMessage, HubServerMessage, SessionEvent, SessionInfo, Side } from './protocol';

/**
 * Client side of the tuning relay: one live channel per side, both directions
 * on it.
 *
 *  - `ws`   WebSocket on `/api/tuning/sessions/:id/ws` (web, and the phone in
 *           desktop mode over the LAN server). Events and presence are pushed;
 *           publishing goes up the same socket and is acknowledged with the
 *           sequence number. Reconnects with `after=` so nothing is lost, and
 *           falls back to SSE / polling if the socket can never open (a proxy
 *           that does not upgrade, an expired session — the REST calls then
 *           report the real HTTP status).
 *  - `ipc`  the desktop app's renderer: the same channel through the main
 *           process, since nothing can upgrade over the in-process `app://`
 *           transport.
 *  - `sse`  / `poll`  the previous carriers, kept as fallbacks. Publishing is
 *           then a POST and presence a 5 s heartbeat.
 *
 * `base` is the API origin ('' for same-origin / axios default, or the LAN
 * server URL on the phone in desktop mode); `token` rides in a header for the
 * REST calls and in the query string for the socket / SSE stream.
 */
export type Transport = 'ws' | 'ipc' | 'sse' | 'poll';

export interface SessionLinkOptions {
  base?: string;
  id: string;
  token: string;
  side: Side;
  /** Force a carrier. Default: `ipc` in the desktop app, else `ws`, else `sse`, else `poll`. */
  transport?: Transport;
  pollMs?: number;
}

type Listener = (ev: SessionEvent) => void;
const ACK_TIMEOUT_MS = 4000;
/** How long a publish waits for a channel that is still opening before using POST. */
const CHANNEL_WAIT_MS = 1500;
const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;

export class SessionLink {
  readonly id: string;
  readonly side: Side;
  private readonly base: string;
  private readonly token: string;
  private transport: Transport;
  private readonly pollMs: number;
  private lastSeq = 0;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: LinkState) => void>();
  private closed = false;
  /** The hub told us the session is gone: stop reconnecting. */
  private gone = false;
  private _state: LinkState = { connected: false, info: null, error: null };
  // live channel (ws / ipc)
  private ws: WebSocket | null = null;
  private ipcSid: string | null = null;
  private ipcOff: (() => void) | null = null;
  private pending = new Map<number, { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextMsgId = 1;
  private wsAttempt = 0;
  private wsOpenedOnce = false;
  /** Sends issued while the channel is still opening wait for it (bounded). */
  private channelWaiters: (() => void)[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  // fallbacks
  private es: EventSource | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SessionLinkOptions) {
    this.id = opts.id;
    this.token = opts.token;
    this.side = opts.side;
    this.base = (opts.base ?? '').replace(/\/$/, '');
    this.transport = opts.transport ?? SessionLink.defaultTransport();
    this.pollMs = opts.pollMs ?? 400;
  }

  static defaultTransport(): Transport {
    if (typeof window !== 'undefined' && window.teslaElectron?.tuningOpen) return 'ipc';
    if (typeof WebSocket === 'function') return 'ws';
    if (typeof EventSource === 'function') return 'sse';
    return 'poll';
  }

  get state(): LinkState { return this._state; }
  get lastSequence(): number { return this.lastSeq; }
  /** The carrier in use right now (it can change after a fallback). */
  get carrier(): Transport { return this.transport; }

  private url(path: string): string {
    return `${this.base}/api/tuning/sessions/${encodeURIComponent(this.id)}${path}`;
  }
  private headers(): Record<string, string> {
    return { 'x-tuning-token': this.token };
  }

  /** Start receiving. Idempotent. */
  open(): void {
    if (this.closed) return;
    switch (this.transport) {
      case 'ws': this.openWs(); break;
      case 'ipc': void this.openIpc(); break;
      case 'sse': this.openSse(); this.startHeartbeat(); break;
      default: this.schedulePoll(0); this.startHeartbeat();
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopPing();
    const ws = this.ws; this.ws = null;
    try { ws?.close(1000, 'bye'); } catch { /* already closed */ }
    if (this.ipcSid) { const sid = this.ipcSid; this.ipcSid = null; void window.teslaElectron?.tuningClose?.(sid); }
    if (this.ipcOff) { this.ipcOff(); this.ipcOff = null; }
    this.failPending();
    this.es?.close(); this.es = null;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.setState({ connected: false });
  }

  /** Ends the session server-side (desktop). */
  async terminate(): Promise<void> {
    try { await axios.delete(this.url(''), { headers: this.headers() }); } catch { /* best effort */ }
    this.close();
  }

  async info(): Promise<SessionInfo> {
    const r = await axios.get<SessionInfo>(this.url(''), { headers: this.headers() });
    this.setState({ info: r.data });
    return r.data;
  }

  /**
   * Publish a typed event: over the live channel when it is open (acknowledged
   * by the hub), else by POST. Errors are reported through state, never thrown.
   */
  async send<K extends EventType>(type: K, payload: EventMap[K]): Promise<boolean> {
    if (!this.channelOpen && this.channelOpening) await this.waitChannel(CHANNEL_WAIT_MS);
    if (this.channelOpen) {
      if (await this.sendOverChannel(type, payload)) return true;
      if (this.gone || this.closed) return false;
    }
    try {
      await axios.post(this.url('/events'), { from: this.side, type, payload }, { headers: this.headers() });
      return true;
    } catch (e) {
      this.setState({ error: describe(e) });
      return false;
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onState(listener: (s: LinkState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this._state);
    return () => this.stateListeners.delete(listener);
  }

  private setState(patch: Partial<LinkState>): void {
    this._state = { ...this._state, ...patch };
    for (const l of this.stateListeners) l(this._state);
  }

  private deliver(ev: SessionEvent): void {
    if (ev.seq <= this.lastSeq) return;
    this.lastSeq = ev.seq;
    if (ev.from === this.side) return; // our own echoes
    for (const l of this.listeners) l(ev);
  }

  /* ------------------------------------------------------- live channel */
  private get channelOpen(): boolean {
    if (!this._state.connected) return false; // `connected` = the hub's hello arrived on this channel
    return (this.ws != null && this.ws.readyState === WebSocket.OPEN) || this.ipcSid != null;
  }
  private get channelOpening(): boolean {
    if (this.closed || this.gone) return false;
    if (this.transport === 'ws') return this.ws != null || this.reconnectTimer != null;
    if (this.transport === 'ipc') return this.ipcOpening;
    return false;
  }
  private ipcOpening = false;
  private waitChannel(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => { if (done) return; done = true; clearTimeout(t); resolve(); };
      const t = setTimeout(finish, ms);
      this.channelWaiters.push(finish);
    });
  }
  private wakeWaiters(): void {
    const w = this.channelWaiters; this.channelWaiters = [];
    for (const f of w) f();
  }

  private sendOverChannel(type: string, payload: unknown): Promise<boolean> {
    const id = this.nextMsgId++;
    const msg: HubClientMessage = { kind: 'publish', id, type, payload };
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(false); }, ACK_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
        else if (this.ipcSid) void window.teslaElectron!.tuningSend!(this.ipcSid, msg);
        else throw new Error('no channel');
      } catch {
        clearTimeout(timer); this.pending.delete(id); resolve(false);
      }
    });
  }

  private failPending(): void {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(false); }
    this.pending.clear();
  }

  private onHubMessage(msg: HubServerMessage): void {
    switch (msg.kind) {
      case 'hello':
        this.wsOpenedOnce = true; this.wsAttempt = 0;
        this.setState({ connected: true, info: msg.info, error: null });
        this.wakeWaiters();
        break;
      case 'event': this.deliver(msg.event); break;
      case 'info': this.setState({ info: msg.info }); break;
      case 'ack': {
        const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
        if (p && typeof msg.id === 'number') { clearTimeout(p.timer); this.pending.delete(msg.id); p.resolve(true); }
        break;
      }
      case 'error': {
        const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
        if (p && typeof msg.id === 'number') { clearTimeout(p.timer); this.pending.delete(msg.id); p.resolve(false); }
        this.setState({ error: msg.status === 404 ? 'session-gone' : msg.status === 401 ? 'session-token' : msg.message });
        break;
      }
      case 'pong': if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; } break;
      case 'closed':
        this.gone = true;
        this.setState({ connected: false, error: 'session-gone' });
        break;
    }
  }

  /* --------------------------------------------------------------- ws */
  private wsUrl(): string {
    const base = this.base || axios.defaults.baseURL || '';
    const u = new URL(`${base}/api/tuning/sessions/${encodeURIComponent(this.id)}/ws`, window.location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = `?token=${encodeURIComponent(this.token)}&after=${this.lastSeq}&who=${this.side}`;
    return u.toString();
  }

  private openWs(): void {
    if (this.closed || this.gone || this.ws) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.wsUrl()); } catch { this.fallback(); return; }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => { opened = true; this.startPing(); };
    ws.onmessage = (m: MessageEvent<string>) => {
      try { this.onHubMessage(JSON.parse(m.data) as HubServerMessage); } catch { /* ignore malformed */ }
    };
    ws.onerror = () => { /* close follows */ };
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.failPending();
      this.setState({ connected: false });
      if (this.closed) { this.wakeWaiters(); return; }
      if (e.code === 4404 || e.code === 4401) {
        this.gone = true;
        this.setState({ error: e.code === 4401 ? 'session-token' : 'session-gone' });
        return;
      }
      if (this.gone) return;
      if (!opened && !this.wsOpenedOnce) {
        // never got through: after a few tries assume the socket is blocked
        // (proxy, expired session…) and let the REST carriers explain
        this.wsAttempt++;
        if (this.wsAttempt >= 3) { this.fallback(); return; }
      }
      const delay = Math.min(4000, 500 * 2 ** Math.min(3, this.wsAttempt++));
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.openWs(); }, delay);
    };
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ kind: 'ping' } satisfies HubClientMessage)); } catch { return; }
      if (!this.pongTimer) {
        this.pongTimer = setTimeout(() => { this.pongTimer = null; try { ws.close(4000, 'no pong'); } catch { /* closing */ } }, PONG_TIMEOUT_MS);
      }
    }, PING_MS);
  }
  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  /** Socket unusable: continue on SSE (or polling), which report HTTP statuses. */
  private fallback(): void {
    this.wakeWaiters();
    if (this.closed) return;
    this.transport = typeof EventSource === 'function' ? 'sse' : 'poll';
    this.startHeartbeat();
    if (this.transport === 'sse') this.openSse();
    else this.schedulePoll(0);
  }

  /* -------------------------------------------------------------- ipc */
  private async openIpc(): Promise<void> {
    const bridge = window.teslaElectron;
    if (!bridge?.tuningOpen || !bridge.onTuningMessage) { this.transport = 'poll'; this.open(); return; }
    const sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // listen before opening: the hello is pushed while the open call is still in flight
    this.ipcOff = bridge.onTuningMessage((s, msg) => { if (s === sid) this.onHubMessage(msg as HubServerMessage); });
    this.ipcOpening = true;
    this.ipcSid = sid; // usable as soon as the hello arrives (it is pushed before the open call returns)
    let r: { ok: boolean; status?: number; message?: string };
    try { r = await bridge.tuningOpen({ sid, id: this.id, token: this.token, after: this.lastSeq, who: this.side }); } catch (e) { r = { ok: false, status: 500, message: describe(e) }; } finally { this.ipcOpening = false; }
    if (this.closed) { this.ipcSid = null; void bridge.tuningClose?.(sid); this.wakeWaiters(); return; }
    if (!r.ok) {
      this.ipcSid = null;
      this.wakeWaiters();
      if (this.ipcOff) { this.ipcOff(); this.ipcOff = null; }
      if (r.status === 404 || r.status === 401) { this.gone = true; this.setState({ connected: false, error: r.status === 401 ? 'session-token' : 'session-gone' }); return; }
      // no in-process hub (plain dev mode): poll over HTTP instead
      this.transport = 'poll'; this.open();
      return;
    }
    this.wakeWaiters();
  }

  /* ------------------------------------------------------------------ SSE */
  private startHeartbeat(): void {
    // presence for the REST carriers: the hub marks a side online for 15 s after any call
    if (this.heartbeatTimer || this.closed) return;
    this.heartbeatTimer = setInterval(() => {
      void axios
        .post<SessionInfo>(this.url(`/heartbeat?who=${this.side}`), null, { headers: this.headers() })
        .then((r) => this.setState({ info: r.data, error: null }))
        .catch((e: unknown) => this.setState({ error: describe(e) }));
    }, 5000);
  }

  private openSse(): void {
    if (this.es || this.closed) return;
    const u = `${this.url('/events')}?token=${encodeURIComponent(this.token)}&after=${this.lastSeq}&who=${this.side}`;
    const es = new EventSource(u);
    this.es = es;
    es.onopen = () => this.setState({ connected: true, error: null });
    es.onmessage = (m: MessageEvent<string>) => {
      try { this.deliver(JSON.parse(m.data) as SessionEvent); } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      // EventSource retries by itself while the server is reachable; if the
      // stream was refused (expired session) it keeps failing: surface it and
      // fall back to polling, which reports the HTTP status.
      this.setState({ connected: false });
      if (es.readyState === EventSource.CLOSED) {
        es.close(); this.es = null;
        this.transport = 'poll';
        this.schedulePoll(this.pollMs * 2);
      }
    };
  }

  /* ------------------------------------------------------------- polling */
  private schedulePoll(delay: number): void {
    if (this.closed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.pollOnce(), delay);
  }

  private async pollOnce(): Promise<void> {
    if (this.closed) return;
    try {
      const r = await axios.get<{ events: SessionEvent[]; info: SessionInfo }>(
        this.url(`/poll?after=${this.lastSeq}&who=${this.side}`),
        { headers: this.headers() },
      );
      this.setState({ connected: true, info: r.data.info, error: null });
      for (const ev of r.data.events) this.deliver(ev);
      this.schedulePoll(this.pollMs);
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      this.setState({ connected: false, error: describe(e) });
      if (status === 404 || status === 401) { this.gone = true; return; } // gone: stop, the UI shows the error
      this.schedulePoll(this.pollMs * 4);
    }
  }
}

export interface LinkState {
  connected: boolean;
  info: SessionInfo | null;
  error: string | null;
}

function describe(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const st = e.response?.status;
    if (st === 404) return 'session-gone';
    if (st === 401) return 'session-token';
    return e.message || 'network';
  }
  return e instanceof Error ? e.message : String(e);
}

/** Creates a session (desktop). Returns id + token + the camera path to encode in the QR. */
export async function createSession(): Promise<{ id: string; token: string; expiresAt: number }> {
  const r = await axios.post<{ id: string; token: string; createdAt: number; expiresAt: number }>('/api/tuning/sessions');
  return { id: r.data.id, token: r.data.token, expiresAt: r.data.expiresAt };
}

/** The URL the phone opens; the token rides in the fragment so it never reaches server logs. */
export function cameraUrl(origin: string, id: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/tune/cam/${encodeURIComponent(id)}#${encodeURIComponent(token)}`;
}
