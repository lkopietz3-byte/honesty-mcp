# Review and launch readiness

Prepared September 30, 2026 against GitHub main `7dca762a3b3ca993ed96752f9a71f78e44163d7f`. This document records a preparation plan, not a production or marketing certification.

## Review cadence

Keep automatic code reviews off during preparation. Request one focused `@codex review` on a meaningful candidate PR after relevant checks; repeat only when material changes invalidate the previous review. Do not add a recurring review schedule.

When this repo enters sustained launch/customer-facing development, enable its repository setting individually with **All PRs / On PR open / Exhaustive Off**. Keep the personal automatic default and credit-funded reviews off. Inspect the first result before expanding cadence. Review guidance lives in the root [AGENTS.md](../AGENTS.md); automated review supplements existing tests and release requirements.

The September 29 settings observation is historical, not a current settings receipt. These preferences are managed in ChatGPT; this PR changes no settings.

## Verified release state

npm and the MCP registry list honesty-mcp 0.2.0; npm's `gitHead` matches the main
revision above. GitHub PR #10 merged the wrapper corrections and kit upgrade.
The dependency ranges are claims-registry-kit ^0.3.0 and ^0.2.0 for the other ten
wrapped kits. freshness-kit is published separately and is not a server dependency.
The installed-consumer gate has run successfully; it is not pending release work.

## Ongoing review checks

For future wrapper or dependency changes, compare tool wording and raw outputs
with the actual installed kit exports. Retain real MCP smoke/stdio and packed
installed-consumer checks, including stdout JSON-RPC purity. Check registry
availability rather than inferring publication from local sibling versions.
Structural grounding is not semantic truth; trust patterns are not proof of
source independence; worker timeouts are not isolation from filesystem/network access.

## Declared verification commands

Read from the inspected main's `package.json`. The updated documentation branch passes `npm run verify`, including its installed-consumer gate. Exact candidate and hosted results are recorded in the PR body; report any unavailable check rather than treating it as passed. Use focused checks during implementation and existing release gates on the frozen candidate.

- `npm run verify`: `npm run lint && npm run typecheck && npm test && npm run build && npm run smoke && npm run stdio-probe && npm run verify:installed`
- `npm run lint`: `eslint . --max-warnings=0`
- `npm run typecheck`: `tsc --noEmit`
- `npm run test`: `vitest run`
- `npm run build`: `tsc -p tsconfig.build.json && chmod +x dist/index.js`
- `npm run smoke`: `npm run build && node dist/smoke.js`
- `npm run stdio-probe`: `node scripts/stdio-probe.mjs`
- `npm run verify:installed`: `node scripts/verify-installed.mjs`

Local tests, hosted authorization, published package resolution, deployed behavior and demand are separate evidence. Dated receipts apply to their recorded revision.

## Source basis

- [ENGINEERING.md](../ENGINEERING.md)
- [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md)
- [package.json](../package.json)
- [scripts/stdio-probe.mjs](../scripts/stdio-probe.mjs)

Public marketing claims must be supported by current candidate evidence. Private-data transfers, commercial commitments, database promotion and deployment retain their existing authorization boundaries.
