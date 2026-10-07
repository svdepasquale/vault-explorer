# vault-explorer

Local graphical explorer for a markdown knowledge vault in the LLM-wiki layout — built for the author's own (private) vault, the plain-markdown memory Claude reads and writes: `wiki/` pages with YAML frontmatter, `[[wikilinks]]`, typed `relations:` and a git history. It brings back what Obsidian's graph view was used for (a look at the memory, not a reader), and adds what the vault's own conventions make possible: typed relations, git history, health checks and the vault's retrieval.

Read-only, served on `127.0.0.1`, nothing resident: start it, look, Ctrl-C.

## Views

| View | What it shows |
|---|---|
| **Graph** | Every page as a node, sized by how many pages link to it. Typed `relations:` are arrows, body wikilinks thin lines. Color by **kind** (entity / source / runbook / profile; meta, folds and navigation in gray), by **freshness** (days since the last update), or **highlight** one domain, tag or status. Labels **on hover** by default (the page under the pointer and its connections; or *always*). Hover dims everything but the neighbourhood; click opens the page panel; double-click focuses its 1-hop neighbourhood (up to 3 hops). Drag nodes; the layout is remembered per vault. **2D** (sigma.js), **3D** (three.js, rotatable) or **Galaxy**: the 3D graph as glowing stars on a dark field, faint filaments, a starfield and a slow turn that stops under the pointer. |
| **Time travel** | Replays the vault growing: pages appear at their first commit, links on the day git first saw them written (dated from `git log -p`, renames followed). New pages are labelled while they are new. Works in every view. |
| **Timeline** | Commit calendar, cumulative pages by kind and links written, one lifeline per page (deleted pages included), and the commit feed (`<page>: what changed`) with filters. |
| **Overview** | Headline numbers, the `hot.md` digest (open threads with clickable links), composition by kind / domain / status / tag, relations by predicate, hubs and outliers. |
| **Health** | A visual lint: one-sided typed relations (the schema wants both pages to declare an edge that has an inverse), orphans, dead links, invalid YAML, values cut short by an unquoted ` #` (a YAML comment), missing fields, stale active pages, oversized pages, the `hot.md` byte budget. "Copy for Claude" puts the filtered list on the clipboard as a Markdown checklist. |
| **Recall** | Runs `scripts/retrieve.py` from [vault-engine](https://github.com/svdepasquale/vault-engine) — a checkout next to the vault, `VAULT_ENGINE`, or a vault that still carries its own `scripts/` — the same hybrid retrieval Claude uses — and shows the ranked chunks; "Show on graph" lights the hits up. |

The page panel (any view) shows frontmatter, typed relations from that page's side (one-sided ones flagged), backlinks, links out, the rendered page with working `[[wikilinks]]`, and its git history. ⌘K searches pages.

## Run it

Requirements: Node ≥ 24 (developed on 26 — the server is TypeScript run natively), `git`. Optional: `python3` and the vault's retrieval index for the Recall view; macOS for the native folder picker and "Open file / Reveal in Finder".

```bash
git clone git@github.com:svdepasquale/vault-explorer.git ~/projects/vault-explorer
cd ~/projects/vault-explorer
npm ci && npm run build

npm start -- --vault ~/projects/knowledge-vault   # opens http://127.0.0.1:7418/
```

The last vault opened is remembered, so later runs are just `npm start`. Without `--vault` and with nothing remembered, the page asks for the vault folder (a path, a recent one, or **Browse…** on macOS). The vault can be switched from the name in the top bar.

| Flag / variable | Meaning |
|---|---|
| `--vault <path>`, `-v` / `VAULT_EXPLORER_VAULT` | Vault repository root (the folder that contains `wiki/`) |
| `--port <n>`, `-p` / `VAULT_EXPLORER_PORT` | Port on 127.0.0.1, default 7418 |
| `--no-open` | Do not open the browser |
| `--dev` | Serve the UI through Vite with hot reload (implies `--no-open`) |

Starting it again while it runs just reopens the browser on the running instance. The page updates by itself when the vault changes on disk or gets a new commit.

**As an app:** in Safari, *File → Add to Dock* (or Chrome, *⋮ → Cast, save and share → Install page as app*) gives the page its own window and Dock icon. **As a command:** `npm link` once exposes `vault-explorer` on the `PATH`.

**From a release:** each `v*` tag publishes a tarball with the source and the built UI, plus its build-provenance attestation (`gh attestation verify <tarball> -R svdepasquale/vault-explorer`). Extract it anywhere outside `node_modules`, run `npm ci --omit=dev` (only `yaml` is needed at runtime) and `node bin/vault-explorer.js --vault <path>`.

## What it reads, and what it never does

- Pages: every `.md` under `wiki/` (dot-folders and symlinks skipped). Frontmatter is parsed as YAML, with a line-based fallback for invalid blocks (reported in Health). Kinds come from folder + `type` (`runbooks/` and `folds/` are `type: meta` in the vault).
- Links: `[[page]]`, `[[folder/page]]`, `[[page|alias]]`, `[[page#section]]`, outside code. Bare names resolve by file name, path links by path; an ambiguous `_index` prefers the same folder.
- Relations: the vault's typed predicates (`hosted_on`/`hosts`, `documented_in`/`documents`, …). An inverse declaration is folded into one canonical edge that remembers which pages declared it.
- History: `git log` on `wiki/`, run with `--no-optional-locks` so it never touches the index another process may be writing.
- **Never writes inside the vault.** The only side effects are the app's own config (`~/.config/vault-explorer/config.json`, recent vaults) and, when Recall runs, whatever the vault's `retrieve.py` does on any Claude query (it may fill its untracked embedding cache).
- Listens on `127.0.0.1` only, answers only requests addressed to its own host and port (DNS-rebinding guard), and POST routes refuse foreign origins and non-JSON bodies. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm run dev     # server + Vite middleware with hot reload, http://127.0.0.1:7418/
npm run check   # typecheck, lint + format check (Biome), Node type-stripping smoke test, tests, build
npm run format  # apply the Biome formatting
```

```
src/shared/   the contract: VaultModel and API types, wikilink resolver
src/core/     vault parser: frontmatter, markdown, relations, git, health, model builder
src/server/   HTTP server, vault service + file watcher, recall bridge, macOS picker
src/web/      React SPA: app shell, page panel, views/{graph,timeline,overview,health,recall}
test/         vitest: synthetic fixture vault, scripted git history, HTTP guard tests
```

Conventions and gotchas for working on it: [CLAUDE.md](CLAUDE.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
