# honesty-mcp

An MCP (Model Context Protocol) server that exposes eleven already-built,
zero-runtime-dependency "honesty SDK" TypeScript libraries as tools any
MCP-compatible coding agent (Claude Code, Claude Desktop, or any other MCP
client) can call while building or auditing a product — grounded-citation
checking, evidence corroboration grading, payout/mutation-invariance checks
(scenario-tested, not a formal proof for every possible input), trust/
authenticity scoring, provenance-claim validation, a claims registry, a
tamper-evident audit chain, and recommendation/decision grading plus
engine-vs-human divergence, plus scaffolding for two runtime-library kits
that don't fit the "check this content" shape.

This server is thin by design: every tool is a Zod input schema plus a
handler that imports and calls the real, unmodified export from the wrapped
kit. It does not reimplement any of the underlying logic.

## Status: monorepo-adjacent, not yet npm-installable

**This package depends on its eleven sibling kits via local `file:` paths**
(e.g. `"grounding-kit": "file:../grounding-kit"`), because none of them are
published to npm yet. That means `honesty-mcp` only works if it sits next
to all eleven sibling directories, exactly as laid out today:

```
~/grounding-kit/
~/corroboration-kit/
~/payout-invariance-kit/
~/mutation-invariance-kit/
~/trust-core/
~/provenance-kit/
~/claims-registry-kit/
~/audit-chain-kit/
~/advice-ledger-kit/
~/agent-receipt-kit/
~/cost-governor-kit/
~/honesty-mcp/                <- this package
```

`npm install` resolves each dependency by walking up to the parent
directory and symlinking the sibling folder into `node_modules`. If you
move `honesty-mcp` somewhere else, update the relative paths in
`package.json`'s `dependencies` block (or, once these kits are published,
switch each one to a real npm version range). This is not yet an
independently installable package — say so plainly to anyone using it.

## What's in each sibling kit, and whether it needed a build fix

Three of the eleven sibling kits originally pointed their `package.json`
`main`/`exports` fields directly at raw `src/*.ts` with no `build` script —
that resolves fine for a TypeScript-aware bundler inside the same
monorepo, but not for a plain `file:` dependency loaded by Node's own
module resolver. Each of those three got a **minimal, source-preserving
fix** (no `src/` or test changes) so `npm install && npm run build` in
`honesty-mcp` actually resolves them:

| Kit | Problem found | Fix applied |
|---|---|---|
| `grounding-kit` | `main`/`exports` already pointed at `dist/`, but `dist/` didn't exist yet (no prior build run) | None needed — ran `npm run build` once to produce `dist/`. |
| `payout-invariance-kit` | `main`/`exports`/`types` pointed straight at `src/index.ts`; no `build` script existed | Added `tsconfig.build.json`, added a `build` script (`tsc -p tsconfig.build.json`), repointed `main`/`module`/`types`/`exports` at `./dist/*`. The package was also later renamed from `payout-invariance` to `payout-invariance-kit`; this repo's `package.json` dependency key and its one import specifier (`src/tools/payoutInvariance.ts`) are updated to match. |
| `mutation-invariance-kit` | Same problem, plus a `./presets` subpath export also pointing at raw `src/` | Same fix, extended to the `./presets` subpath; `tsconfig.build.json` excludes `*.test.ts` so test files aren't emitted into `dist/`. |
| `cost-governor-kit` | Had a `"build": "tsc"` script, but it emitted alongside `main`/`exports` still pointing at `src/*.ts`, and would have emitted its `*.test.ts` files into `dist/` too | Added `tsconfig.build.json` (excludes `*.test.ts`), repointed `build` at it, repointed `main`/`module`/`types`/`exports` (including the `./pricing`, `./preCallCeiling`, `./reserveConfirm` subpaths) at `./dist/*`. |
| `corroboration-kit`, `trust-core`, `provenance-kit`, `claims-registry-kit`, `audit-chain-kit`, `agent-receipt-kit`, `advice-ledger-kit` | None — already had a `dist/` build step correctly wired | No changes. |

After each fix, that kit's own `npm test` and `npm run typecheck` were
re-run and still pass — nothing in `src/` or any `*.test.ts` file was
touched, only `package.json` and a new `tsconfig.build.json`.

(`advice-ledger-kit` was wired in after the other ten, once it existed —
its `package.json`/`exports` already pointed at `./dist/*` with a working
`build` script, same shape as the "no changes" row above, so it needed no
fix either.)

## Running it

```bash
cd ~/honesty-mcp
npm install       # resolves the 11 sibling file: dependencies too
npm run build      # compiles src/ -> dist/
npm start           # runs dist/index.js on stdio
```

`npm start` (equivalently `node dist/index.js`) starts the server on the
**stdio transport** — it reads JSON-RPC requests from stdin and writes
responses to stdout, logging only a one-line startup banner to stderr so
stdout stays a clean JSON-RPC channel. This is the transport Claude Code,
Claude Desktop, and most local/CLI MCP client integrations expect for a
locally-run server; it is not an HTTP server and has no port to browse to.

## Configuring it in an MCP client

Add an entry to your client's MCP server config (Claude Code's
`.mcp.json` / `claude mcp add`, or Claude Desktop's
`claude_desktop_config.json` both use this same `mcpServers` shape):

```json
{
  "mcpServers": {
    "honesty-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/honesty-mcp/dist/index.js"]
    }
  }
}
```

Or, via the Claude Code CLI:

```bash
claude mcp add honesty-mcp -- node /absolute/path/to/honesty-mcp/dist/index.js
```

`/absolute/path/to/honesty-mcp` is a placeholder — substitute wherever you
actually cloned this repo (e.g. `~/honesty-mcp` expanded to its real path).
Use an absolute path to `dist/index.js` — the client launches this as a
subprocess from its own working directory, not from `~/honesty-mcp`.

## Tools

**9 content-checking tools' worth of kits, 12 tools** (kits 1–9 — hand one
of these real content or data, get back a structured verdict):

| Tool | Wraps | One-line purpose |
|---|---|---|
| `check_grounding` | grounding-kit | Detects ungrounded or forged citations in AI-generated text, sentence by sentence. |
| `corroborate_evidence` | corroboration-kit | Grades confidence in a claim from independent evidence signals — not a vote count. |
| `check_payout_invariance` | payout-invariance-kit | Checks, for the scenarios you supply, whether a ranking engine's output changes with who pays more (`runtime` mode) or whether payout identifiers appear in its source at all (`static-imports` mode). Not a formal proof for every possible payout configuration. |
| `check_mutation_invariance` | mutation-invariance-kit | Checks, for the scenarios you supply, whether a decision/score/ranking function's output depends on a variable it claims not to (protected attribute, geography, price, or anything you name). Not a formal proof for every possible input. |
| `score_trust_identified` | trust-core (`identified`) | Scores an entity from known, identified contributors (reviewer accounts, raters, inspectors). |
| `assess_anonymous_authenticity` | trust-core (`anonymous`) | Scores unattributed/scraped sentiment on how organic it looks, with a heuristic discount for two specific manipulation patterns (source concentration, suspiciously uniform sentiment) — not a fraud detector. |
| `check_provenance_claims` | provenance-kit | Flags certainty-implying language ("(verified)", "guaranteed") not backed by an appropriate provenance tier. |
| `check_claims_registry` | claims-registry-kit | Buckets public-facing claims as current / stale / unverified against their linked evidence and last-verified date. |
| `append_audit_entry` | audit-chain-kit | Appends one entry to a hash-chained, tamper-evident audit log. |
| `verify_audit_chain` | audit-chain-kit | Independently re-verifies a hash chain from genesis; detects mutation and severed links unconditionally, plain tail deletion with `expectedMinLength`, and truncate-and-re-append (or a full rewrite) only with `anchor` — `expectedMinLength` alone does NOT catch a truncate-and-re-append. |
| `grade_decision` | advice-ledger-kit | Grades one recommendation-and-decision pair against a before/after observation log — exposure-aligned, with separate floors per window and machine-readable refusal codes. `holding` requires both the exposed bad count to stay under `refuteThreshold` AND its bad rate to not exceed the baseline's (exact comparison, not the rounded `badRate`); either failing is `not-holding` (see the tool description). |
| `compute_divergence` | advice-ledger-kit | Measures how often an engine and a human disagreed, and where a later outcome exists, reports engine-right/human-right as separate, never-blended counts. |

**2 scaffolding tools** (agent-receipt-kit, cost-governor-kit — these are
runtime libraries a project *installs and imports into its own running
code*, not something checked on-demand the same way; see the code comments
in `src/tools/agentReceiptScaffold.ts` / `costGovernorScaffold.ts` for why a
"check this content" shape would misrepresent them):

| Tool | Wraps | One-line purpose |
|---|---|---|
| `scaffold_agent_receipts` | agent-receipt-kit | Explains the issue-a-packet / verify-the-claim authorization pattern for AI agents, with an install step, a starter snippet, and (optionally) a live accepted/rejected worked example run against the real kit. |
| `scaffold_cost_governor` | cost-governor-kit | Explains the estimated pre-call spend check + cache-aware pricing math + advisory (not concurrency-safe) check-then-commit usage-counting pattern, with an install step, a starter snippet, and (optionally) a live worked example. |

That's 9 kits, 12 content-checking tool slots (payout-invariance-kit,
audit-chain-kit, and advice-ledger-kit each got 2 tools instead of 1, since
each bundles two genuinely distinct operations — runtime check vs. static
grep; append vs. verify; grading one decision vs. measuring divergence
across a whole population — that read better as separate, single-purpose
MCP tools than as one tool with a mode switch) plus 2 scaffolding tools =
**14 tools total**.

### A note on the code-execution tools

`check_payout_invariance` (runtime mode) and `check_mutation_invariance`
both wrap kit functions whose real signature takes an actual JavaScript
**function** (a ranking function, a mutation closure) — there is no way to
represent a function as MCP JSON arguments. Both tools accept that function
as a **source-code string** and build the real function via the `Function`
constructor (`src/lib/buildFunction.ts`) before calling the unmodified kit
export with it. `compute_divergence`'s optional `config.groupBySource` uses
the same mechanism for advice-ledger-kit's `groupBy` config function, but
only when a caller actually supplies it — omitting it (the common case)
needs no code execution at all, since the library's own default groups by
each pair's `group` field. This is equivalent to `eval` for that one
string. It is appropriate here because this is a local, stdio-only dev tool
a coding agent runs against its own project's code — the same trust model
as that agent running `node -e`, `vitest run`, or any other local
code-execution tool — and it is **not** designed to be exposed to
untrusted, remote, or adversarial input. Don't wire this server up to
accept tool arguments from anyone other than the trusted local agent
driving it.

**All three of these run inside a `worker_threads` Worker with a bounded
timeout** (`src/lib/runFunctionJob.ts`), not on the server's own main
thread. Earlier versions called the built function synchronously in-process,
so a `while (true) {}` source string would block the *entire* stdio server
forever — every other in-flight or future tool call along with it. Now, if
the worker doesn't finish within the timeout (default **10 seconds**,
override with the `HONESTY_MCP_WORKER_TIMEOUT_MS` environment variable, in
milliseconds), it is forcibly `terminate()`d and the tool call returns a
clear timeout error instead of hanging. **This is not a sandbox** — the
worker has this process's full OS-level privileges (filesystem, network,
environment variables) — it only bounds *time*. It does not stop caller
code from reading your filesystem, making network requests, or doing
anything else this Node process itself can do. The trust model above still
applies in full: only pass code you wrote or trust, and don't expose this
server to untrusted, remote, or adversarial input.

## Honest limits

- **This server adds no guarantee beyond what the kit it wraps already
  documents.** Every tool description was checked against its kit's own
  README "Honest limits"/"Limits" section as of the sibling-kit commits
  this branch was built against — read that kit's README for the full
  detail behind any one-line tool description or table row here. If a
  kit's own limits change later, this server's wording can drift out of
  sync again; nothing here re-checks that automatically.
- **`check_payout_invariance`, `check_mutation_invariance`, and
  `compute_divergence`'s worker-thread timeout bounds time only, not
  behavior** — see "A note on the code-execution tools" above. It is not a
  sandbox.
- **Not independently installable yet** — see "Status" above. This is not a
  limit in the wrapped kits' logic, but it is a real limit on using this
  server at all right now.
- **`SERVER_VERSION` (`src/server.ts`) and `package.json`'s `version` are
  two separate values with no automated sync.** They happen to agree today;
  a future release could forget to bump one.

## Development

```bash
npm run lint         # eslint . --max-warnings=0
npm run typecheck   # tsc --noEmit over src/ + test/
npm test             # vitest — spins up a real MCP Client/Server pair
                      # over the SDK's InMemoryTransport and calls tools
                      # end-to-end (see test/*.test.ts)
npm run build        # tsc -p tsconfig.build.json -- compiles src/ -> dist/
npm run smoke        # npm run build first, then node dist/smoke.js --
                      # a standalone script that does the same real
                      # client/server handshake, lists all tools, and
                      # calls one end-to-end
npm run verify       # lint + typecheck + test + build + smoke, in order
npm run audit:dependencies   # npm audit --package-lock-only --include=dev
                              # --ignore-scripts --audit-level=low
```

## Project layout

```
src/
  index.ts                    entrypoint: connects the server to stdio
  server.ts                   createServer() -- builds the McpServer and registers every tool
  smoke.ts                    standalone smoke-test script (see npm run smoke)
  lib/
    result.ts                 CallToolResult helpers (jsonResult / errorResult)
    buildFunction.ts           turns a JS source string into a callable function
    runFunctionJob.ts          runs that function (or the divergence groupBySource case)
                               inside a worker_threads Worker with a bounded timeout
  tools/
    grounding.ts
    corroboration.ts
    payoutInvariance.ts
    mutationInvariance.ts
    trustIdentified.ts
    trustAnonymous.ts
    provenance.ts
    claimsRegistry.ts
    auditChain.ts               (append_audit_entry + verify_audit_chain)
    adviceLedger.ts              (grade_decision + compute_divergence)
    agentReceiptScaffold.ts
    costGovernorScaffold.ts
test/
  server.test.ts               end-to-end tests over a real in-memory MCP client/server pair,
                                covering every tool's known-good and known-bad input
  buildFunction.test.ts        unit tests for the source-string -> function builder
  runFunctionJob.test.ts       unit tests for the worker-thread job runner (normal jobs,
                                error propagation, timeout enforcement, env var parsing)
  workerTimeout.test.ts        end-to-end proof that the three code-execution tools stay
                                bounded by the worker-thread timeout instead of hanging
```
