import { HttpException, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Duplex } from 'stream';
import type { Subscription } from 'rxjs';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  TuningEvent,
  TuningSessionInfo,
  TuningSessionsService,
} from './tuning-sessions.service';

/**
 * Live channel of a tuning session, one connection per side, both directions
 * on it: the hub pushes events (and presence changes) down, the client
 * publishes up and gets an acknowledgement carrying the sequence number.
 *
 *   client → hub   {kind:'publish', id, type, payload} | {kind:'ping'}
 *   hub → client   {kind:'hello', info} | {kind:'event', event} | {kind:'info', info}
 *                  | {kind:'ack', id, seq} | {kind:'error', id?, message} | {kind:'pong'}
 *                  | {kind:'closed'}
 *
 * The same `Connection` serves two carriers: a WebSocket upgraded on
 * `/api/tuning/sessions/:id/ws?token=&after=&who=` (web, and the phone in
 * desktop mode over the LAN server), and the desktop app's in-process channel
 * (main-process IPC, see electron/src/ipc.ts) where no socket exists. The
 * REST endpoints stay as the fallback (SSE / polling) and for publishing when
 * the channel is down.
 */
export type HubClientMessage =
  | { kind?: 'publish'; id?: string | number; type: string; payload?: unknown }
  | { kind: 'ping' };

export type HubServerMessage =
  | { kind: 'hello'; info: TuningSessionInfo }
  | { kind: 'event'; event: TuningEvent }
  | { kind: 'info'; info: TuningSessionInfo }
  | { kind: 'ack'; id?: string | number; seq: number }
  | { kind: 'error'; id?: string | number; message: string; status?: number }
  | { kind: 'pong' }
  | { kind: 'closed' };

export interface HubSink {
  send(msg: HubServerMessage): void;
  /** The carrier closes its end (after `closed` was sent). */
  close(): void;
}

export interface HubConnection {
  /** Feed a raw text frame / IPC payload from the client. */
  onMessage(raw: string | HubClientMessage): void;
  /** The carrier went away: release the presence + subscriptions. */
  dispose(): void;
}

type Side = 'desktop' | 'camera';
const WS_PATH = /^\/api\/tuning\/sessions\/([^/?#]+)\/ws\/?$/;

@Injectable()
export class TuningWsHub implements OnModuleDestroy {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  private readonly detachers = new Set<() => void>();

  constructor(private readonly sessions: TuningSessionsService) {}

  onModuleDestroy(): void {
    for (const d of this.detachers) d();
    this.detachers.clear();
    for (const c of this.wss.clients) c.terminate();
    this.wss.close();
  }

  /**
   * Carrier-agnostic connection. Throws the same HttpException as the REST
   * endpoints (404 unknown session, 401 bad token) so the carrier can answer.
   */
  connect(id: string, token: string | undefined, after: number, who: Side, sink: HubSink): HubConnection {
    const sub = this.sessions.subscribe(id, token, after, who);
    let open = true;
    const subs: Subscription[] = [];
    const safeSend = (m: HubServerMessage): void => {
      if (!open) return;
      try { sink.send(m); } catch { /* carrier gone; its close handler disposes */ }
    };
    const dispose = (): void => {
      if (!open) return;
      open = false;
      for (const s of subs) s.unsubscribe();
      sub.release();
    };
    safeSend({ kind: 'hello', info: sub.info });
    for (const ev of sub.backlog) safeSend({ kind: 'event', event: ev });
    subs.push(
      sub.events$.subscribe({
        next: (ev) => safeSend({ kind: 'event', event: ev }),
        complete: () => { safeSend({ kind: 'closed' }); dispose(); sink.close(); },
      }),
      sub.info$.subscribe({ next: (info) => safeSend({ kind: 'info', info }) }),
    );
    return {
      onMessage: (raw) => {
        if (!open) return;
        let msg: HubClientMessage;
        try { msg = typeof raw === 'string' ? (JSON.parse(raw) as HubClientMessage) : raw; } catch { safeSend({ kind: 'error', message: 'bad-json' }); return; }
        if (!msg || typeof msg !== 'object') { safeSend({ kind: 'error', message: 'bad-message' }); return; }
        if (msg.kind === 'ping') { this.sessions.heartbeat(id, token, who); safeSend({ kind: 'pong' }); return; }
        if (typeof msg.type !== 'string' || !msg.type) { safeSend({ kind: 'error', id: msg.id, message: 'bad-type' }); return; }
        try {
          const ev = this.sessions.publish(id, token, who, msg.type, msg.payload);
          safeSend({ kind: 'ack', id: msg.id, seq: ev.seq });
        } catch (e) {
          const status = e instanceof HttpException ? e.getStatus() : 500;
          safeSend({ kind: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e), status });
          if (status === 404 || status === 401) { safeSend({ kind: 'closed' }); dispose(); sink.close(); }
        }
      },
      dispose,
    };
  }

  /** Route the `upgrade` events of an HTTP(S) server to this hub. Returns a detach function. */
  attach(server: HttpServer | HttpsServer): () => void {
    const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
      if (!this.handleUpgrade(req, socket, head)) {
        // not ours: nobody else upgrades on this server
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
      }
    };
    server.on('upgrade', onUpgrade);
    const detach = (): void => { server.off('upgrade', onUpgrade); this.detachers.delete(detach); };
    this.detachers.add(detach);
    return detach;
  }

  /** True when the request targeted a tuning session socket (accepted or refused). */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', 'http://local');
    const m = WS_PATH.exec(url.pathname);
    if (!m) return false;
    const id = decodeURIComponent(m[1]);
    const token = url.searchParams.get('token') ?? undefined;
    const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
    const whoParam = url.searchParams.get('who');
    const who: Side = whoParam === 'camera' ? 'camera' : 'desktop';
    this.wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      let conn: HubConnection;
      try {
        conn = this.connect(id, token, after, who, {
          send: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
          close: () => ws.close(4404, 'session closed'),
        });
      } catch (e) {
        const status = e instanceof HttpException ? e.getStatus() : 500;
        ws.close(status === 401 ? 4401 : status === 404 ? 4404 : 1011, e instanceof Error ? e.message.slice(0, 120) : 'error');
        return;
      }
      // liveness: ping every 20 s, drop after two silent rounds (a phone that went to sleep)
      let alive = true;
      const timer = setInterval(() => {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        try { ws.ping(); } catch { /* closing */ }
      }, 20_000);
      timer.unref?.();
      ws.on('pong', () => { alive = true; });
      ws.on('message', (data) => { alive = true; conn.onMessage(data.toString()); });
      ws.on('close', () => { clearInterval(timer); conn.dispose(); });
      ws.on('error', () => { clearInterval(timer); conn.dispose(); });
    });
    return true;
  }
}
