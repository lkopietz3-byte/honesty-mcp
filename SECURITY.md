# Security policy

## Supported versions

This package gets security fixes on its latest minor version only. If a
vulnerability affects an older minor version, upgrade to the latest minor
first; there is no back-porting to earlier lines.

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than opening a
public issue. If [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
is enabled on this repository, use the "Report a vulnerability" button
under the repository's Security tab. If it is not enabled, open a regular
issue asking for a private contact channel and avoid including exploit
details until one is arranged.

Please include what you can: affected version, a minimal reproduction, and
the impact you expect.

## Security model

This is a local, stdio-only tool that a coding agent runs against its own
project. It is not built to be exposed to untrusted, remote or adversarial
input, and nothing here is isolation.

- **Code execution is off by default.** `check_payout_invariance` (runtime
  mode), `check_mutation_invariance` and `compute_divergence`'s
  `config.groupBySource` run JavaScript that the calling agent sends. They are
  only available when the operator sets `HONESTY_MCP_ENABLE_CODE_EXEC=1`
  (exactly `1`; any other value leaves them off). While off,
  `check_mutation_invariance` is not registered, the other two tools do not
  list the code-running inputs, and `runFunctionJob`
  (`src/lib/runFunctionJob.ts`) refuses to start a worker.
- **Turning it on is not a sandbox.** The code runs in a worker thread that
  only bounds time (`HONESTY_MCP_WORKER_TIMEOUT_MS`, default 10 seconds). It
  keeps this process's filesystem, network and environment access. Enable it
  only for a server driven by a trusted local agent.
- **No file reads on a caller's say-so.** `check_payout_invariance`'s
  `static-imports` mode accepts a map of path to file content that the caller
  sends. A list of paths is rejected, because the wrapped kit would otherwise
  read any readable file and return matching lines. Tested with a planted file
  outside any project folder in `test/fileRead.test.ts`.
- Tool annotations (`readOnlyHint`, `openWorldHint`) are hints for clients. They
  are not enforcement.

## Bug bounty

There is no bug bounty program for this project.
