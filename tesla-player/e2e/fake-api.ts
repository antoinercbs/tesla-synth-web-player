import { createHash } from 'node:crypto';
import type { Page, Request, Route } from '@playwright/test';
import { buildDemoLibrary, type DemoLibrary } from '../src/app/demo/data';
import type { MidiFile, Song } from '../src/model/domain';

/** A write the app sent, for the tests to check a save against. */
export interface ApiWrite {
  method: string;
  path: string;
  body: unknown;
}

type Answer = { status?: number; json?: unknown; bytes?: Uint8Array };
type Json = Record<string, unknown>;
type Upload = { fields: Record<string, string>; file: Uint8Array | null; fileName: string };
type Row = { id: number };

// what the server gives the coils of a song made from a file (songs.service.ts)
const NEW_COIL = { channelMask: 0, ontimeUs: 40, duty: 0.05 };

/**
 * The server, for the end-to-end tests: the guided tour's sample library
 * (src/app/demo/data.ts) answered from memory, on the page's own origin
 * (.env.e2e empties VITE_BASE_URL), so no test can reach a real library.
 * Writes change the copy in memory as the server would and are kept in
 * `writes`; a request it doesn't know answers 404 and lands in `unknown`,
 * which fails the test (fixtures.ts): extend it when the app calls a new route.
 */
export class FakeApi {
  readonly writes: ApiWrite[] = [];
  readonly unknown: string[] = [];
  readonly lib: DemoLibrary;
  readonly scenes: Row[];
  private nextId = 9900;

  constructor(lang = 'en') {
    this.lib = buildDemoLibrary(lang);
    this.scenes = this.lib.scenes;
  }

  async attach(page: Page, origin: string): Promise<void> {
    const host = new URL(origin).host;
    await page.route((url) => url.host === host && /^\/(api|uploads)\//.test(url.pathname), (route) => this.handle(route));
  }

  /** The bodies sent to `method` on a path matching `path`, oldest first. */
  sent(method: string, path: string | RegExp): unknown[] {
    return this.writes
      .filter((w) => w.method === method && (typeof path === 'string' ? w.path === path : path.test(w.path)))
      .map((w) => w.body);
  }

  song(id: number): Song {
    const s = this.lib.songs.find((x) => x.id === id);
    if (!s) throw new Error(`no song ${id} in the fake API`);
    return s;
  }

  /** The bytes of a song's MIDI file as the server holds them. */
  midiOf(songId: number): Uint8Array {
    const file = this.song(songId).midiFile;
    const bytes = file && this.lib.bytes.get(file.path.replace(/^\./, ''));
    if (!bytes) throw new Error(`song ${songId} has no file in the fake API`);
    return bytes;
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = FakeApi.bodyOf(req);
    if (method !== 'GET') this.writes.push({ method, path: url.pathname, body });
    const a = url.pathname.startsWith('/uploads/') ? this.file(url.pathname) : this.answer(method, url.pathname.split('/').slice(2), body);
    if (!a) {
      this.unknown.push(`${method} ${url.pathname}`);
      await route.fulfill({ status: 404, json: { message: 'not in the fake API' } });
    } else if (a.bytes) {
      await route.fulfill({ status: 200, contentType: 'audio/midi', body: Buffer.from(a.bytes) });
    } else {
      await route.fulfill({ status: a.status ?? 200, json: a.json ?? null });
    }
  }

  private file(path: string): Answer | undefined {
    const bytes = this.lib.bytes.get(path);
    return bytes && { bytes };
  }

  private answer(method: string, [kind, idPart, sub]: string[], body: unknown): Answer | undefined {
    const l = this.lib;
    const id = idPart !== undefined && /^\d+$/.test(idPart) ? Number(idPart) : null;
    const json = (body ?? {}) as Json;
    switch (`${method} ${kind}${idPart === undefined ? '' : id === null ? `/${idPart}` : '/:id'}${sub ? `/${sub}` : ''}`) {
      case 'GET ping': return { json: { ping: 'pong' } };
      case 'GET auth/config': return { json: { enabled: false } };
      case 'GET firmware': return { json: [] };
      case 'GET settings': return { json: l.config };
      case 'PUT settings': return { json: Object.assign(l.config, json) };
      case 'GET tags': return { json: l.tags };
      case 'PUT tags/sync': {
        const kept = (body as { id?: number; name: string; color: string }[]).map((t) => ({ ...t, id: t.id ?? this.nextId++ }));
        l.tags.splice(0, l.tags.length, ...kept);
        return { json: l.tags };
      }
      case 'POST songs': return { json: this.saveSong(null, json) };
      case 'PUT songs/:id': return this.has(l.songs, id) ? { json: this.saveSong(id, json) } : { status: 404 };
      case 'POST songs/upload': return { json: this.newSongFrom(FakeApi.upload(body)) };
      case 'PUT songs/:id/midi': return this.has(l.songs, id) ? { json: this.replaceMidi(id as number, FakeApi.upload(body)) } : { status: 404 };
      case 'PUT coils/order': {
        const ids = (json as { ids: number[] }).ids;
        l.coils.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).forEach((c, i) => { c.position = i; });
        return { json: l.coils };
      }
    }
    const lists: Record<string, Row[]> = { songs: l.songs, playlists: l.playlists, envelopes: l.envelopes, coils: l.coils, scenes: this.scenes, tunings: l.tunings };
    if (!(kind in lists) || sub !== undefined || (idPart !== undefined && id === null)) return undefined;
    return this.crud(lists[kind], method, id, json);
  }

  private crud(list: Row[], method: string, id: number | null, body: Json): Answer | undefined {
    if (id === null) {
      if (method === 'GET') return { json: list };
      if (method !== 'POST') return undefined;
      const row = { ...body, id: this.nextId++ };
      list.push(row);
      return { json: row };
    }
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return { status: 404 };
    if (method === 'GET') return { json: list[i] };
    if (method === 'PUT') return { json: (list[i] = { ...list[i], ...body, id }) };
    if (method !== 'DELETE') return undefined;
    list.splice(i, 1);
    return { json: 'OK' };
  }

  private has(list: Row[], id: number | null): boolean {
    return list.some((x) => x.id === id);
  }

  /** POST /api/songs and PUT /api/songs/:id: the DTO's tag ids become tags, a file can be copied from another song. */
  private saveSong(id: number | null, dto: Json): Song {
    const l = this.lib;
    const { tagIds, midiFromSongId, ...fields } = dto as { tagIds?: number[]; midiFromSongId?: number | null } & Json;
    const was = id === null ? null : this.song(id);
    const song = { ...was, ...fields, id: id ?? this.nextId++ } as Song;
    if (tagIds) song.tags = l.tags.filter((t) => t.id !== undefined && tagIds.includes(t.id));
    if (!was) song.tags ??= [];
    if (midiFromSongId && midiFromSongId !== id) {
      const from = this.song(midiFromSongId).midiFile;
      song.midiFile = from && this.newFile(from.name, l.bytes.get(from.path.replace(/^\./, '')) as Uint8Array, from);
    }
    if (was) l.songs[l.songs.indexOf(was)] = song;
    else l.songs.push(song);
    return song;
  }

  private newSongFrom(up: Upload): Song {
    const coilCount = Number(up.fields.coilCount) || this.lib.config.defaultCoilCount || 3;
    const song = {
      id: this.nextId++, name: up.fields.name || up.fileName.replace(/\.(mid|midi|kar)$/i, ''), coilCount, mode: 'midi', output2Mask: 0,
      coils: Array.from({ length: coilCount }, (_, coilIndex) => ({ coilIndex, ...NEW_COIL })), events: [], stereo: null, tags: [],
      midiFile: this.newFile(up.fileName, up.file ?? new Uint8Array()), editorName: null,
    } as Song;
    this.lib.songs.push(song);
    return song;
  }

  private replaceMidi(id: number, up: Upload): Song {
    const song = this.song(id);
    const bytes = up.file ?? new Uint8Array();
    const old = song.midiFile;
    if (old) {
      this.lib.bytes.set(old.path.replace(/^\./, ''), bytes);
      song.midiFile = { ...old, hash: FakeApi.hash(bytes) };
    } else {
      song.midiFile = this.newFile(up.fileName, bytes);
    }
    return song;
  }

  private newFile(name: string, bytes: Uint8Array, like?: MidiFile): MidiFile {
    const id = this.nextId++;
    const path = `/uploads/e2e-${id}.mid`;
    this.lib.bytes.set(path, bytes);
    return { ...like, id, name, path: `.${path}`, hash: FakeApi.hash(bytes), editorName: null } as MidiFile;
  }

  private static hash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  private static bodyOf(req: Request): unknown {
    const type = req.headers()['content-type'] ?? '';
    const buf = req.postDataBuffer();
    if (!buf) return null;
    if (type.startsWith('multipart/form-data')) return { multipart: buf, boundary: /boundary=(.+)$/.exec(type)?.[1] ?? '' };
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return buf.toString('utf8');
    }
  }

  /** A multipart body's text fields and its one file. */
  private static upload(body: unknown): Upload {
    const { multipart, boundary } = body as { multipart: Buffer; boundary: string };
    const out: Upload = { fields: {}, file: null, fileName: 'upload.mid' };
    // latin1 keeps one char per byte: the file's bytes survive the split
    for (const part of multipart.toString('latin1').split(`--${boundary}`)) {
      const sep = part.indexOf('\r\n\r\n');
      if (sep < 0) continue;
      const head = part.slice(0, sep);
      const value = part.slice(sep + 4, part.endsWith('\r\n') ? -2 : undefined);
      const name = /name="([^"]*)"/.exec(head)?.[1];
      const fileName = /filename="([^"]*)"/.exec(head)?.[1];
      if (fileName !== undefined) {
        out.file = new Uint8Array(Buffer.from(value, 'latin1'));
        out.fileName = fileName;
      } else if (name) {
        out.fields[name] = Buffer.from(value, 'latin1').toString('utf8');
      }
    }
    return out;
  }
}
