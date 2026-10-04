# CLAUDE.md — vault-explorer

## What this project is

A local, read-only graphical explorer for the user's knowledge vault (`~/projects/knowledge-vault`, Claude's long-term memory). It replaced Obsidian's graph view when the Obsidian app was retired from the memory system (2026-09-25). Single user, one Mac, hobby scale: no auth, no deployment, nothing resident — the user starts it, looks, and stops it.

## Architecture

```
vault (wiki/**.md + git) → src/core (parse) → VaultModel (src/shared) → src/server (HTTP on 127.0.0.1) → src/web (React SPA)
```

- `src/shared/model.ts` is the contract between server and SPA. Changing it changes both sides.
- `src/core/model.ts` `buildVaultModel()` does the whole parse (~0.4 s on the real vault, most of it the `git log -p` pass that dates links). The server rebuilds on file-system changes (debounced) and pushes the new version over SSE (`/api/events`); the SPA refetches `/api/model`.
- Page bodies are not in the model; the page panel fetches `/api/page?id=` on demand.
- The SPA keeps state in one zustand store (`src/web/app/store.ts`); view + selected page live in the URL hash. `src/web/app/derived.ts` builds the indexes once per model.
- Views are lazy chunks registered in `src/web/views/registry.ts`, each owning its folder. The 3D renderer (three.js, ~1.4 MB) is its own lazy chunk.

## Conventions

- **Node runs the server TypeScript natively** (type stripping). Erasable syntax only (no enums, namespaces, parameter properties), `import type` for types (`verbatimModuleSyntax`), `.ts`/`.tsx` extensions on relative imports. `tsc` (TypeScript 7) checks it with `erasableSyntaxOnly`; `noUncheckedIndexedAccess` is on.
- **Never write inside the vault**, never commit there from this repo. Git calls use `--no-optional-locks`. The vault is private: tests use the synthetic fixture in `test/fixtures/vault/`; no real page names, hosts or text in fixtures, screenshots, issues or commit messages.
- **Colors come from the validated palette** (`src/web/styles/tokens.css`, mirrored in `src/web/app/palette.ts` for WebGL/Plot). The graph is an all-pairs form: at most four hues pass the palette validator in both modes, so only entity / source / runbook / profile get a hue and the other kinds share the gray. Domains, tags and statuses are an emphasis mode (one hue + gray), freshness a validated 4-step ordinal ramp. Status colors only for health state, always with icon + label (`SeverityBadge`). Re-validate with the dataviz skill's script before adding a color.
- Commits: `area: short imperative subject`, lowercase, no trailing period, signed (a ruleset requires it; another blocks force-push and deletion). Direct pushes to `main`. The repo is public (since 2026-10-04): nothing from the private vault goes in. CI = `ci.yml` (Biome lint + format, `npm audit`, typecheck/tests/build/smoke) + `ci-security.yml` (gitleaks, actionlint, zizmor) + `claude-review.yml` (inert until `CLAUDE_CODE_OAUTH_TOKEN` is set) + `release.yml` (on `v*` tags).
- Biome runs the recommended preset with two rules off on purpose: `useLiteralKeys` (bracket access on frontmatter records) and `useSemanticElements` (ARIA roles on divs). Deliberate exceptions carry a `biome-ignore` with the reason.

## Verify a change

1. `npm run check` (typecheck both projects, Node type-stripping smoke test, tests, build).
2. Run it against the real vault, read-only: `npm run build && node src/server/main.ts --vault ~/projects/knowledge-vault --no-open` (or `npm run dev`), then look at it — Claude in Chrome when connected, otherwise headless Chrome over the DevTools protocol. Check dark and light.

## Gotchas (each one cost a debugging round)

- **sigma.js v3 blends colors as premultiplied alpha**: `rgba()` edges add up to near-white. Edge colors are opaque hexes pre-blended over the surface (`palette.ts`).
- **sigma does not see container resizes** (the page panel opening): `Sigma2D` resizes it from a `ResizeObserver`.
- ForceAtlas2 in **LinLog** mode on content pages only; navigation pages (`index`, `_index`, `hot`, `log`, `overview`) link to everything and are placed afterwards at their neighbours' centroid. Hidden by default.
- **A hash-only navigation does not reload the page**: after `npm run build`, reload explicitly to see the new bundle.
- `git log -p` prints a tab after file names containing spaces (`+++ b/a b.md\t`); link dates recorded under an old path are re-keyed through renames (`followRenames`).
- `3d-force-graph`: `zoomToFit` needs the warm-up done; positions are seeded from the 2D layout so the first frame is already close to the final shape.
- Orphan check skips navigation pages and folds (folds are reachable through `folds/_index` by design); asymmetric-relation check only for predicates that have an inverse (`depends_on`, `part_of`, `related_to` have none).
