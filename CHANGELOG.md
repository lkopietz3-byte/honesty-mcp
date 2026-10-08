# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-10-07

### Security

- Requires `@modelcontextprotocol/sdk` ^1.32.1, which fixes GHSA-6qxp-vccf-f47h (OAuth client credential handling). This server only uses the SDK's stdio server transport and never used the affected OAuth client code; the new minimum keeps installs off the affected versions.
- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q).

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/) for the kits.
- Added the `honesty-kits` npm keyword so the family shows up together in search.
- The release workflow now also publishes `server.json` to the MCP registry, signing in with the workflow's GitHub identity (OIDC) after npm lists the new version. It checks that `server.json` matches `package.json` first.

## [0.2.0] - 2026-09-30

Upgrades every wrapped kit to its audited release and brings the tool text in
line with what each kit actually checks. Some inputs the server used to accept
are now tool errors, so this is a minor (0.x) release.

### Changed

- Kit dependencies: claims-registry-kit `^0.3.0`; grounding-kit,
  corroboration-kit, payout-invariance-kit, mutation-invariance-kit,
  trust-core, provenance-kit, audit-chain-kit, advice-ledger-kit,
  agent-receipt-kit and cost-governor-kit `^0.2.0`.
- `assess_anonymous_authenticity`: when no signal carries weight (zero
  confidence, zero source weight or fully decayed recency), the kit reports
  `trustScore: null` with `insufficient` confidence. The summary now says no
  evidence-backed assessment is available and gives the kit's reason, instead
  of printing a default score. Summaries show eligible vs submitted signal
  counts and forward the kit's explanation. The description uses pattern
  language only: it does not detect fabrication or verify independence.
- `score_trust_identified`: with no weighted evidence, the summary says the
  score is the supplied prior, not a measured score, and shows the
  `insufficient` confidence reason. Summaries show eligible vs submitted
  signal counts.
- `corroborate_evidence`: the summary and description lead with the kit's
  own `direction` field. A `confirmed` verdict with direction `contradicts`
  means the evidence strongly contradicts the claim.
- `assess_anonymous_authenticity`: a signal whose `source` is not in
  `sourceWeights` now has credibility 0 and carries no weight (trust-core
  0.2.0). Previously it still counted toward the score.
- `check_grounding`: summaries separate structural cleanliness from truth and
  report checked units and placeholders.
- `check_claims_registry`: the description no longer says `check_grounding`
  can confirm that evidence supports a claim. The text summary escapes
  control and bidi characters as `\uXXXX`; the JSON report keeps raw strings.
- `check_provenance_claims`: removed the unsupported incident wording from the
  description, described the clause-bounded negation rule, and a clean result
  now reads "no wording offenses found under the configured rules (this does
  not verify the claims)".
- `grade_decision` / `compute_divergence`: descriptions give the kit's strict
  date grammar (`YYYY-MM-DD` is UTC midnight; timestamps need seconds and an
  explicit zone) instead of "compared as strings". Divergence summaries show
  the required counts and use the kit's new wording, including the non-causal
  note.
- `scaffold_agent_receipts`: step 4 says to act on `receipt.accepted` and
  read it as "no mismatch found", not verified truth, and points to
  `receipt.coverage`. Both scaffold tools now give `npm install` as the
  install step, since every kit is on npm.
- `scaffold_cost_governor`: the starter snippet detects `commitError` with
  `Object.hasOwn`, so a falsy rejection value is not missed, and the guidance
  lists the kit's plain-object and model-id input rules.

### Now rejected (tool errors instead of results)

- `check_claims_registry` `now`: a timestamp without a zone, or an impossible
  date, is rejected instead of being read as local time or rolled forward.
  `now` follows the kit's own `verifiedAt` rules. Claim ids that show nothing
  (empty, whitespace or invisible characters) are rejected by the kit.
- `grade_decision`: `decidedAt` or a matching `observedAt` outside the strict
  grammar is rejected by the kit. So is a `recommendation.id`,
  `recommendation.subjectId` or `decision.recommendationId` that shows nothing
  (empty, whitespace or invisible characters); these used to return a
  `refused` grade.
- `score_trust_identified`: inputs that make a derived value overflow are
  rejected. Before, a huge `dial` (for example `1e308`) returned a score
  clamped to 100, and very large weights could return `NaN` or `Infinity`.
- `corroborate_evidence`: a `source` made only of whitespace, control,
  invisible formatting characters or the braille blank.
- `verify_audit_chain`: an `anchor.entryHash` made only of whitespace or
  invisible characters.
- `check_payout_invariance` (`static-imports`): an empty `files` list or map
  (previously reported CLEAN over 0 files), or a blank payout identifier.
- `check_grounding`: `text` longer than 2,000,000 characters.

## [0.1.1] - 2026-09-28

### Fixed

- `check_payout_invariance` (runtime mode), `check_mutation_invariance` and
  `compute_divergence` with `groupBySource` failed with "Cannot find package"
  whenever the server was launched from a folder that didn't itself have the
  kits installed. That includes `npx honesty-mcp` and `claude mcp add`. The
  worker now imports each kit by an absolute URL resolved from honesty-mcp's
  own install location, not from the working directory.
- Output printed by caller-supplied code (`console.log`, `console.error`,
  `process.stdout.write`) could appear on stdout and corrupt the MCP
  protocol stream. Worker output is now captured and written to stderr,
  prefixed and capped at 16 KiB per call.
- `HONESTY_MCP_WORKER_TIMEOUT_MS` accepted values above 2147483647 ms, which
  Node turns into a 1 ms timer. Such values are now rejected with a clear
  error.

### Added

- `npm run stdio-probe`: launches the built server as a real stdio process
  from an empty folder, calls every code-running tool, and checks that every
  stdout line is JSON-RPC.
- `npm run verify:installed`: runs the same probe against the packed and
  installed package. Both now run in `npm run verify` and in CI.

### Changed

- The release workflow must run on a `v*` tag that matches `package.json`
  (for manual runs too), runs the dependency audit, and fails when the
  registry state can't be determined instead of assuming "not published".

## [0.1.0] - 2026-09-24

First release, prepared for its first publish to npm and for listing on the
official MCP registry as `io.github.lkopietz3-byte/honesty-mcp`. Its eleven
sibling "honesty SDK" kits are now all published to npm too, so this
package depends on them via ordinary semver ranges instead of local `file:`
paths — `npm install` or `npx honesty-mcp` resolves everything from the
registry, with nothing else to check out first.

### Added

- An MCP server (`createServer()` in `src/server.ts`, stdio transport via
  `src/index.ts`) exposing 14 tools over 9 wrapped kits: `check_grounding`,
  `corroborate_evidence`, `check_payout_invariance`, `check_mutation_invariance`,
  `score_trust_identified`, `assess_anonymous_authenticity`,
  `check_provenance_claims`, `check_claims_registry`, `append_audit_entry`,
  `verify_audit_chain`, `grade_decision`, `compute_divergence`,
  `scaffold_agent_receipts`, and `scaffold_cost_governor`. Every tool is a
  Zod input schema plus a handler that imports and calls the real,
  unmodified export from the wrapped kit — this server does not reimplement
  any of the underlying logic.
- `check_payout_invariance` (runtime mode), `check_mutation_invariance`, and
  `compute_divergence` (`config.groupBySource`) accept caller-supplied JS
  function source and run it inside a `worker_threads` Worker with a
  bounded timeout (default 10s, override with
  `HONESTY_MCP_WORKER_TIMEOUT_MS`) instead of on the server's own main
  thread, so a `while (true) {}` source string can no longer hang the whole
  server. This is not a sandbox — the worker has this process's full
  OS-level privileges — it only bounds wall-clock time. See README, "A note
  on the code-execution tools".
- `npm run smoke` (`src/smoke.ts`): a standalone script that builds the real
  server, connects a real MCP `Client` over an in-memory transport, lists
  every tool, and calls one end-to-end — a fast "does this actually work"
  check independent of the vitest suite.
- `test/server.test.ts`: end-to-end tests over a real in-memory MCP
  client/server pair, covering every tool's known-good and known-bad input.
  `test/buildFunction.test.ts`, `test/runFunctionJob.test.ts`, and
  `test/workerTimeout.test.ts` cover the source-to-function builder and its
  worker-thread timeout enforcement specifically.
- Zero runtime dependencies beyond `@modelcontextprotocol/sdk`, `zod`, and
  the eleven wrapped kits themselves.

### Fixed (pre-publish; no prior published version to compare against)

- `check_payout_invariance` imported from the sibling kit's old package name
  (`payout-invariance`); the kit was renamed to `payout-invariance-kit`
  before this release. Both the `package.json` dependency key and the
  import specifier now use the current name.
- `check_payout_invariance`, `check_mutation_invariance`, and
  `compute_divergence` called caller-supplied code synchronously in-process
  with no timeout (see "Added" above for the fix).
- Several tool descriptions overclaimed relative to what the wrapped kit's
  own README documents as its honest limits (e.g. "proves" instead of
  "checks, for the scenarios tested", and "astroturf detection" instead of
  "a heuristic discount, not a fraud detector"). Rewritten to match each
  kit's own "Honest limits" section.
- `verify_audit_chain`'s description implied `expectedMinLength` alone
  detects any tail truncation; it does not catch a truncate-and-re-append
  (deleting tail entries and re-appending new ones back to the same
  length). The new optional `anchor` parameter (a checkpoint from
  audit-chain-kit's `verifyChain`) does.
- `scaffold_cost_governor` described `withReserveConfirm` as "reserve-then-
  confirm atomic usage counting" and its reference SQL as "concurrency-safe"
  — both false per cost-governor-kit's own review. Rewritten to say
  "advisory check-then-commit, not a concurrency-safe reservation" and to
  name `withCapacityReservation` as the kit's actual strict-limit path.
- `append_audit_entry`/`verify_audit_chain`'s hand-written `chainEntrySchema`
  was missing audit-chain-kit's `formatVersion` field (hashed into every
  entry as of that kit's `FORMAT_VERSION = "audit-chain-kit/v1"`), so every
  chain round-tripped through this server's schema had `formatVersion`
  silently stripped and then failed `verifyChain`'s own version check.
  Added the field to the schema.
- `grade_decision`'s description said the verdict "ignores" the exposed bad
  rate and is a pure threshold count. advice-ledger-kit's `gradeDecision`
  now also returns `not-holding` when the exposed rate exceeds the
  baseline's, even below `refuteThreshold`; the description and README row
  were rewritten to state the real (count-or-rate) rule.
- `scaffold_cost_governor`'s guidance said a failed `commitUsage` "discards
  the successful result" from `withReserveConfirm`. cost-governor-kit's
  `withReserveConfirm` now returns `{ allowed: true, result, commitError }`
  instead of discarding it; the guidance, starter snippet, and worked
  example were rewritten to match, and `ModelRates.cacheReadPerMillion`
  (replaces the fixed 0.1x cache-read ratio) is now documented and
  demonstrated.
- `score_trust_identified` called trust-core's `scoreEntity` with an
  `asOf` option; trust-core renamed that clock option to `now` (matching
  `assessAuthenticity` and sibling kits), so every call silently got
  `now: undefined` and threw "now must be an ISO 8601 timestamp string
  (got undefined)". Renamed the tool's own `asOf` input to `now` to match.
- `corroborate_evidence`'s `coverage.totalUnits` description said a
  value `<= 0` is "treated as thin"; corroboration-kit's `coverageOf` now
  throws `RangeError` on a negative `totalUnits` or a `sampledUnits`
  greater than `totalUnits` (an impossible sample) instead of silently
  computing a coverage level. The tool already surfaced this correctly as
  a clean tool error via its existing try/catch; only the description was
  wrong. Corrected it and added a regression test.

### Changed

- Switched all eleven wrapped-kit dependencies from local `file:../<kit>`
  paths to published npm semver ranges (`^0.2.0` for claims-registry-kit,
  `^0.1.1` for eight kits, `^0.1.0` for trust-core and cost-governor-kit).
- Removed `"private": true`; added `prepublishOnly` (runs the full verify
  pipeline) and `mcpName` (required by the MCP registry to verify npm
  package ownership); made `dist/index.js` executable as part of `build`.
- Added `server.json` for the official MCP registry (npm package entry,
  stdio transport), validated against the published schema.
- Added `.github/workflows/verify.yml`: audit, lint, typecheck, test,
  build, and smoke on Node 26.3.0, plus a Node 20/22/24 compatibility job
  — not possible before the sibling kits were on npm (CI can't resolve
  `file:../<kit>` paths, and several sibling repos were private).
