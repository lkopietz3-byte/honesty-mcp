// check_payout_invariance — wraps payout-invariance-kit's two checks:
//   - assertPayoutInvariance (runtime): re-run a ranking function under
//     adversarial payout mutations and confirm the output doesn't change.
//   - assertNoPayoutImports (static-imports): grep source files for any
//     reference to payout-related identifiers.
//
// The runtime check's real signature takes actual JS functions (rankFn,
// mutate). MCP arguments are JSON, so `mode: "runtime"` accepts function
// BODIES AS SOURCE STRINGS and builds and calls them inside a worker_threads
// Worker (see lib/runFunctionJob.ts) before returning the real, unmodified
// assertPayoutInvariance result -- see the security note in README.md.
// `mode: "static-imports"` needs no code execution at all: it's a plain
// grep over file contents, fully JSON-serializable both ways, so it runs
// directly on the main thread. It only accepts a map of path -> file content
// that the caller sends; this server never reads a caller-named path from
// disk (the kit would read any readable file and return matching lines, so
// the tool boundary refuses a path list).
//
// Code execution is off unless HONESTY_MCP_ENABLE_CODE_EXEC=1 (lib/codeExec.ts).
// While it is off, this tool is registered with `static-imports` mode only,
// so the runtime inputs are not even listed.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertNoPayoutImports,
  type AssertNoPayoutImportsOptions,
  type PayoutInvarianceResult,
} from "payout-invariance-kit";
import { CODE_EXEC_ENV_VAR, isCodeExecEnabled } from "../lib/codeExec.js";
import { runFunctionJob } from "../lib/runFunctionJob.js";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";
import { installedKitVersion, kitAtLeast } from "../lib/kitVersion.js";

/** payout-invariance-kit 0.3.0 added `matchIdentifierParts` to the static scan. */
const IDENTIFIER_PARTS_MIN_VERSION = "0.3.0";

/**
 * How the static scan matches identifiers, worded for the installed kit. The
 * whole-word rule is the kit's default in every version; the option that
 * relaxes it exists only in the newer line.
 */
function matchingNote(partsSupported: boolean): string {
  return (
    "Matching is whole-word and case-insensitive: the identifier `commission` is NOT matched inside " +
    "`commissionRate`, `commission_rate`, `affiliateUrl` or `payoutPerClick`, so those names pass as CLEAN. " +
    (partsSupported
      ? "Pass `matchIdentifierParts: true` to also find an identifier as one part of a longer camelCase, snake_case, " +
        "SCREAMING_CASE or kebab-case name (it still does not match plurals such as `affiliates`, or a word fused into " +
        "another with no separator, such as `mypayout`). "
      : "To catch suffixed names, list each full name you care about (for example `commissionRate`); this version of " +
        "payout-invariance-kit has no part-matching option. ")
  );
}

const mutationSchema = z.object({
  name: z.string().min(1).describe("Short, descriptive name for this mutation, shown in failure output."),
  mutateSource: z
    .string()
    .min(1)
    .describe(
      "JS source for a pure function `(baseInput) => mutatedInput` that rewrites the payout/commission " +
        "field(s) on a copy of baseInput. Adversarial cases matter more than easy ones -- e.g. 'every " +
        "candidate gets an equal payout', 'the worst candidate gets the single highest payout'.",
    ),
});

function staticImportsDescription(partsSupported: boolean): string {
  return (
    "`static-imports` mode greps source files you supply for any reference to payout-related identifiers, to " +
    "assert the ranking engine's code never even has payout data in scope. You send the file contents as a map " +
    "of path -> content; this server does not read paths from disk, and a list of paths is rejected. " +
    matchingNote(partsSupported) +
    "It is a best-effort text/regex grep, not a real parser (it won't catch a dynamically-built import specifier " +
    "or a re-export under an aliased name). A CLEAN result means no match in the text you sent, not that the " +
    "engine is payout-neutral in general; re-run this in CI whenever the ranking logic changes."
  );
}

function runtimeDescription(partsSupported: boolean): string {
  return (
    "Checks -- for the specific scenarios you supply, not a formal proof for every possible payout " +
    "configuration -- whether a ranking/recommendation/comparison engine's output ordering changes " +
    "depending on which option pays the operator more (affiliate commission, sponsored placement, " +
    "referral fee). Two modes: `runtime` re-runs your actual ranking function under adversarial " +
    "payout-mutation scenarios you name and confirms the result is byte-identical to the unmutated " +
    "baseline (pass JS source for the ranking function and each mutation -- this runs in a worker thread " +
    "with a bounded timeout, not a sandbox, so only pass code you wrote or trust; a scenario whose " +
    "mutation didn't actually change the input is flagged 'vacuous' rather than silently counting as a " +
    "pass). The ranking function must be deterministic: one that uses random numbers or the clock can look " +
    "payout-dependent (or pass by luck). `static-imports` instead greps a set of source files for any " +
    "reference to payout-related identifiers, to assert the ranking engine's code never even has payout data " +
    "in scope -- no code execution needed for this mode, and you send the file contents as a map of " +
    "path -> content (this server does not read paths from disk, and a list of paths is rejected). " +
    matchingNote(partsSupported) +
    "It is a best-effort text/regex grep, not a real parser (it won't catch a dynamically-built import " +
    "specifier or a re-export under an aliased name). Use `runtime` when you can call the ranking function " +
    "directly; use `static-imports` as a cheaper, complementary check on the engine's source. A passing " +
    "result means no difference in the scenarios tested, not that the function is payout-neutral in general " +
    "-- write adversarial and boundary scenarios, not one easy case, and re-run this in CI whenever the " +
    "ranking logic changes."
  );
}

function disabledDescription(partsSupported: boolean): string {
  return (
    "Checks whether payout-related identifiers (commission, payout, affiliate rate) appear in the source of a " +
    "ranking/recommendation engine. Only `static-imports` mode is available: running your ranking function " +
    "under payout-mutation scenarios (`runtime` mode) is turned off because it runs caller-supplied " +
    `JavaScript. The server operator can turn it on by setting ${CODE_EXEC_ENV_VAR}=1; that runs the code ` +
    "with the server's full filesystem, network and environment access, and the worker thread only bounds " +
    "time. " +
    staticImportsDescription(partsSupported)
  );
}

const staticImportsShape = {
  files: z
    .union([
      z
        .array(z.string())
        .describe("Rejected with an error: this server does not read file paths from disk. Send a map instead."),
      z.record(z.string(), z.string()).describe("Map of path -> file content. No filesystem access."),
    ])
    .optional()
    .describe(
      "[static-imports mode, required, at least one file] Source files to scan for payout references, as a " +
        "map of path -> content. A list of paths is an error. An empty map is a tool error, never a CLEAN " +
        "result over zero files.",
    ),
  payoutIdentifiers: z
    .array(z.string())
    .optional()
    .describe(
      '[static-imports mode, required, non-empty] Identifiers that must never appear in the ranking ' +
        "engine's source, e.g. \"commission\", \"payout\", \"affiliateRate\". Each is matched as a whole word " +
        "(`commission` does not match `commissionRate`; see `matchIdentifierParts`). An identifier that is " +
        "blank (only whitespace or invisible characters) is a tool error.",
    ),
  stripComments: z
    .boolean()
    .optional()
    .describe("[static-imports mode] Strip comments before matching, so a mention in a comment doesn't count. Default true."),
  caseInsensitiveMatch: z
    .boolean()
    .optional()
    .describe("[static-imports mode] Case-insensitive identifier matching. Default true."),
  matchIdentifierParts: z
    .boolean()
    .optional()
    .describe(
      "[static-imports mode, payout-invariance-kit 0.3+] Default false (whole-word matching, so `commission` does " +
        "not match `commissionRate`). When true, an identifier is also found as one part of a longer " +
        "camelCase, snake_case, SCREAMING_CASE or kebab-case name (`affiliate` finds `affiliateUrl` and " +
        "`AFFILIATE_URL`), but not plurals or words fused with no separator.",
    ),
};

const runtimeShape = {
  rankFnSource: z
    .string()
    .optional()
    .describe(
      "[runtime mode, required] JS source for a pure ranking function `(input) => result`, e.g. " +
        '"(candidates) => candidates.slice().sort((a, b) => b.score - a.score)". Must be deterministic: ' +
        "random numbers or the clock make it look payout-dependent. Built and run in a " +
        "worker thread with a bounded timeout (default 10s, see README).",
    ),
  baseInput: z
    .any()
    .optional()
    .describe(
      "[runtime mode, required] The baseline input to rankFn -- e.g. an array of candidate objects " +
        "each carrying a payout/commission field.",
    ),
  mutations: z
    .array(mutationSchema)
    .optional()
    .describe("[runtime mode, required, non-empty] Named adversarial payout-mutation scenarios."),
};

type PayoutArgs = {
  mode: "runtime" | "static-imports";
  rankFnSource?: string;
  baseInput?: unknown;
  mutations?: { name: string; mutateSource: string }[];
  files?: string[] | Record<string, string>;
  payoutIdentifiers?: string[];
  stripComments?: boolean;
  caseInsensitiveMatch?: boolean;
  matchIdentifierParts?: boolean;
};

/**
 * Registers `check_payout_invariance` on `server`. While code execution is
 * off (the default), the tool lists `static-imports` mode only.
 */
export function registerPayoutInvarianceTool(server: McpServer): void {
  const codeExec = isCodeExecEnabled();
  const partsSupported = kitAtLeast("payout-invariance-kit", IDENTIFIER_PARTS_MIN_VERSION);
  const handler = async (args: PayoutArgs) => {
    try {
      if (args.mode === "runtime") {
        return await runRuntimeMode(args);
      }
      return runStaticImportsMode(args);
    } catch (err) {
      return errorResult(errorMessage(err));
    }
  };
  if (codeExec) {
    server.registerTool(
      "check_payout_invariance",
      {
        title: "Check whether a ranking engine ignores payout",
        description: runtimeDescription(partsSupported),
        // Runs caller-supplied code with this process's privileges: not read-only, and open-world.
        annotations: { readOnlyHint: false, openWorldHint: true },
        inputSchema: {
          mode: z.enum(["runtime", "static-imports"]).describe("Which check to run."),
          ...runtimeShape,
          ...staticImportsShape,
        },
      },
      handler,
    );
    return;
  }
  server.registerTool(
    "check_payout_invariance",
    {
      title: "Check whether a ranking engine ignores payout (static-imports only)",
      description: disabledDescription(partsSupported),
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        mode: z.enum(["static-imports"]).describe("Which check to run. Only `static-imports` is available."),
        ...staticImportsShape,
      },
    },
    handler,
  );
}

async function runRuntimeMode(args: {
  rankFnSource?: string;
  baseInput?: unknown;
  mutations?: { name: string; mutateSource: string }[];
}) {
  if (!args.rankFnSource) {
    throw new Error("mode 'runtime' requires `rankFnSource`.");
  }
  if (!args.mutations || args.mutations.length === 0) {
    throw new Error("mode 'runtime' requires a non-empty `mutations` array.");
  }

  const result = await runFunctionJob<PayoutInvarianceResult<unknown, unknown>>({
    kind: "payout-invariance",
    rankFnSource: args.rankFnSource,
    baseInput: args.baseInput,
    mutations: args.mutations,
  });
  const scenarioCount = args.mutations.length;
  const summary = result.passed
    ? `PASSED: ranking is invariant across all ${scenarioCount} payout-mutation scenario(s).`
    : `FAILED: ${result.failures.length}/${scenarioCount} scenario(s) changed the ranking` +
      (result.vacuous.length > 0
        ? `; ${result.vacuous.length} scenario(s) were vacuous (the mutation didn't actually change the input).`
        : ".");
  return jsonResult(summary, result);
}

function runStaticImportsMode(args: {
  files?: string[] | Record<string, string>;
  payoutIdentifiers?: string[];
  stripComments?: boolean;
  caseInsensitiveMatch?: boolean;
  matchIdentifierParts?: boolean;
}) {
  if (!args.files) {
    throw new Error("mode 'static-imports' requires `files`.");
  }
  if (Array.isArray(args.files)) {
    // The kit would read every listed path from disk and return matching
    // lines, which turns this tool into a file reader. Refuse it here.
    throw new Error(
      "mode 'static-imports' does not read files from disk. Send `files` as a map of path -> file content " +
        "instead of a list of paths.",
    );
  }
  if (!args.payoutIdentifiers || args.payoutIdentifiers.length === 0) {
    throw new Error("mode 'static-imports' requires a non-empty `payoutIdentifiers` array.");
  }

  // Built conditionally -- assertNoPayoutImports merges options via object
  // spread over its defaults, so an explicit `undefined` key would clobber
  // the (true) default rather than falling back to it.
  const options: AssertNoPayoutImportsOptions & { matchIdentifierParts?: boolean } = {};
  if (args.stripComments !== undefined) options.stripComments = args.stripComments;
  if (args.caseInsensitiveMatch !== undefined) options.caseInsensitive = args.caseInsensitiveMatch;
  if (args.matchIdentifierParts === true) {
    // An older kit would ignore this option and match whole words only, which would look like a
    // clean pass over suffixed names. Refuse instead of silently dropping it.
    if (!kitAtLeast("payout-invariance-kit", IDENTIFIER_PARTS_MIN_VERSION)) {
      throw new Error(
        `\`matchIdentifierParts\` needs payout-invariance-kit ${IDENTIFIER_PARTS_MIN_VERSION} or later; the installed ` +
          `version is ${installedKitVersion("payout-invariance-kit") ?? "unknown"}. List the full identifiers ` +
          "(for example `commissionRate`) instead, or upgrade the kit.",
      );
    }
    options.matchIdentifierParts = true;
  }

  const offenses = assertNoPayoutImports(args.files, args.payoutIdentifiers, options);
  const fileCount = Object.keys(args.files).length;
  const summary =
    offenses.length === 0
      ? `CLEAN: no payout-related identifiers found across ${fileCount} file(s).`
      : `FOUND payout-related identifiers in ${offenses.length}/${fileCount} file(s).`;
  return jsonResult(summary, offenses);
}
