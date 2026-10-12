// The one switch for the tools that run caller-supplied JavaScript.
//
// Three paths run source text a caller sends as a tool argument:
// `check_payout_invariance` (runtime mode), `check_mutation_invariance`, and
// `compute_divergence` with `config.groupBySource`. They are OFF unless the
// operator turns them on.
//
// The switch works at two layers, and both read isCodeExecEnabled():
//   1. Registration (src/server.ts and the three tool files): when the switch
//      is off, `check_mutation_invariance` is not registered at all, and the
//      other two tools are registered without their code-execution inputs.
//      A tool or input that is not listed cannot be called by an agent that
//      was talked into it.
//   2. runFunctionJob (src/lib/runFunctionJob.ts) calls assertCodeExecEnabled()
//      before it spawns a worker. This is the single choke point where caller
//      JavaScript is ever executed, so it stays closed even if a caller
//      reaches it some other way.
//
// Turning the switch on does NOT isolate anything. The code still runs in a
// worker thread with this process's filesystem, network and environment
// access; the worker only bounds time. See README.md and SECURITY.md.

/** Name of the environment variable that turns code execution on. */
export const CODE_EXEC_ENV_VAR = "HONESTY_MCP_ENABLE_CODE_EXEC";

/** The only value of {@link CODE_EXEC_ENV_VAR} that turns code execution on. */
export const CODE_EXEC_ENABLING_VALUE = "1";

/**
 * What happens when {@link CODE_EXEC_ENV_VAR} is not set at all. This is the
 * one line to change to make code execution on by default. A variable that is
 * set to anything other than {@link CODE_EXEC_ENABLING_VALUE} is always off,
 * whatever this default says.
 */
export const CODE_EXEC_ENABLED_BY_DEFAULT = false;

/** True when the tools that run caller-supplied JavaScript may be used. */
export function isCodeExecEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CODE_EXEC_ENV_VAR];
  if (raw === undefined) return CODE_EXEC_ENABLED_BY_DEFAULT;
  return raw === CODE_EXEC_ENABLING_VALUE;
}

/** The message shown when a code-execution path is used while the switch is off. */
export const CODE_EXEC_DISABLED_MESSAGE =
  `Running caller-supplied JavaScript is disabled. Set the environment variable ${CODE_EXEC_ENV_VAR}=` +
  `${CODE_EXEC_ENABLING_VALUE} in the MCP server's environment to enable it. Enabling it runs the code ` +
  "with this process's filesystem, network and environment access; the worker thread only bounds time and is " +
  "not a sandbox. This affects check_payout_invariance runtime mode, check_mutation_invariance and " +
  "compute_divergence's config.groupBySource.";

/** Thrown by {@link assertCodeExecEnabled} when the switch is off. */
export class CodeExecDisabledError extends Error {
  constructor() {
    super(CODE_EXEC_DISABLED_MESSAGE);
    this.name = "CodeExecDisabledError";
  }
}

/** Throws {@link CodeExecDisabledError} unless code execution is enabled. */
export function assertCodeExecEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!isCodeExecEnabled(env)) throw new CodeExecDisabledError();
}
