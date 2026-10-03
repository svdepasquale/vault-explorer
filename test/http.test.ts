import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildVaultModel } from '../src/core/model.ts';
import { createHandler } from '../src/server/http.ts';
import type { VaultService } from '../src/server/service.ts';
import type { VaultModel } from '../src/shared/model.ts';
import { makeTempDir, removeTempDir } from './helpers/fixture.ts';

// Written outside the vault and outside the static root; no response may contain it.
const OUTSIDE_MARKER = 'outside-marker: this file must never be served';

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

let root: string;
let vault: string;
let model: VaultModel;
let server: Server;
let port = 0;

// The parts of VaultService the handler reads. select() only records its
// argument: these tests never open a real vault, write config or watch files.
const selected: string[] = [];
const service = {
  vault: null as string | null,
  model: null as VaultModel | null,
  error: null as string | null,
  building: false,
  version: 1,
  config: { lastVault: null as string | null, recent: [] as string[] },
  select: async (path: string): Promise<void> => {
    selected.push(path);
  },
  subscribe: (): (() => void) => () => undefined,
};

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** Raw HTTP/1.1 request: unlike fetch(), the path is sent exactly as written. */
function send(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: { host: `127.0.0.1:${port}`, ...init.headers }, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });
}

const post = (path: string, headers: Record<string, string>, body = '{}'): Promise<Reply> => send(path, { method: 'POST', headers, body });
const code = (reply: Reply): unknown => (JSON.parse(reply.body) as { code?: unknown }).code;
const sameOrigin = (): string => `http://127.0.0.1:${port}`;

beforeAll(async () => {
  root = await makeTempDir('http');
  vault = join(root, 'vault');
  await write(join(vault, 'wiki/entities/alpha.md'), '---\nname: Alpha\n---\n# Alpha\n\nVisible body.\n');
  await write(join(root, 'outside/private.md'), `# ${OUTSIDE_MARKER}\n`);
  await symlink(join(root, 'outside/private.md'), join(vault, 'wiki/entities/leak.md'));
  await write(join(root, 'static/index.html'), '<!doctype html><title>spa shell</title>\n');
  await write(join(root, 'static/assets/app.js'), 'console.log("app");\n');
  await write(join(root, 'private.txt'), OUTSIDE_MARKER);
  // Shares the "static" prefix: a check without the trailing separator would let it through.
  await write(join(root, 'static-evil/private.txt'), OUTSIDE_MARKER);

  model = await buildVaultModel(vault);
  service.vault = vault;
  service.model = model;
  service.config = { lastVault: vault, recent: [vault] };

  server = createServer(
    createHandler({
      service: service as unknown as VaultService,
      appVersion: '0.0.0-test',
      port: () => port,
      staticDir: join(root, 'static'),
      devMiddleware: null,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await removeTempDir(root);
});

beforeEach(() => {
  selected.length = 0;
});

describe('Host header guard (DNS rebinding)', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])('answers %s on the bound port', async (name) => {
    const reply = await send('/api/status', { headers: { host: `${name}:${port}` } });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ app: 'vault-explorer', appVersion: '0.0.0-test', ready: true, vault });
  });

  it.each([
    ['a foreign name', 'evil.example'],
    ['a foreign name on the bound port', 'evil.example:PORT'],
    ['a look-alike subdomain', 'localhost.evil.example:PORT'],
    ['a loopback name on another port', '127.0.0.1:1'],
    ['a loopback name without port', 'localhost'],
  ])('refuses %s with 403', async (_label, host) => {
    const reply = await send('/api/status', { headers: { host: host.replace('PORT', String(port)) } });
    expect(reply.status).toBe(403);
    expect(code(reply)).toBe('forbidden-host');
  });

  it('guards static files and POST routes too', async () => {
    const page = await send('/', { headers: { host: 'evil.example' } });
    expect(page.status).toBe(403);
    expect(page.body).not.toContain('spa shell');
    const select = await post('/api/vault', { host: 'evil.example', 'content-type': 'application/json' }, '{"path":"/x"}');
    expect(select.status).toBe(403);
    expect(selected).toEqual([]);
  });
});

describe('POST guards', () => {
  it('accepts a same-origin JSON request (positive control)', async () => {
    const reply = await post('/api/vault', { origin: sameOrigin(), 'content-type': 'application/json; charset=utf-8' }, '{"path":"/somewhere"}');
    expect(reply.status).toBe(200);
    expect(selected).toEqual(['/somewhere']);
  });

  it.each([
    ['a foreign origin', 'https://evil.example'],
    ['an opaque origin', 'null'],
    ['the loopback host on another port', 'http://127.0.0.1:1'],
  ])('refuses %s with 403 before reading the body', async (_label, origin) => {
    const reply = await post('/api/vault', { origin, 'content-type': 'application/json' }, '{"path":"/x"}');
    expect(reply.status).toBe(403);
    expect(code(reply)).toBe('forbidden-origin');
    expect(selected).toEqual([]);
  });

  it.each<[string, Record<string, string>]>([
    ['text/plain', { origin: 'SAME', 'content-type': 'text/plain' }],
    ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['multipart', { 'content-type': 'multipart/form-data; boundary=x' }],
    ['no content type', {}],
  ])('refuses %s with 415', async (_label, headers) => {
    const withOrigin = headers['origin'] === 'SAME' ? { ...headers, origin: sameOrigin() } : headers;
    const reply = await post('/api/vault', withOrigin, '{"path":"/x"}');
    expect(reply.status).toBe(415);
    expect(code(reply)).toBe('unsupported-media-type');
    expect(selected).toEqual([]);
  });

  it('answers malformed JSON with 400', async () => {
    const reply = await post('/api/vault', { origin: sameOrigin(), 'content-type': 'application/json' }, '{"path":');
    expect(reply.status).toBe(400);
    expect(code(reply)).toBe('bad-request');
  });

  it('stops a text/plain body that names application/json when the browser sends an Origin', async () => {
    const reply = await post('/api/vault', { origin: 'https://evil.example', 'content-type': 'text/plain; charset=application/json' }, '{"path":"/x"}');
    expect(reply.status).toBe(403);
    expect(selected).toEqual([]);
  });

  // WEAKNESS (src/server/http.ts:111): the media-type check is a substring
  // match, so `text/plain; charset=application/json` — a CORS-safelisted
  // content type, sent without preflight — passes it. In browsers the Origin
  // check above still refuses the request; this layer alone does not.
  it('refuses text/plain even when a parameter names application/json (415)', async () => {
    const reply = await post('/api/vault', { 'content-type': 'text/plain; charset=application/json' }, '{"path":"/x"}');
    expect(reply.status).toBe(415);
  });
});

describe('/api/page and /api/open', () => {
  it('serves the body of a known page without its frontmatter (positive control)', async () => {
    const reply = await send('/api/page?id=entities%2Falpha');
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ id: 'entities/alpha', markdown: '# Alpha\n\nVisible body.\n' });
  });

  it('answers 404 for an unknown page id', async () => {
    const reply = await send('/api/page?id=entities%2Fnowhere');
    expect(reply.status).toBe(404);
    expect(code(reply)).toBe('not-found');
  });

  it('has a symlink in wiki/ that points outside the vault, which the model does not list', async () => {
    expect(await readFile(join(vault, 'wiki/entities/leak.md'), 'utf8')).toContain(OUTSIDE_MARKER);
    expect(model.pages.map((p) => p.id)).toEqual(['entities/alpha']);
  });

  it.each([
    'entities/leak',
    '../outside/private',
    '../../outside/private.md',
    'entities/../../outside/private',
    'wiki/../../outside/private',
    'OUTSIDE_ABSOLUTE',
  ])('cannot read outside the vault through id=%s', async (id) => {
    const value = id === 'OUTSIDE_ABSOLUTE' ? join(root, 'outside/private.md') : id;
    const reply = await send(`/api/page?id=${encodeURIComponent(value)}`);
    expect(reply.status).toBe(404);
    expect(reply.body).not.toContain(OUTSIDE_MARKER);
  });

  it('answers 404 to /api/open for an unknown page id, before anything is opened', async () => {
    const reply = await post('/api/open', { origin: sameOrigin(), 'content-type': 'application/json' }, '{"id":"entities/nowhere"}');
    expect(reply.status).toBe(404);
    expect(code(reply)).toBe('not-found');
  });

  it('answers 404 for an unknown API route', async () => {
    const reply = await send('/api/nope');
    expect(reply.status).toBe(404);
    expect(code(reply)).toBe('not-found');
  });
});

describe('static file serving', () => {
  it('serves the SPA with a CSP (positive control)', async () => {
    const reply = await send('/');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(reply.headers['content-security-policy']).toContain("default-src 'self'");
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.body).toContain('spa shell');
  });

  it('serves hashed assets as immutable', async () => {
    const reply = await send('/assets/app.js');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(reply.headers['cache-control']).toContain('immutable');
  });

  it('falls back to the SPA shell for client-side routes', async () => {
    const reply = await send('/graph/some/view');
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('spa shell');
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    const head = await send('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect((await send('/', { method: 'DELETE' })).status).toBe(405);
  });

  it.each(['/..%2fprivate.txt', '/%2e%2e%2fprivate.txt', '/assets/..%2f..%2fprivate.txt', '/..%2fstatic-evil%2fprivate.txt'])(
    'refuses encoded traversal %s with 403',
    async (path) => {
      const reply = await send(path);
      expect(reply.status).toBe(403);
      expect(code(reply)).toBe('forbidden');
      expect(reply.body).not.toContain(OUTSIDE_MARKER);
    },
  );

  it.each(['/../private.txt', '/%2e%2e/private.txt', '/assets/../../private.txt'])(
    'keeps plain dot segments %s inside the static root',
    async (path) => {
      // The URL parser resolves these before the handler sees them.
      const reply = await send(path);
      expect(reply.body).not.toContain(OUTSIDE_MARKER);
      expect(reply.body).toContain('spa shell');
    },
  );
});
