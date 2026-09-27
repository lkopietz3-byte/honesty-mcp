# Engineering contract

## Invariants (the promises the code is tested against)

1. Every tool handler either returns a normal `CallToolResult` (including a
   verdict the caller reads as "this fails the check") or catches the
   underlying error and returns `errorResult(...)` with `isError: true`.
   A tool call never throws past the handler and never crashes the server.
2. `check_payout_invariance` (runtime mode), `check_mutation_invariance`,
   and `compute_divergence` (`config.groupBySource`) never call
   caller-supplied JS source on the main thread. They go through
   `runFunctionJob` (`src/lib/runFunctionJob.ts`), which runs it in a
   `worker_threads` Worker and `terminate()`s it if it doesn't finish within
   `HONESTY_MCP_WORKER_TIMEOUT_MS` (default 10000ms). This bounds time only
   — it is not a sandbox and does not restrict filesystem/network/env access.
3. Every tool handler calls the wrapped kit's real, unmodified export. This
   server does not reimplement grounding, invariance, trust scoring,
   provenance validation, claims staleness, audit-chain hashing, or
   decision grading — it only translates between MCP/Zod and the kit's own
   types.
4. `SERVER_VERSION` (`src/server.ts`) and `package.json`'s `version` are two
   separate values with no automated sync — bump both by hand on release.
5. Zero runtime dependencies beyond `@modelcontextprotocol/sdk`, `zod`, and
   the eleven `file:`-linked sibling kits.

## Setup and verification

```bash
npm install             # also resolves the 11 sibling file: dependencies
npm run verify           # lint + typecheck + test + build + smoke
npm audit --include=dev
```

`npm run verify` runs, in order: `eslint . --max-warnings=0`,
`tsc --noEmit`, `vitest run`, `tsc -p tsconfig.build.json`, and
`node dist/smoke.js` (a real MCP client/server handshake over
`InMemoryTransport`, listing every tool and calling one end-to-end).

No `verify:package`/consumer-probe step and no CI workflow here, unlike the
sibling kits: both are library-publishing concerns, and this package is
`private: true` with a `bin`, whose `file:` sibling dependencies CI cannot
resolve without also checking out (or publishing) all eleven kits first.
See the report's "Decisions for Lucas" for the CI options considered.

## What this is NOT certified to do

- Does not prove any wrapped kit's claim beyond what that kit's own README
  "Honest limits"/"Limits" section says as of the 2026-09-24 sibling-kit
  commits this was checked against; a later kit change could drift from
  this server's wording again with nothing to catch it automatically.
- The worker-thread timeout (invariant 2) bounds time, not behavior.
  Caller-supplied source can still read the filesystem, the network, or
  environment variables — same trust model as this process itself. Don't
  expose this server to untrusted, remote, or adversarial tool arguments.
- `grade_decision`'s verdict (and `secondary.wouldBeVerdict`) is a threshold
  count, not a rate comparison — `holding` can come back while the
  underlying bad rate rose. Read `badRateDelta` alongside it.

## Release and rollback

Not yet published (0.1.0). To release: bump `version` in `package.json` AND
`SERVER_VERSION` in `src/server.ts` (see invariant 4), add a CHANGELOG
entry, tag the commit. No published version to roll back yet; once one
exists, this server keeps no state of its own, so rollback is just pointing
the MCP client config at a previous tagged build and restarting it.
