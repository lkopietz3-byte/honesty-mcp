# Shared context for Claude Code, Codex and ChatGPT

Use the repository records as common project context. Native memories and chat histories remain separate. A shared note is evidence to reconcile, not new permission or proof that another agent is active.

## Where information belongs

| Record | Purpose |
| --- | --- |
| `AGENTS.md`, imported by `CLAUDE.md` | Short shared instructions and pointers. Keep the existing single rule source. |
| `ENGINEERING.md` | Stable invariants and verification commands. Current package.json/scripts govern the commands actually executed. |
| `PROJECT_CONTEXT.md` | Durable project identity and decisions, with dates and source references. Recheck stale observations. |
| Optional, uncommitted `SESSION_HANDOFF.md` | Current unfinished work: checkout/revision, modified files, results, limitations and one next step. A clean clone needs no handoff; `.gitignore` excludes it from ordinary staging. |
| Existing task receipts and focused regressions | Exact evidence. Preserve them; a summary does not replace tests or revision identity. |

At a meaningful handoff, reconcile HEAD/status and update the existing session note with changed files, checks actually run, pending gates and the next action. Record durable decisions only when they matter; point to current source or a focused regression instead of copying codebase facts into several memory files. Preserve unrelated work and coordinate one writer per overlapping file. Avoid appending every interaction or rebuilding large instruction files.

## Transfer selected context to a chat

From this checkout, using existing Node.js and Git:

```bash
node scripts/export-context.mjs > /tmp/honesty-mcp-context.md
node scripts/export-context.mjs --json > /tmp/honesty-mcp-context.json
```

The script prints a dated snapshot of four required repository docs and the optional local `SESSION_HANDOFF.md` with their SHA-256 hashes, HEAD/branch/selected-document status and a hash of the repository-wide tracked diff. It reads from its own repository root even when launched from another directory. It refuses symlinked sources, oversized docs and observed changes during export. It does not install, write back to the checkout, upload, call a model, read native memory/transcripts or change settings. The output is selected documentation, not a complete checkout backup or a guarantee that the checkout cannot change after export.

Review the exported content before attaching the Markdown to an authorized ChatGPT or Claude project/chat. Allowlisting is not secret detection: private text placed in these selected docs will also appear in the export. Uploading creates a snapshot; refresh it after relevant changes. ChatGPT project files can provide common context within that project, but uploading here does not configure project memory or synchronize Claude/Codex histories. Ask the receiving chat to use the packet's revision and dated evidence, and reconcile any proposal against the live checkout before applying it.

Local Claude/Codex tasks can read the original records directly. The existing bridge can pass a bounded question, exact paths/revision and acceptance criteria when communication is authorized. Keep live bridge readiness separate from memory configuration. Do not copy credentials or entire private histories into a shared packet, relocate/symlink native memory stores, add persistent external access, or change account settings as part of a routine handoff.

## Research behind this approach

Official [Codex instructions](https://developers.openai.com/codex/guides/agents-md) and [Claude memory docs](https://code.claude.com/docs/en/memory) support shared instruction files. [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) provide files/instructions inside a project. These are distinct context mechanisms.

The [AGENTS.md evaluation](https://arxiv.org/abs/2602.11988) cautions against unnecessary repository instructions; [ACE](https://arxiv.org/abs/2510.04618) motivates preserving useful, curated lessons without repeatedly erasing detail. These studies used different tasks/models and do not establish a performance improvement for this repository. The design choice here is a small common record with detailed evidence available on demand. No cross-model productivity gain has been measured.
