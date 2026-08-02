// A handful of the wrapped kits (payout-invariance-kit, mutation-invariance-kit)
// take a real JavaScript FUNCTION as part of their API -- a ranking function,
// a mutation closure. MCP tool arguments are JSON, and JSON cannot carry a
// function value, so the only faithful way to expose these kits' real
// signatures as an MCP tool is to accept the function as a source-code
// string and build the actual function in-process before calling the real
// kit export with it.
//
// SECURITY NOTE: this evaluates caller-supplied source via the Function
// constructor (equivalent to eval, sandboxed only in the sense that it
// doesn't share the calling scope's local variables). This server is a
// local, stdio-only dev tool that a coding agent runs against ITS OWN
// project's code, analogous to how that same agent would run `node -e`,
// `vitest run`, or any other local code-execution tool. It is not designed
// to be exposed to untrusted, remote, or adversarial input -- see README.md.

export function buildFunctionFromSource(
  source: string,
  label: string,
): (...args: unknown[]) => unknown {
  let built: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    built = new Function(`"use strict"; return (\n${source}\n);`)();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not evaluate ${label} as JavaScript: ${message}. Expected source for a single ` +
        `function expression, e.g. "(input) => output" or "function (input) { return output; }".`,
    );
  }
  if (typeof built !== "function") {
    throw new Error(
      `${label} evaluated to a ${typeof built}, not a function. Expected source for a single ` +
        `function expression, e.g. "(input) => output".`,
    );
  }
  return built as (...args: unknown[]) => unknown;
}
