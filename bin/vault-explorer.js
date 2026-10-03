#!/usr/bin/env node
// Entry for `npm link` / the package `bin`: the server is TypeScript that Node
// runs natively (type stripping), so this shim only forwards to it.
import '../src/server/main.ts';
