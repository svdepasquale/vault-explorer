import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { readFrontmatter } from '../core/frontmatter.ts';
import { VaultError } from '../core/model.ts';
import type { ApiError, PageContentResponse, StatusResponse } from '../shared/model.ts';
import { pickFolder, pickerSupported } from './picker.ts';
import { RecallError, runRecall } from './recall.ts';
import type { VaultService } from './service.ts';

export interface HandlerOptions {
  service: VaultService;
  appVersion: string;
  /** Port actually bound; read lazily because it is known only after listen(). */
  port: () => number;
  /** Built SPA directory (production), or null in --dev. */
  staticDir: string | null;
  /** Vite connect middleware in --dev. */
  devMiddleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | null;
}

const MAX_BODY = 64 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function fail(res: ServerResponse, status: number, error: string, code?: string): void {
  const body: ApiError = code ? { error, code } : { error };
  send(res, status, body);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new VaultError('too-large', 'Request body too large');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new VaultError('bad-request', 'Expected a JSON object');
  return data as Record<string, unknown>;
}

export function createHandler(options: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const { service } = options;

  const allowedHosts = (): Set<string> => {
    const p = options.port();
    return new Set([`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]);
  };
  const allowedOrigins = (): Set<string> => {
    const p = options.port();
    return new Set([`http://127.0.0.1:${p}`, `http://localhost:${p}`, `http://[::1]:${p}`]);
  };

  const status = (): StatusResponse => ({
    app: 'vault-explorer',
    appVersion: options.appVersion,
    vault: service.vault,
    ready: service.model !== null,
    building: service.building,
    error: service.error,
    modelVersion: service.version,
    recent: service.config.recent,
    platform: process.platform,
  });

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? 'GET';
    if (method === 'POST') {
      // A cross-site page cannot send application/json without a CORS
      // preflight, which this server never answers; the Origin check covers
      // browsers that send it anyway.
      const origin = req.headers.origin;
      if (origin && !allowedOrigins().has(origin)) return fail(res, 403, 'Cross-origin request refused', 'forbidden-origin');
      if (!(req.headers['content-type'] ?? '').includes('application/json')) {
        return fail(res, 415, 'Expected application/json', 'unsupported-media-type');
      }
    }

    const route = `${method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/status':
        return send(res, 200, status());

      case 'GET /api/model':
        if (!service.model) return fail(res, 503, service.error ?? 'No vault selected', service.vault ? 'not-ready' : 'no-vault');
        return send(res, 200, service.model);

      case 'GET /api/page': {
        const id = url.searchParams.get('id') ?? '';
        const page = service.model?.pages.find((p) => p.id === id);
        if (!page || !service.vault) return fail(res, 404, `Unknown page ${id}`, 'not-found');
        try {
          const text = await readFile(join(service.vault, page.path), 'utf8');
          const body: PageContentResponse = { id, markdown: readFrontmatter(text).body };
          return send(res, 200, body);
        } catch {
          return fail(res, 404, `${page.path} is gone`, 'not-found');
        }
      }

      case 'GET /api/events': {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write(`event: model\ndata: ${JSON.stringify({ version: service.version })}\n\n`);
        const unsubscribe = service.subscribe((version) => {
          res.write(`event: model\ndata: ${JSON.stringify({ version })}\n\n`);
        });
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
        req.on('close', () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
        return;
      }

      case 'POST /api/vault': {
        const body = await readJson(req);
        const path = typeof body['path'] === 'string' ? body['path'] : '';
        if (!path.trim()) return fail(res, 400, 'Missing path', 'bad-request');
        await service.select(path);
        return send(res, 200, status());
      }

      case 'POST /api/vault/pick': {
        if (!pickerSupported) return fail(res, 501, 'The native folder picker is macOS-only; type the path instead', 'unsupported');
        const chosen = await pickFolder(service.vault ? join(service.vault, '..') : null);
        if (!chosen) return send(res, 200, { cancelled: true, status: status() });
        await service.select(chosen);
        return send(res, 200, { cancelled: false, status: status() });
      }

      case 'POST /api/recall': {
        if (!service.vault || !service.model) return fail(res, 503, 'No vault selected', 'no-vault');
        if (!service.model.vault.capabilities.recall) return fail(res, 501, 'This vault has no scripts/retrieve.py', 'unsupported');
        const body = await readJson(req);
        const query = typeof body['query'] === 'string' ? body['query'].trim() : '';
        const top = Math.min(20, Math.max(1, Math.trunc(Number(body['top'] ?? 8)) || 8));
        if (!query) return fail(res, 400, 'Missing query', 'bad-request');
        if (query.length > 500) return fail(res, 400, 'Query too long', 'bad-request');
        return send(res, 200, await runRecall(service.vault, query, top));
      }

      case 'POST /api/open': {
        // Open a page in the default .md app, or reveal it in Finder.
        const body = await readJson(req);
        const page = service.model?.pages.find((p) => p.id === body['id']);
        if (!page || !service.vault) return fail(res, 404, 'Unknown page', 'not-found');
        if (process.platform !== 'darwin') return fail(res, 501, 'Opening files is macOS-only', 'unsupported');
        const args = body['reveal'] === true ? ['-R', join(service.vault, page.path)] : [join(service.vault, page.path)];
        await new Promise<void>((done, reject) => execFile('open', args, (err) => (err ? reject(err) : done())));
        return send(res, 200, { ok: true });
      }

      default:
        return fail(res, 404, `No route ${route}`, 'not-found');
    }
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const root = options.staticDir;
    if (!root) return fail(res, 404, 'Not found', 'not-found');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return fail(res, 403, 'Forbidden', 'forbidden');
    let target = file;
    try {
      if (!(await stat(target)).isFile()) target = join(root, 'index.html');
    } catch {
      target = join(root, 'index.html');
    }
    const data = await readFile(target);
    const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
    const headers: Record<string, string | number> = {
      'content-type': type,
      'content-length': data.length,
      'cache-control': target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (type.startsWith('text/html')) headers['content-security-policy'] = CSP;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    // DNS-rebinding guard: only answer requests addressed to this loopback port.
    if (!allowedHosts().has(req.headers.host ?? '')) {
      fail(res, 403, 'Forbidden host', 'forbidden-host');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      api(req, res, url).catch((err: unknown) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        if (err instanceof VaultError) fail(res, 400, err.message, err.code);
        else if (err instanceof RecallError) fail(res, 502, err.message, err.code);
        else if (err instanceof SyntaxError) fail(res, 400, 'Malformed JSON', 'bad-request');
        else fail(res, 500, err instanceof Error ? err.message : String(err), 'internal');
      });
      return;
    }
    if (options.devMiddleware) {
      options.devMiddleware(req, res, () => fail(res, 404, 'Not found', 'not-found'));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fail(res, 405, 'Method not allowed', 'method-not-allowed');
      return;
    }
    serveStatic(req, res, url).catch(() => fail(res, 500, 'Static file error', 'internal'));
  };
}
