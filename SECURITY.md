# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in vault-explorer, please **do not** open a public GitHub issue.

Instead, report it privately via one of:

- GitHub Security Advisories: [create a private advisory](https://github.com/svdepasquale/vault-explorer/security/advisories/new)
- Email: `silvio.depasquale@pm.me`

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof of concept if possible) against a synthetic vault — never attach private vault content
- Affected versions or commits
- Any suggested mitigation

You will receive an acknowledgement within **72 hours** and a status update within **7 days**.

## Scope

In scope:

- The loopback HTTP server in `src/server/`
- The `Host` header guard against DNS rebinding, and the `Origin` and `application/json` checks on POST routes
- Path handling: page reads through `/api/page`, static file serving, vault selection, symlinks and dot-folders inside the vault
- The `retrieve.py` bridge: how the server finds `scripts/retrieve.py` (vault-engine next to the vault, `VAULT_ENGINE`, or the vault's own `scripts/`), spawns it and parses its output
- The macOS `osascript` folder picker and the `open` call behind "open in app" / "reveal in Finder"
- How the SPA renders page content (markup in a page that runs script in the explorer's origin)
- GitHub Actions workflows under `.github/workflows/`

Out of scope:

- The vault content itself: what pages say, and any secret a vault contains — the explorer only reads and displays it
- Attacks that need local code execution as the user running the explorer: that user can already read the vault and everything the server can
- Bugs inside `scripts/retrieve.py`, which belongs to [vault-engine](https://github.com/svdepasquale/vault-engine) — report those there
- Vulnerabilities in third-party dependencies with no exploitable path in vault-explorer — report those upstream

## What the server is meant to guarantee

These hold for the built app (`npm start`). Under `npm run dev` the UI is served by Vite middleware behind the same Host guard, with CORS off, and Vite also serves the repository's own sources.

- It listens on `127.0.0.1` only and sends no CORS headers.
- It answers only requests addressed to `127.0.0.1`, `localhost` or `[::1]` on its own port.
- It serves file content only from the pages of the parsed model (symlinks and dot-folders are skipped) and from the built SPA.
- It never writes inside the vault itself (the vault's `retrieve.py` may update its own cache), and passes recall queries to it over stdin, never as arguments.

A way around any of these is a vulnerability.
