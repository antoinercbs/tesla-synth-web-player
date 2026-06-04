import { protocol } from 'electron';
import { promises as fs } from 'fs';
import { basename, extname, join, resolve, sep } from 'path';
import type { DispatchRequest, EmbeddedBackend } from './embedded-backend';

/**
 * Custom `app://local/` scheme that replaces the embedded loopback HTTP server.
 * The renderer loads from app://local/ and makes the SAME relative requests it
 * always did; this handler is the transport:
 *   - /api/*     → injected into the in-process NestJS (no TCP)
 *   - /uploads/* → served from the uploads dir on disk (+ nosniff, audio/midi)
 *   - everything else → the built SPA from disk, with an index.html fallback so
 *     client-side routes (/play, /edit/…) resolve on deep-link / reload.
 */

export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://local`;

/** Must be called BEFORE app `whenReady` (registers the scheme's privileges). */
export function registerAppSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
};

function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

/** Headers from the injected Nest response, minus length/transfer fields the
 *  Response computes itself (a stale Content-Length would truncate the body). */
function passThroughHeaders(
  headers: Record<string, string | number | string[] | undefined>,
): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (v == null) continue;
    const lower = k.toLowerCase();
    if (lower === 'content-length' || lower === 'transfer-encoding' || lower === 'connection') {
      continue;
    }
    for (const item of Array.isArray(v) ? v : [v]) out.append(k, String(item));
  }
  return out;
}

async function serveDiskFile(
  filePath: string,
  contentType: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  try {
    const bytes = await fs.readFile(filePath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'Content-Type': contentType, ...extraHeaders },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/**
 * Registers the app:// handler. `dispatch` injects /api requests into the
 * in-process Nest; `publicDir` holds the built SPA; `uploadsDir` holds MIDI files.
 */
export function registerAppProtocol(
  backend: EmbeddedBackend,
  publicDir: string,
  uploadsDir: string,
): void {
  const publicRoot = resolve(publicDir);

  protocol.handle(APP_SCHEME, async (request: GlobalRequest): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);

    // The "download desktop app" feature is web-build-only UI; never serve a
    // 100 MB artifact through in-process buffering.
    if (pathname === '/api/downloads' || pathname.startsWith('/api/downloads/')) {
      return new Response('Not available in the desktop app', { status: 404 });
    }

    // /api/* → in-process NestJS
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const req: DispatchRequest = {
        method: request.method,
        url: url.pathname + url.search,
        headers,
        body: hasBody ? Buffer.from(await request.arrayBuffer()) : undefined,
      };
      const res = await backend.dispatch(req);
      return new Response(res.body.length ? new Uint8Array(res.body) : null, {
        status: res.status,
        headers: passThroughHeaders(res.headers),
      });
    }

    // /uploads/* → MIDI bytes from disk (nosniff so they can't be sniffed as HTML/JS)
    if (pathname.startsWith('/uploads/')) {
      return serveDiskFile(join(uploadsDir, basename(pathname)), 'audio/midi', {
        'X-Content-Type-Options': 'nosniff',
      });
    }

    // Everything else → the built SPA from disk, with an index.html fallback.
    const rel = pathname.replace(/^\/+/, '');
    const candidate = resolve(join(publicRoot, rel || 'index.html'));
    // Path-traversal guard: never serve outside the public root.
    if (candidate !== publicRoot && !candidate.startsWith(publicRoot + sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const bytes = await fs.readFile(candidate);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'Content-Type': mimeFor(candidate) },
      });
    } catch {
      // No such file. A path with an extension is a genuine 404 (missing asset);
      // an extension-less path is a client-side route → serve the SPA shell.
      if (extname(pathname)) return new Response('Not found', { status: 404 });
      return serveDiskFile(join(publicRoot, 'index.html'), 'text/html; charset=utf-8');
    }
  });
}
