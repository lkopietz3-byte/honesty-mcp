# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-24

First release. Not yet published to npm, and not independently installable
today: it depends on its eleven sibling "honesty SDK" kits via local `file:`
paths (see README, "Status"). Install from git once the kits are published,
or run it in place next to all eleven sibling checkouts.

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
