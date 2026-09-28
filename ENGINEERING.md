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
   the eleven published sibling kits (semver ranges, not `file:` links).

## Setup and verification

```bash
npm install             # resolves the 11 sibling kits from the npm registry
npm run verify           # lint + typecheck + test + build + smoke
npm audit --include=dev
```

`npm run verify` runs, in order: `eslint . --max-warnings=0`,
`tsc --noEmit`, `vitest run`, `tsc -p tsconfig.build.json`, and
`node dist/smoke.js` (a real MCP client/server handshake over
`InMemoryTransport`, listing every tool and calling one end-to-end). It
also runs automatically as `prepublishOnly` before `npm publish`.

`.github/workflows/verify.yml` runs the same pipeline (plus
`audit:dependencies`) in CI on every push/PR, on Node 26.3.0, with a
separate Node 20/22/24 compatibility job. This wasn't possible before the
sibling kits were on npm: CI can't check out `file:../<kit>` sibling paths,
and several of those repos were private.

There is no `verify:package`/consumer-probe step here, unlike the sibling
kits — that's a library-publishing concept (pack a tarball, install it into
a scratch project, import it by name) that doesn't map cleanly onto a
`bin`-only CLI with no `exports`. The equivalent manual check (pack, install
the tarball into a scratch project, run a real stdio JSON-RPC handshake via
`npx`) was done once for the npm-publish-readiness pass; see the PR that
introduced it.

### History: build fixes made while these kits were still `file:`-linked

Before any of the eleven sibling kits were published, `honesty-mcp`
depended on them via local `file:../<kit>` paths, and three of them
(`payout-invariance-kit`, `mutation-invariance-kit`, `cost-governor-kit`)
needed a `tsconfig.build.json` and a real `build` script added — their
`main`/`exports` fields pointed straight at raw `src/*.ts`, which resolves
fine for a bundler inside the same monorepo but not for Node's own module
resolver loading a `file:` dependency. `payout-invariance-kit` was also
renamed from `payout-invariance` partway through; this repo's dependency
key and its one import specifier were updated to match. All of that is now
moot for installation (every kit is published with a working `dist/`
build), but it's why that rename shows up in this server's own git history.

## What this is NOT certified to do

- Does not prove any wrapped kit's claim beyond what that kit's own README
  "Honest limits"/"Limits" section says as of the 2026-09-24 sibling-kit
  commits this was checked against; a later kit change could drift from
  this server's wording again with nothing to catch it automatically.
- The worker-thread timeout (invariant 2) bounds time, not behavior.
  Caller-supplied source can still read the filesystem, the network, or
  environment variables — same trust model as this process itself. Don't
  expose this server to untrusted, remote, or adversarial tool arguments.
- `grade_decision`'s verdict (and `secondary.wouldBeVerdict`) is `holding`
  only when the exposed bad count stays under `refuteThreshold` AND the
  exposed bad rate does not exceed the baseline's (exact comparison of raw
  counts, not the rounded `badRate`/`badRateDelta` fields) — either
  condition failing gives `not-holding`. Read `badRateDelta` and the raw
  counts alongside the verdict regardless.

## Release and rollback

`npm run verify` (lint, typecheck, test, build, smoke) runs automatically before publish via
the `prepublishOnly` script, so a broken build cannot reach the registry by accident. To
release: bump `version` in `package.json` AND `SERVER_VERSION` in `src/server.ts` (see
invariant 4), add a dated `CHANGELOG.md` entry, commit, and push a `vX.Y.Z` tag that matches
the new version — `.github/workflows/release.yml` then installs, verifies, and publishes it.
(You can also run `npm publish` locally; `prepublishOnly` still guards it.) If also updating
the MCP registry listing, bump `server.json`'s `version` to match and re-run
`mcp-publisher publish` (see README, "Listing in the MCP registry").

npm's unpublish policy is deliberately narrow. Within 72 hours of publishing, a version can be
unpublished only if no other published package depends on it. After 72 hours, unpublishing also
requires fewer than 300 downloads in the last week and a single maintainer — most released
versions won't qualify either way. A given `name@version` can never be reused, published or
not, even after an unpublish. Treat unpublish as unavailable: prefer fixing forward with a new
patch version, and use `npm deprecate <name>@"<range>" "<message>"` to warn consumers off a bad
release. This server keeps no state of its own, so rollback for a consumer is just pointing
their MCP client config at a previous published version (`npx honesty-mcp@<version>`) or a
previous tagged build.

### Runtime support policy

- **Supported (recommended for production):** Node 22 and 24 LTS; Node 26 current.
- **Compatibility-tested:** Node 20. Node 20 is end-of-life — nodejs.org's release page
  (<https://nodejs.org/en/about/previous-releases>) lists it as `EOL`, with its final release
  dated Mar 24, 2026. The `compat` job in `verify.yml` still runs on Node 20 to catch
  regressions, but that runtime gets no security fixes upstream; don't run production traffic
  on it.
- CommonJS `require()` of this package needs Node >=20.19 or >=22.12 (`require(esm)`
  support). ESM `import` works on every version this package tests (20, 22, 24).
- `engines` in `package.json` is unchanged by this policy.

### Publishing with provenance

`.github/workflows/release.yml` publishes using npm trusted publishing: it triggers on
`workflow_dispatch` or a pushed `v*` tag, requests a short-lived OIDC token instead of
reading a stored npm token (`permissions: id-token: write`), and runs a plain `npm publish`
with no token and no `--provenance` flag, because provenance attestation is generated
automatically under trusted publishing. Before publishing, the workflow confirms the tag
matches `package.json`'s `version` and checks whether that version is already on the
registry, so re-running it on a version that's already published is a no-op rather than an
error. Trusted publishing must be configured for this package on npmjs.com (linking it to this
GitHub repository and the `release.yml` workflow) before the first automated release will
work.
