# Contributing to vault-explorer

Thanks for considering a contribution. vault-explorer is a local, read-only explorer for a markdown knowledge vault: a Node server on `127.0.0.1` parses the vault and its git history, and a React SPA draws the link graph, timeline, composition, health checks and recall lens. Contributions are welcome as:

- Bug reports, ideally with a minimal synthetic page that reproduces the problem
- Parser fixes where the explorer disagrees with how the vault is written or rendered
- New health checks or views
- Documentation improvements

## Constraints to respect

- **Read-only.** The server never writes inside the vault. The only side effects are the vault's own `scripts/retrieve.py` (which may update its own cache when the recall lens runs) and the app config under `$XDG_CONFIG_HOME/vault-explorer/` (default `~/.config/vault-explorer/`).
- **Loopback only.** The server binds `127.0.0.1` and answers only requests whose `Host` header names that address and port; POST routes refuse a foreign `Origin` and anything but `application/json`. New routes go behind the same guards.
- **Node runs the server TypeScript natively** (type stripping). Code under `src/core`, `src/server` and `src/shared` stays erasable: no enums, namespaces or parameter properties (`erasableSyntaxOnly`), `import type` for types (`verbatimModuleSyntax`), and `.ts` extensions in relative imports — `tsc` accepts other extensions there, so that last rule is enforced by the smoke step in `npm run check` and CI (`node bin/vault-explorer.js --help`).
- **`src/shared` is the contract** between the server and the SPA: a change to `src/shared/model.ts` is an API change for both sides.
- **Synthetic data only.** Fixtures, screenshots, issues and logs never carry real vault content — no page names, hostnames, IPs or text from a private vault.

## Before opening a PR

1. **Open an issue first** for non-trivial changes. Align on the approach before spending time on code.
2. **Keep PRs focused.** One logical change per PR.
3. **Test parser and server changes.** A bug you find but do not fix becomes an `it.fails` test whose comment names the file and line.

## Local checks

```bash
npm ci

# Typecheck (server + SPA), unit and integration tests, production build
npm run check

# Dev server: the UI through Vite with hot reload
npm run dev

# Production build against a real vault
npm run build && npm start -- --vault /path/to/vault
```

The integration tests create throwaway git repositories in the system temp directory, with their own identity and signing turned off, so they need nothing but `git` on `PATH`. The fixture vault lives in `test/fixtures/vault/` in its final state; the history is scripted in the test.

CI runs the same install, typecheck, tests and build on every pull request (`.github/workflows/ci.yml`), plus gitleaks, actionlint and zizmor (`.github/workflows/ci-security.yml`).

## Commit style

- Short imperative subject, lowercase, no trailing period, prefixed with the area (e.g. `core: follow renames when dating links`)
- Reference the issue number in the body if applicable

## Signing off

By submitting a pull request you agree to license your contribution under the [MIT License](LICENSE) that covers this repository.

## Security issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).
