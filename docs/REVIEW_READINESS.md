# Review and launch readiness

Prepared September 30, 2026 against GitHub main `83208b1abddf7dcac9538c46addb5819cc09008c`. This document records a preparation plan, not a production or marketing certification.

## Review cadence

Keep automatic code reviews off during preparation. Request one focused `@codex review` on a meaningful candidate PR after relevant checks; repeat only when material changes invalidate the previous review. Do not add a recurring review schedule.

When this repo enters sustained launch/customer-facing development, enable its repository setting individually with **All PRs / On PR open / Exhaustive Off**. Keep the personal automatic default and credit-funded reviews off. Inspect the first result before expanding cadence. Review guidance lives in the root [AGENTS.md](../AGENTS.md); automated review supplements existing tests and release requirements.

The six repo settings were verified off on September 29, 2026. These preferences are managed in ChatGPT, not activated by committing this file.

## Next preparation task: Verify the installed consumer and kit version compatibility

On the selected release candidate, verify actual published sibling versions, dependency resolution and real MCP transport/tool behavior. Do not bump ranges from sibling local version numbers alone.

Finish condition: Record registry evidence and clean installed-consumer results, stdout JSON-RPC purity and the actual wrapped exports.

## Declared verification commands

Read from the inspected main's `package.json`. This documentation change has not executed these product checks; report any required check that is unavailable rather than treating it as passed. Use focused checks during implementation and existing release gates on the frozen candidate.

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
