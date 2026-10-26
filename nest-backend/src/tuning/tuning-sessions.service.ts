import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Observable, Subject, concat, from } from 'rxjs';
import { filter } from 'rxjs/operators';

/** One relayed message. The hub never looks inside `payload`. */
export interface TuningEvent {
  seq: number;
  at: number;
  from: 'desktop' | 'camera';
  type: string;
  payload?: unknown;
}

export interface TuningSessionInfo {
  id: string;
  createdAt: number;
  expiresAt: number;
  /** Highest sequence number published so far. */
  seq: number;
  /** A camera posted or subscribed in the last 15 s. */
  cameraOnline: boolean;
  /** A desktop posted or subscribed in the last 15 s. */
  desktopOnline: boolean;
}

interface Session {
  id: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  seq: number;
  /** Ring of the most recent events (for late joiners / polling). */
  events: TuningEvent[];
  subject: Subject<TuningEvent>;
  /** Presence changes (a socket opened/closed), for pushing `info` to live connections. */
  info$: Subject<TuningSessionInfo>;
  lastCameraAt: number;
  lastDesktopAt: number;
  /** Open live connections (WebSocket / in-process) per side. */
  sockets: { desktop: number; camera: number };
}

/** What a live connection gets from the hub. */
export interface LiveSubscription {
  info: TuningSessionInfo;
  /** Events already in the ring after the requested sequence number. */
  backlog: TuningEvent[];
  events$: Observable<TuningEvent>;
  /** Emits whenever a side comes online / goes offline; completes when the session closes. */
  info$: Observable<TuningSessionInfo>;
  release: () => void;
}

const TTL_MS = 3 * 60 * 60 * 1000; // a tuning evening
const RING = 400;
const ONLINE_MS = 15_000;

/**
 * In-memory relay between the player (desktop) and the phone (camera) of a
 * tuning session. Nothing is persisted: a session is a random id + a bearer-like
 * token (carried by the QR code) that both sides present. Events are broadcast
 * to every subscriber (SSE) and kept in a short ring so a polling client or a
 * reconnecting stream can catch up from a sequence number.
 */
@Injectable()
export class TuningSessionsService implements OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    // never keep the process alive just for the sweeper (Electron in-process)
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    for (const s of this.sessions.values()) { s.subject.complete(); s.info$.complete(); }
    this.sessions.clear();
  }

  create(): { id: string; token: string; createdAt: number; expiresAt: number } {
    const now = Date.now();
    const s: Session = {
      id: randomBytes(6).toString('hex'),
      token: randomBytes(18).toString('base64url'),
      createdAt: now,
      expiresAt: now + TTL_MS,
      seq: 0,
      events: [],
      subject: new Subject<TuningEvent>(),
      info$: new Subject<TuningSessionInfo>(),
      lastCameraAt: 0,
      lastDesktopAt: now,
      sockets: { desktop: 0, camera: 0 },
    };
    this.sessions.set(s.id, s);
    return { id: s.id, token: s.token, createdAt: s.createdAt, expiresAt: s.expiresAt };
  }

  /** Resolves a session or throws 404 / 401. Refreshes the expiry on use. */
  private authed(id: string, token: string | undefined): Session {
    const s = this.sessions.get(id);
    if (!s || s.expiresAt < Date.now()) {
      if (s) this.close(id);
      throw new NotFoundException('Unknown or expired tuning session');
    }
    if (!token || !safeEqual(token, s.token)) {
      throw new UnauthorizedException('Bad tuning session token');
    }
    s.expiresAt = Date.now() + TTL_MS;
    return s;
  }

  info(id: string, token: string | undefined): TuningSessionInfo {
    const s = this.authed(id, token);
    return this.toInfo(s);
  }

  private toInfo(s: Session): TuningSessionInfo {
    const now = Date.now();
    return {
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      seq: s.seq,
      cameraOnline: s.sockets.camera > 0 || now - s.lastCameraAt < ONLINE_MS,
      desktopOnline: s.sockets.desktop > 0 || now - s.lastDesktopAt < ONLINE_MS,
    };
  }

  private touch(s: Session, from: 'desktop' | 'camera'): void {
    if (from === 'camera') s.lastCameraAt = Date.now();
    else s.lastDesktopAt = Date.now();
  }

  publish(
    id: string,
    token: string | undefined,
    from: 'desktop' | 'camera',
    type: string,
    payload?: unknown,
  ): TuningEvent {
    const s = this.authed(id, token);
    this.touch(s, from);
    const ev: TuningEvent = { seq: ++s.seq, at: Date.now(), from, type, payload };
    s.events.push(ev);
    if (s.events.length > RING) s.events.splice(0, s.events.length - RING);
    s.subject.next(ev);
    return ev;
  }

  /** Events with seq > after (bounded by the ring). */
  poll(
    id: string,
    token: string | undefined,
    after: number,
    who: 'desktop' | 'camera' | undefined,
  ): { events: TuningEvent[]; info: TuningSessionInfo } {
    const s = this.authed(id, token);
    if (who) this.touch(s, who);
    return { events: s.events.filter((e) => e.seq > after), info: this.toInfo(s) };
  }

  /** Replay of the ring after `after`, then the live feed. */
  stream(
    id: string,
    token: string | undefined,
    after: number,
    who: 'desktop' | 'camera' | undefined,
  ): Observable<TuningEvent> {
    const s = this.authed(id, token);
    if (who) this.touch(s, who);
    const backlog = s.events.filter((e) => e.seq > after);
    return concat(from(backlog), s.subject.asObservable().pipe(filter((e) => e.seq > after)));
  }

  /**
   * A live connection (WebSocket, or the desktop app's in-process channel):
   * the side counts as online for as long as it stays open, both ends are told
   * when presence changes, and the ring after `after` is replayed first.
   */
  subscribe(
    id: string,
    token: string | undefined,
    after: number,
    who: 'desktop' | 'camera',
  ): LiveSubscription {
    const s = this.authed(id, token);
    this.touch(s, who);
    s.sockets[who]++;
    const backlog = s.events.filter((e) => e.seq > after);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      const cur = this.sessions.get(id);
      if (cur !== s) return; // session already closed
      s.sockets[who] = Math.max(0, s.sockets[who] - 1);
      this.touch(s, who);
      this.notifyInfo(s);
    };
    // let the other side know right away (the desktop shows "camera online")
    queueMicrotask(() => { if (this.sessions.get(id) === s) this.notifyInfo(s); });
    return {
      info: this.toInfo(s),
      backlog,
      events$: s.subject.asObservable().pipe(filter((e) => e.seq > after)),
      info$: s.info$.asObservable(),
      release,
    };
  }

  private notifyInfo(s: Session): void {
    s.info$.next(this.toInfo(s));
  }

  /** Mark a side as alive without publishing (SSE keep-alive from the client). */
  heartbeat(id: string, token: string | undefined, who: 'desktop' | 'camera'): TuningSessionInfo {
    const s = this.authed(id, token);
    this.touch(s, who);
    return this.toInfo(s);
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.subject.complete();
    s.info$.complete();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (s.expiresAt < now) this.close(id);
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
