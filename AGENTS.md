# honesty-mcp — agent instructions

MCP server exposing the eleven-kit 'honesty SDK' family (grounding-kit, corroboration-kit, payout-invariance-kit, mutation-invariance-kit, trust-core, provenance-kit, claims-registry-kit, audit-chain-kit, advice-ledger-kit, agent-receipt-kit, cost-governor-kit) as tools any MCP-compatible coding agent can call while building or auditing a product.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Its build does not clean `dist/`; remove `dist/` before a final `npm run verify` so stale output cannot pass.
- Never weaken lint or tests to get green; call out any public API change.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

Use [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for milestone review cadence and launch-preparation evidence.


## Code Review Rules

- Keep stdout exclusively for JSON-RPC. Route diagnostics, including caller-code logs, to stderr so normal logging cannot corrupt the MCP transport.
- Validate MCP inputs, call the actual kit exports and return execution failures through `errorResult` with `isError: true`. A successfully executed content check with a failing verdict remains a normal result; instructional scaffold tools may return accurate API examples.
- Describe worker timeouts as time limits, not security sandboxes. Caller JavaScript retains the documented filesystem, network and environment privileges; do not add hidden execution paths or claim isolation that the implementation does not provide.
