# honesty-mcp

An MCP (Model Context Protocol) server that exposes ten already-built,
zero-runtime-dependency "honesty SDK" TypeScript libraries as tools any
MCP-compatible coding agent (Claude Code, Claude Desktop, or any other MCP
client) can call while building or auditing a product — grounded-citation
checking, evidence corroboration grading, payout/mutation-invariance
proofs, trust/authenticity scoring, provenance-claim validation, a claims
registry, and a tamper-evident audit chain, plus scaffolding for two
runtime-library kits that don't fit the "check this content" shape.

This server is thin by design: every tool is a Zod input schema plus a
handler that imports and calls the real, unmodified export from the wrapped
kit. It does not reimplement any of the underlying logic.

## Status: monorepo-adjacent, not yet npm-installable

**This package depends on its ten sibling kits via local `file:` paths**
(e.g. `"grounding-kit": "file:../grounding-kit"`), because none of them are
published to npm yet. That means `honesty-mcp` only works if it sits next
to all ten sibling directories, exactly as laid out today:

```
~/grounding-kit/
~/corroboration-kit/
~/payout-invariance-kit/
~/mutation-invariance-kit/
~/trust-core/
~/provenance-kit/
~/claims-registry-kit/
~/audit-chain-kit/
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

Three of the ten sibling kits originally pointed their `package.json`
`main`/`exports` fields directly at raw `src/*.ts` with no `build` script —
that resolves fine for a TypeScript-aware bundler inside the same
monorepo, but not for a plain `file:` dependency loaded by Node's own
module resolver. Each of those three got a **minimal, source-preserving
fix** (no `src/` or test changes) so `npm install && npm run build` in
`honesty-mcp` actually resolves them:

| Kit | Problem found | Fix applied |
|---|---|---|
| `grounding-kit` | `main`/`exports` already pointed at `dist/`, but `dist/` didn't exist yet (no prior build run) | None needed — ran `npm run build` once to produce `dist/`. |
| `payout-invariance-kit` (npm name `payout-invariance`) | `main`/`exports`/`types` pointed straight at `src/index.ts`; no `build` script existed | Added `tsconfig.build.json`, added a `build` script (`tsc -p tsconfig.build.json`), repointed `main`/`module`/`types`/`exports` at `./dist/*`. |
| `mutation-invariance-kit` | Same problem, plus a `./presets` subpath export also pointing at raw `src/` | Same fix, extended to the `./presets` subpath; `tsconfig.build.json` excludes `*.test.ts` so test files aren't emitted into `dist/`. |
| `cost-governor-kit` | Had a `"build": "tsc"` script, but it emitted alongside `main`/`exports` still pointing at `src/*.ts`, and would have emitted its `*.test.ts` files into `dist/` too | Added `tsconfig.build.json` (excludes `*.test.ts`), repointed `build` at it, repointed `main`/`module`/`types`/`exports` (including the `./pricing`, `./preCallCeiling`, `./reserveConfirm` subpaths) at `./dist/*`. |
| `corroboration-kit`, `trust-core`, `provenance-kit`, `claims-registry-kit`, `audit-chain-kit`, `agent-receipt-kit` | None — already had a `dist/` build step correctly wired | No changes. |

After each fix, that kit's own `npm test` and `npm run typecheck` were
re-run and still pass — nothing in `src/` or any `*.test.ts` file was
touched, only `package.json` and a new `tsconfig.build.json`.

## Running it

```bash
cd ~/honesty-mcp
npm install       # resolves the 10 sibling file: dependencies too
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
      "args": ["/Users/lucaskopietz/honesty-mcp/dist/index.js"]
    }
  }
}
```

Or, via the Claude Code CLI:

```bash
claude mcp add honesty-mcp -- node /Users/lucaskopietz/honesty-mcp/dist/index.js
```

Use an absolute path to `dist/index.js` — the client launches this as a
subprocess from its own working directory, not from `~/honesty-mcp`.

## Tools

**8 content-checking tools** (kits 1–8 — hand one of these real content or
data, get back a structured verdict):

| Tool | Wraps | One-line purpose |
|---|---|---|
| `check_grounding` | grounding-kit | Detects ungrounded or forged citations in AI-generated text, sentence by sentence. |
| `corroborate_evidence` | corroboration-kit | Grades confidence in a claim from independent evidence signals — not a vote count. |
| `check_payout_invariance` | payout-invariance-kit | Proves a ranking engine's output doesn't change with who pays more (`runtime` mode) or never even references payout identifiers (`static-imports` mode). |
| `check_mutation_invariance` | mutation-invariance-kit | Proves a decision/score/ranking function's output doesn't depend on a variable it claims not to (protected attribute, geography, price, or anything you name). |
| `score_trust_identified` | trust-core (`identified`) | Scores an entity from known, identified contributors (reviewer accounts, raters, inspectors). |
| `assess_anonymous_authenticity` | trust-core (`anonymous`) | Assesses whether unattributed/scraped sentiment looks real or planted (astroturf detection). |
| `check_provenance_claims` | provenance-kit | Flags certainty-implying language ("(verified)", "guaranteed") not backed by an appropriate provenance tier. |
| `check_claims_registry` | claims-registry-kit | Buckets public-facing claims as current / stale / unverified against their linked evidence and last-verified date. |
| `append_audit_entry` | audit-chain-kit | Appends one entry to a hash-chained, tamper-evident audit log. |
| `verify_audit_chain` | audit-chain-kit | Independently re-verifies a hash chain from genesis; detects mutation, severed links, and (with `expectedMinLength`) tail truncation. |

**2 scaffolding tools** (kits 9–10 — these are runtime libraries a project
*installs and imports into its own running code*, not something checked
on-demand the same way; see the code comments in
`src/tools/agentReceiptScaffold.ts` / `costGovernorScaffold.ts` for why a
"check this content" shape would misrepresent them):

| Tool | Wraps | One-line purpose |
|---|---|---|
| `scaffold_agent_receipts` | agent-receipt-kit | Explains the issue-a-packet / verify-the-claim authorization pattern for AI agents, with an install step, a starter snippet, and (optionally) a live accepted/rejected worked example run against the real kit. |
| `scaffold_cost_governor` | cost-governor-kit | Explains the pre-call dollar ceiling + cache-aware pricing math + reserve-then-confirm usage-counting pattern, with an install step, a starter snippet, and (optionally) a live worked example. |

That's 8 kits, 10 content-checking tool slots (payout-invariance-kit and
audit-chain-kit each got 2 tools instead of 1, since each bundles two
genuinely distinct operations — runtime check vs. static grep; append vs.
verify — that read better as separate, single-purpose MCP tools than as
one tool with a mode switch) plus 2 scaffolding tools = **12 tools total**.

### A note on the two code-execution tools

`check_payout_invariance` (runtime mode) and `check_mutation_invariance`
both wrap kit functions whose real signature takes an actual JavaScript
**function** (a ranking function, a mutation closure) — there is no way to
represent a function as MCP JSON arguments. Both tools accept that function
as a **source-code string** and build the real function in-process via the
`Function` constructor (`src/lib/buildFunction.ts`) before calling the
unmodified kit export with it. This is equivalent to `eval` for that one
string. It is appropriate here because this is a local, stdio-only dev tool
a coding agent runs against its own project's code — the same trust model
as that agent running `node -e`, `vitest run`, or any other local
code-execution tool — and it is **not** designed to be exposed to
untrusted, remote, or adversarial input. Don't wire this server up to
accept tool arguments from anyone other than the trusted local agent
driving it.

## Development

```bash
npm run typecheck   # tsc --noEmit over src/ + test/
npm test             # vitest — spins up a real MCP Client/Server pair
                      # over the SDK's InMemoryTransport and calls tools
                      # end-to-end (see test/server.test.ts)
npm run smoke        # npm run build first, then node dist/smoke.js --
                      # a standalone script that does the same real
                      # client/server handshake, lists all tools, and
                      # calls one end-to-end
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
    agentReceiptScaffold.ts
    costGovernorScaffold.ts
test/
  server.test.ts               end-to-end tests over a real in-memory MCP client/server pair
```
