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

## Install

`honesty-mcp` is published on npm and wraps its eleven sibling "honesty SDK"
kits as ordinary registry dependencies (semver ranges, not local `file:`
paths) — `npm install` (or a plain `npx`) resolves everything from the
public registry, with nothing else to check out first.

The fastest way to run it, with no install step at all:

```bash
npx honesty-mcp
```

Or add it to a project:

```bash
npm install honesty-mcp
```

### Adding it to an MCP client

Claude Code:

```bash
claude mcp add honesty-mcp -- npx -y honesty-mcp
```

Any other MCP client that reads an `mcpServers` config (Claude Desktop's
`claude_desktop_config.json` uses the same shape):

```json
{
  "mcpServers": {
    "honesty-mcp": {
      "command": "npx",
      "args": ["-y", "honesty-mcp"]
    }
  }
}
```

The server runs on the **stdio transport** — it reads JSON-RPC requests
from stdin and writes responses to stdout, logging only a one-line startup
banner to stderr so stdout stays a clean JSON-RPC channel. This is the
transport Claude Code, Claude Desktop, and most local/CLI MCP client
integrations expect for a locally-run server; it is not an HTTP server and
has no port to browse to.

### Listing in the MCP registry

`honesty-mcp` also ships a `server.json` (validated against the official
schema) so it can be listed on the
[official MCP registry](https://github.com/modelcontextprotocol/registry),
under the name `io.github.lkopietz3-byte/honesty-mcp`. Listing is a manual,
one-time step the maintainer runs after this package is on npm — it is
**not** run as part of this repo's CI or `npm publish`. Exact commands,
from the registry's own docs
([publishing guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx),
[CLI reference](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)):

```bash
# 1. Install the publisher CLI (macOS/Linux)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/

# 2. Log in with GitHub (proves ownership of the io.github.lkopietz3-byte namespace)
mcp-publisher login github

# 3. Publish (validates server.json against the schema, then submits it)
mcp-publisher publish
```

`package.json`'s `mcpName` field (`io.github.lkopietz3-byte/honesty-mcp`)
must match `server.json`'s `name` field exactly — that's how the registry
verifies the npm package and the registry listing belong to the same
publisher (see
[package-types.mdx, "Ownership Verification"](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx)).

## Tools

**9 content-checking tools' worth of kits, 12 tools** (kits 1–9 — hand one
of these real content or data, get back a structured verdict):

| Tool | Wraps | One-line purpose |
|---|---|---|
| `check_grounding` | grounding-kit | Checks citation structure in AI-generated text, sentence by sentence: uncited claims, honest placeholders, and citations whose marker is missing or whose evidence doesn't match lexically. Structural only; it does not verify that the evidence is true. |
| `corroborate_evidence` | corroboration-kit | Reports the evidence direction (supports / contradicts / mixed / none) and a graded verdict from distinct sources — not a vote count. Independence is not verified, and `confirmed` can mean confirmed-contradicted, so read the direction first. |
| `check_payout_invariance` | payout-invariance-kit | Checks, for the scenarios you supply, whether a ranking engine's output changes with who pays more (`runtime` mode) or whether payout identifiers appear in its source at all (`static-imports` mode). Not a formal proof for every possible payout configuration. |
| `check_mutation_invariance` | mutation-invariance-kit | Checks, for the scenarios you supply, whether a decision/score/ranking function's output depends on a variable it claims not to (protected attribute, geography, price, or anything you name). Not a formal proof for every possible input. |
| `score_trust_identified` | trust-core (`identified`) | Scores an entity from known, identified contributors (reviewer accounts, raters, inspectors), shrinking thin evidence toward a prior. With no weighted evidence it returns the prior with `insufficient` confidence, not a measured score. |
| `assess_anonymous_authenticity` | trust-core (`anonymous`) | Scores unattributed/scraped sentiment on how organic it looks, with a heuristic discount for two specific patterns (source concentration, unusually uniform sentiment). It does not detect fabrication or verify independence, and it reports no score (`trustScore: null`) when no signal carries weight. |
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
| `scaffold_cost_governor` | cost-governor-kit | Explains the estimated pre-call spend check + cache-aware pricing math (default 0.1x cache-read rate, overridable per model via `cacheReadPerMillion`) + advisory (not concurrency-safe) check-then-commit usage-counting pattern (a commit failure after a successful call returns `commitError` instead of discarding the result), with an install step, a starter snippet, and (optionally) a live worked example. |

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
milliseconds, from 1 to 2147483647), it is forcibly `terminate()`d and the
tool call returns a clear timeout error instead of hanging. Anything the
supplied code prints (`console.log`, `console.error`, `process.stdout.write`)
is captured and written to the server's stderr with a
`[honesty-mcp worker]` prefix, capped at 16 KiB per call. It never reaches
stdout, which carries the MCP protocol. **This is not a sandbox** — the
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
- **`SERVER_VERSION` (`src/server.ts`) and `package.json`'s `version` are
  two separate values with no automated sync.** They happen to agree today;
  a future release could forget to bump one.

## Development

To work on this server itself (rather than just use it), clone the repo and
build from source:

```bash
git clone https://github.com/lkopietz3-byte/honesty-mcp.git
cd honesty-mcp
npm install          # resolves the 11 wrapped kits from the npm registry
npm run build         # compiles src/ -> dist/
npm start              # runs dist/index.js on stdio
```

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
