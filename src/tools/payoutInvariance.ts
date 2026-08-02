// check_payout_invariance — wraps payout-invariance-kit's two checks:
//   - assertPayoutInvariance (runtime): re-run a ranking function under
//     adversarial payout mutations and confirm the output doesn't change.
//   - assertNoPayoutImports (static-imports): grep source files for any
//     reference to payout-related identifiers.
//
// The runtime check's real signature takes actual JS functions (rankFn,
// mutate). MCP arguments are JSON, so `mode: "runtime"` accepts function
// BODIES AS SOURCE STRINGS and builds them via buildFunctionFromSource
// before calling the real, unmodified assertPayoutInvariance export -- see
// lib/buildFunction.ts for why, and the security note in README.md.
// `mode: "static-imports"` needs no code execution at all: it's a plain
// grep over file contents, fully JSON-serializable both ways.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertNoPayoutImports,
  assertPayoutInvariance,
  type AssertNoPayoutImportsOptions,
  type PayoutMutationScenario,
} from "payout-invariance";
import { buildFunctionFromSource } from "../lib/buildFunction.js";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

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

export function registerPayoutInvarianceTool(server: McpServer): void {
  server.registerTool(
    "check_payout_invariance",
    {
      title: "Prove a ranking engine ignores payout",
      description:
        "Proves -- not just claims -- that a ranking/recommendation/comparison engine's output ordering " +
        "does not depend on which option pays the operator more (affiliate commission, sponsored placement, " +
        "referral fee). Two modes: `runtime` re-runs your actual ranking function under adversarial " +
        "payout-mutation scenarios and confirms the result is byte-identical to the unmutated baseline " +
        "(pass JS source for the ranking function and each mutation -- this executes in-process via the " +
        "Function constructor, so only pass code you wrote or trust). `static-imports` instead greps a set " +
        "of source files for any reference to payout-related identifiers, to assert the ranking engine's " +
        "code never even has payout data in scope -- no code execution needed for this mode. Use `runtime` " +
        "when you can call the ranking function directly; use `static-imports` as a cheaper, complementary " +
        "check on the engine's source.",
      inputSchema: {
        mode: z.enum(["runtime", "static-imports"]).describe("Which check to run."),

        // --- mode: "runtime" ---
        rankFnSource: z
          .string()
          .optional()
          .describe(
            "[runtime mode, required] JS source for a pure ranking function `(input) => result`, e.g. " +
              '"(candidates) => candidates.slice().sort((a, b) => b.score - a.score)". Executed in-process.',
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

        // --- mode: "static-imports" ---
        files: z
          .union([
            z.array(z.string()).describe("File paths to read from disk (this server reads them locally)."),
            z.record(z.string(), z.string()).describe("Map of path -> file content. No filesystem access."),
          ])
          .optional()
          .describe("[static-imports mode, required] Source files to scan for payout references."),
        payoutIdentifiers: z
          .array(z.string())
          .optional()
          .describe(
            '[static-imports mode, required, non-empty] Identifiers that must never appear in the ranking ' +
              "engine's source, e.g. \"commission\", \"payout\", \"affiliateRate\".",
          ),
        stripComments: z
          .boolean()
          .optional()
          .describe("[static-imports mode] Strip comments before matching, so a mention in a comment doesn't count. Default true."),
        caseInsensitiveMatch: z
          .boolean()
          .optional()
          .describe("[static-imports mode] Case-insensitive identifier matching. Default true."),
      },
    },
    async (args) => {
      try {
        if (args.mode === "runtime") {
          return runRuntimeMode(args);
        }
        return runStaticImportsMode(args);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}

function runRuntimeMode(args: {
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

  const rankFn = buildFunctionFromSource(args.rankFnSource, "rankFnSource") as (input: unknown) => unknown;
  const scenarios: PayoutMutationScenario<unknown>[] = args.mutations.map((m) => ({
    name: m.name,
    mutate: buildFunctionFromSource(m.mutateSource, `mutation "${m.name}"`) as (input: unknown) => unknown,
  }));

  const result = assertPayoutInvariance(rankFn, args.baseInput, scenarios);
  const summary = result.passed
    ? `PASSED: ranking is invariant across all ${scenarios.length} payout-mutation scenario(s).`
    : `FAILED: ${result.failures.length}/${scenarios.length} scenario(s) changed the ranking` +
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
}) {
  if (!args.files) {
    throw new Error("mode 'static-imports' requires `files`.");
  }
  if (!args.payoutIdentifiers || args.payoutIdentifiers.length === 0) {
    throw new Error("mode 'static-imports' requires a non-empty `payoutIdentifiers` array.");
  }

  // Built conditionally -- assertNoPayoutImports merges options via object
  // spread over its defaults, so an explicit `undefined` key would clobber
  // the (true) default rather than falling back to it.
  const options: AssertNoPayoutImportsOptions = {};
  if (args.stripComments !== undefined) options.stripComments = args.stripComments;
  if (args.caseInsensitiveMatch !== undefined) options.caseInsensitive = args.caseInsensitiveMatch;

  const offenses = assertNoPayoutImports(args.files, args.payoutIdentifiers, options);
  const fileCount = Array.isArray(args.files) ? args.files.length : Object.keys(args.files).length;
  const summary =
    offenses.length === 0
      ? `CLEAN: no payout-related identifiers found across ${fileCount} file(s).`
      : `FOUND payout-related identifiers in ${offenses.length}/${fileCount} file(s).`;
  return jsonResult(summary, offenses);
}
