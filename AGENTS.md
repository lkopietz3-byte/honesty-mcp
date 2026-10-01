# honesty-mcp — agent instructions

MCP server exposing the eleven-kit 'honesty SDK' family (grounding-kit, corroboration-kit, payout-invariance-kit, mutation-invariance-kit, trust-core, provenance-kit, claims-registry-kit, audit-chain-kit, advice-ledger-kit, agent-receipt-kit, cost-governor-kit) as tools any MCP-compatible coding agent can call while building or auditing a product.

## Read first
- `SESSION_HANDOFF.md`, when present, records applied local work, evidence, and pending gates for resumption; read it and recheck the current checkout before acting.
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
- For handoffs, update `SESSION_HANDOFF.md` with revision, evidence and pending work; see `docs/SHARED_CONTEXT.md` for the portable context export.
