import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ViteDevServer } from 'vite';
import { loadConfig } from './config.ts';
import { createHandler, type HandlerOptions } from './http.ts';
import { expandHome, VaultService } from './service.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST_DIR = fileURLToPath(new URL('../../dist/web', import.meta.url));
const DEFAULT_PORT = 7418;

const USAGE = `vault-explorer — local graphical explorer for a markdown knowledge vault

Usage: vault-explorer [--vault <path>] [--port <n>] [--no-open] [--dev]

  --vault, -v   vault repository root (the folder that contains wiki/);
                default: $VAULT_EXPLORER_VAULT, else the last vault opened
  --port, -p    port on 127.0.0.1 (default ${DEFAULT_PORT}, or $VAULT_EXPLORER_PORT)
  --no-open     do not open the browser
  --dev         serve the UI through Vite with hot reload (implies --no-open)
`;

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => undefined);
}

async function alreadyRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { app?: unknown };
    return body.app === 'vault-explorer';
  } catch {
    return false;
  }
}

/** Ask the running instance to switch to `vault` (absolute path) when one was requested. */
async function handOver(port: number, vault: string | undefined): Promise<void> {
  if (!vault) return;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/vault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: resolve(expandHome(vault)) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      console.warn(`[vault-explorer] the running instance did not open ${vault}: ${body.error ?? res.status}`);
    }
  } catch (err) {
    console.warn(`[vault-explorer] could not hand ${vault} to the running instance: ${String(err)}`);
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      vault: { type: 'string', short: 'v' },
      port: { type: 'string', short: 'p' },
      open: { type: 'boolean', default: true },
      dev: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowNegative: true,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const port = Number(values.port ?? process.env['VAULT_EXPLORER_PORT'] ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${values.port}`);
  const shouldOpen = values.open && !values.dev;
  const url = `http://127.0.0.1:${port}/`;

  if (!values.dev && !existsSync(`${DIST_DIR}/index.html`)) {
    console.error('[vault-explorer] the UI is not built yet: run `npm run build` (or use `npm run dev`).');
    process.exitCode = 1;
    return;
  }

  // Already running on this port: hand it the requested vault and reopen the browser,
  // before touching the config or starting Vite.
  if (await alreadyRunning(port)) {
    await handOver(port, values.vault ?? process.env['VAULT_EXPLORER_VAULT']);
    console.log(`[vault-explorer] already running at ${url}`);
    if (shouldOpen) openBrowser(url);
    return;
  }

  const pkg = JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf8')) as { version: string };
  const service = new VaultService(await loadConfig());
  const initial = values.vault ?? process.env['VAULT_EXPLORER_VAULT'] ?? service.config.lastVault;
  if (initial) {
    try {
      await service.select(initial);
    } catch (err) {
      console.warn(`[vault-explorer] ${err instanceof Error ? err.message : String(err)} — pick a vault in the UI.`);
    }
  }

  const server = createServer();
  const options: HandlerOptions = {
    service,
    appVersion: pkg.version,
    port: () => port,
    staticDir: values.dev ? null : DIST_DIR,
    devMiddleware: null,
  };
  let vite: ViteDevServer | undefined;
  if (values.dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      configFile: `${REPO_ROOT}vite.config.ts`,
      // cors: false keeps --dev as closed as the built app (Vite would allow any origin).
      server: { middlewareMode: true, hmr: { server }, cors: false },
      appType: 'spa',
    });
    options.devMiddleware = vite.middlewares;
  }
  server.on('request', createHandler(options));

  try {
    await listen(server, port);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && (await alreadyRunning(port))) {
      // Lost a start-up race with another instance.
      await vite?.close();
      service.close();
      console.log(`[vault-explorer] already running at ${url}`);
      if (shouldOpen) openBrowser(url);
      return;
    }
    throw err;
  }

  const vaultLine = service.vault ? `vault ${service.vault}` : 'no vault selected yet';
  console.log(`[vault-explorer] ${url} — ${vaultLine}${values.dev ? ' (dev)' : ''}. Ctrl-C to stop.`);
  if (shouldOpen) openBrowser(url);

  const shutdown = (): void => {
    service.close();
    server.close();
    server.closeAllConnections();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(`[vault-explorer] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
