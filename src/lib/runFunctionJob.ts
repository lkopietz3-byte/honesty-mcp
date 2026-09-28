// Runs one of the three "caller-supplied JS source" jobs (check_payout_invariance's
// runtime mode, check_mutation_invariance, and compute_divergence's optional
// config.groupBySource) inside a worker_threads Worker, so a hostile or
// merely buggy `while (true) {}` string can no longer block this whole
// stdio server forever. Before this module existed, buildFunctionFromSource
// built the caller's function and the tool handler called it SYNCHRONOUSLY
// on the main thread -- there was no timeout at all.
//
// NOT A SANDBOX. The worker has the same OS-level privileges as this process
// (filesystem, network, environment) -- terminate() after a timeout only
// bounds *time*, nothing else. See README.md's trust-model note: don't wire
// this server up to run code from anyone other than the trusted local agent
// driving it.
//
// The worker is spawned from an inline source string (`eval: true`) rather
// than a separate compiled file. That makes it work identically whether
// honesty-mcp is running from dist/ (compiled JS) or directly from src/
// under vitest (TypeScript, no dist/ build): a path built from
// import.meta.url would point at a real dist/lib/*.js file in the compiled
// case but at a non-existent src/lib/*.js file under vitest (the real file
// there is *.ts, and a plain Node worker has no TypeScript loader).
//
// An eval worker resolves bare specifiers against the process's current
// working directory, not against this package. MCP clients launch the
// server from wherever they happen to be (`npx honesty-mcp`, `claude mcp
// add`), so a bare `import("payout-invariance-kit")` inside the worker
// failed with "Cannot find package" whenever the cwd was not a project that
// itself had the kits installed. The kit module URL is therefore resolved
// HERE, relative to this module, and passed to the worker as an absolute
// file URL (see resolveKitUrl).
//
// Worker stdout/stderr are captured (Worker `stdout: true, stderr: true`),
// never forwarded to this process's stdout: stdout carries the MCP JSON-RPC
// protocol, and a caller's console.log would corrupt it. Captured output is
// written to this process's stderr with a prefix, capped per job.
//
// The function-from-source-string builder (see buildFunction.ts for the
// canonical, independently-tested version) is duplicated inline in
// WORKER_SOURCE below for the same reason. Keep the two in sync -- they're
// both tiny and both covered by tests (buildFunction.test.ts tests the
// canonical copy directly; runFunctionJob.test.ts exercises this copy
// end-to-end through the worker).

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const requireFromHere = createRequire(import.meta.url);

/** The wrapped kit each job kind imports inside the worker. */
const KIT_FOR_JOB = {
  "payout-invariance": "payout-invariance-kit",
  "mutation-invariance": "mutation-invariance-kit",
  "divergence-group-by": "advice-ledger-kit",
} as const;

/**
 * Resolves a wrapped kit's entry point relative to THIS module (and so to
 * honesty-mcp's own dependencies), returning an absolute file URL the worker
 * can `import()` regardless of the process's working directory.
 */
function resolveKitUrl(specifier: string): string {
  const meta = import.meta as { resolve?: (specifier: string) => string };
  if (typeof meta.resolve === "function") {
    try {
      const resolved = meta.resolve(specifier);
      if (resolved.startsWith("file:")) return resolved;
    } catch {
      // Fall through to the CommonJS resolver below.
    }
  }
  return pathToFileURL(requireFromHere.resolve(specifier)).href;
}

/** Largest delay Node's timers honor; larger values fire after 1 ms. */
export const MAX_WORKER_TIMEOUT_MS = 2_147_483_647;

/** Cap on captured worker output copied to stderr, per job. */
const MAX_FORWARDED_OUTPUT_BYTES = 16 * 1024;

/** One caller-supplied-source job this module knows how to run in a worker. */
export type FunctionJob =
  | {
      kind: "payout-invariance";
      rankFnSource: string;
      baseInput: unknown;
      mutations: { name: string; mutateSource: string }[];
    }
  | {
      kind: "mutation-invariance";
      fnSource: string;
      baseInput: unknown;
      scenarios: { name: string; mutateSource: string; category?: string }[];
    }
  | {
      kind: "divergence-group-by";
      pairs: unknown[];
      floors: Record<string, unknown>;
      groupBySource: string;
    };

/** Default worker timeout, in milliseconds. */
export const DEFAULT_WORKER_TIMEOUT_MS = 10_000;

/** Env var that overrides {@link DEFAULT_WORKER_TIMEOUT_MS}. */
export const WORKER_TIMEOUT_ENV_VAR = "HONESTY_MCP_WORKER_TIMEOUT_MS";

/**
 * Reads {@link WORKER_TIMEOUT_ENV_VAR} and returns the timeout to use, in
 * milliseconds. Unset or blank falls back to {@link DEFAULT_WORKER_TIMEOUT_MS}.
 * Throws a plain Error (not a timeout) if the env var is set to something
 * outside 1 to {@link MAX_WORKER_TIMEOUT_MS} milliseconds. Node silently
 * turns larger timer delays into 1 ms, so they are rejected rather than
 * accepted and then ignored.
 */
export function resolveWorkerTimeoutMs(): number {
  const raw = process.env[WORKER_TIMEOUT_ENV_VAR];
  if (raw === undefined || raw.trim() === "") return DEFAULT_WORKER_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_WORKER_TIMEOUT_MS) {
    throw new Error(
      `${WORKER_TIMEOUT_ENV_VAR} must be a number of milliseconds from 1 to ${MAX_WORKER_TIMEOUT_MS}, ` +
        `got ${JSON.stringify(raw)}.`,
    );
  }
  return parsed;
}

// Duplicate of buildFunction.ts's buildFunctionFromSource, as a plain-JS
// string literal (see module comment above for why this can't just import
// the real one by path). `label` is inlined as a JS expression by the
// caller building WORKER_SOURCE, so this template only ever appears once,
// fully formed, inside WORKER_SOURCE below.
const BUILD_FUNCTION_FROM_SOURCE_JS = `
function buildFunctionFromSource(source, label) {
  let built;
  try {
    built = new Function('"use strict"; return (\\n' + source + '\\n);')();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      'Could not evaluate ' + label + ' as JavaScript: ' + message + '. Expected source for a single ' +
        'function expression, e.g. "(input) => output" or "function (input) { return output; }".'
    );
  }
  if (typeof built !== 'function') {
    throw new Error(
      label + ' evaluated to a ' + (typeof built) + ', not a function. Expected source for a single ' +
        'function expression, e.g. "(input) => output".'
    );
  }
  return built;
}
`;

const WORKER_SOURCE = `
import { parentPort, workerData } from "node:worker_threads";
${BUILD_FUNCTION_FROM_SOURCE_JS}

async function run(job, kitUrl) {
  switch (job.kind) {
    case "payout-invariance": {
      const { assertPayoutInvariance } = await import(kitUrl);
      const rankFn = buildFunctionFromSource(job.rankFnSource, "rankFnSource");
      const scenarios = job.mutations.map((m) => ({
        name: m.name,
        mutate: buildFunctionFromSource(m.mutateSource, 'mutation "' + m.name + '"'),
      }));
      return assertPayoutInvariance(rankFn, job.baseInput, scenarios);
    }
    case "mutation-invariance": {
      const { assertInvariance } = await import(kitUrl);
      const fn = buildFunctionFromSource(job.fnSource, "fnSource");
      const scenarios = job.scenarios.map((s) => ({
        name: s.name,
        category: s.category,
        mutate: buildFunctionFromSource(s.mutateSource, 'scenario "' + s.name + '"'),
      }));
      return assertInvariance(fn, job.baseInput, scenarios);
    }
    case "divergence-group-by": {
      const { computeDivergence } = await import(kitUrl);
      const groupBy = buildFunctionFromSource(job.groupBySource, "config.groupBySource");
      return computeDivergence(job.pairs, Object.assign({}, job.floors, { groupBy }));
    }
    default:
      throw new Error("runFunctionJob: unknown job kind " + JSON.stringify(job && job.kind));
  }
}

run(workerData.job, workerData.kitUrl).then(
  (result) => { parentPort.postMessage({ ok: true, result }); },
  (err) => { parentPort.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) }); },
);
`;

type WorkerMessage<T> = { ok: true; result: T } | { ok: false; message: string };

/**
 * Runs `job` inside a fresh worker_threads Worker and resolves with its
 * result. If the worker hasn't posted a result within `timeoutMs`
 * (default: {@link resolveWorkerTimeoutMs}, i.e. 10s unless overridden by
 * `HONESTY_MCP_WORKER_TIMEOUT_MS`), the worker is `terminate()`d and the
 * returned promise rejects with a clear timeout error -- this is what stops
 * a `while (true) {}` string from hanging the whole server.
 *
 * This is NOT a sandbox: the worker runs with this process's full OS-level
 * privileges (filesystem, network, environment variables). It only bounds
 * wall-clock time. See README.md's trust-model note.
 */
export function runFunctionJob<T>(job: FunctionJob, timeoutMs: number = resolveWorkerTimeoutMs()): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WORKER_TIMEOUT_MS) {
      reject(new RangeError(`runFunctionJob: timeoutMs must be from 1 to ${MAX_WORKER_TIMEOUT_MS}.`));
      return;
    }
    let kitUrl: string;
    try {
      kitUrl = resolveKitUrl(KIT_FOR_JOB[job.kind]);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { job, kitUrl },
      stdout: true,
      stderr: true,
    });
    // Never let caller output reach this process's stdout (the MCP channel).
    let forwarded = 0;
    const forwardToStderr = (chunk: Buffer | string): void => {
      if (forwarded >= MAX_FORWARDED_OUTPUT_BYTES) return;
      const text = chunk.toString();
      const room = MAX_FORWARDED_OUTPUT_BYTES - forwarded;
      const slice = text.length > room ? `${text.slice(0, room)}\n[honesty-mcp worker] output truncated\n` : text;
      forwarded += text.length;
      process.stderr.write(`[honesty-mcp worker] ${slice}`);
    };
    worker.stdout.on("data", forwardToStderr);
    worker.stderr.on("data", forwardToStderr);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for caller-supplied code to finish. This is not a sandbox ` +
            "-- it only bounds runaway time -- so a timeout most likely means the supplied source contains an " +
            `infinite loop or a long blocking call. Override the timeout with the ${WORKER_TIMEOUT_ENV_VAR} ` +
            "environment variable (milliseconds).",
        ),
      );
    }, timeoutMs);
    timer.unref();

    worker.once("message", (msg: WorkerMessage<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.message));
    });

    worker.once("error", (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    worker.once("exit", (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Worker exited with code ${code} before returning a result.`));
    });
  });
}
