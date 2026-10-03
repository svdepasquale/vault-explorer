<!-- Thanks for the contribution. Please fill in the sections below. -->

## Summary

<!-- What does this PR change and why? One or two paragraphs. -->

## Type of change

- [ ] Bug fix
- [ ] New feature / view / health check
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] CI / tooling
- [ ] Dependency bump

## Checklist

- [ ] `npm run check` passes (typecheck, tests, build)
- [ ] Parser and server changes come with a test; a bug left open is an `it.fails` that names it
- [ ] The server still never writes inside the vault and still answers only on `127.0.0.1`
- [ ] Code under `src/core`, `src/server` and `src/shared` stays erasable TypeScript (no enums, namespaces or parameter properties; `.ts` extensions in imports)
- [ ] Changes to `src/shared/model.ts` are reflected on both sides (server and SPA)
- [ ] Fixtures, screenshots and logs are synthetic: no real vault pages, names, hostnames or IPs
- [ ] No secrets or credentials are included in the diff

## Related issues

Closes #

## Notes for reviewers

<!-- Screenshots of the affected view, API changes, test evidence -->
