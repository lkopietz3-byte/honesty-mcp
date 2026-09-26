// check_mutation_invariance — wraps mutation-invariance-kit's assertInvariance,
// the generalized form of payout-invariance-kit's check for any "should not
// depend on X" claim (a protected attribute, geography, price, or anything
// else you name).
//
// Same function-as-source-string treatment as check_payout_invariance, for
// the same reason: `fn` and each scenario's `mutate` are real JS functions
// in the underlying API, and MCP arguments are JSON. Built and called inside
// a worker_threads Worker with a bounded timeout -- see lib/runFunctionJob.ts.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InvarianceResult } from "mutation-invariance-kit";
import { runFunctionJob } from "../lib/runFunctionJob.js";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const scenarioSchema = z.object({
  name: z.string().min(1).describe("Short, descriptive name for this mutation, shown in failure output."),
  mutateSource: z
    .string()
    .min(1)
    .describe(
      "JS source for a pure function `(baseInput) => mutatedInput` that rewrites the axis under test on a " +
        "copy of baseInput (e.g. swap an applicant name for a gender/ethnicity-coded alternative, change a " +
        "ZIP code, change a listed price) while leaving everything else equal.",
    ),
  category: z
    .enum(["protected-attribute", "geography", "price", "payout", "custom"])
    .optional()
    .describe("Informational label for which axis this scenario tests. Purely for grouping/filtering in reports."),
});

export function registerMutationInvarianceTool(server: McpServer): void {
  server.registerTool(
    "check_mutation_invariance",
    {
      title: "Check whether a decision function ignores a given input",
      description:
        "Checks -- for the scenarios you supply, not a formal proof for every possible input -- whether a " +
        "decision, score, or ranking function's output changes depending on a variable it claims not to " +
        "depend on: a protected attribute (name, inferred ethnicity/gender/age signal), geography, price, or " +
        "any axis you name. Re-runs your actual function once per named mutation scenario and confirms the " +
        "output is byte-identical to the unmutated baseline; a scenario whose mutation didn't actually change " +
        "the input is flagged 'vacuous' rather than silently counting as a pass. This is the general form of " +
        "check_payout_invariance -- use this one for hiring/lending/insurance/housing-style fairness claims " +
        "or any other 'should not depend on X' claim; use check_payout_invariance specifically for the " +
        "payout/commission axis (it also has a static-import-grep mode this tool doesn't need). Pass JS " +
        "source for the function under test and each mutation -- this runs in a worker thread with a bounded " +
        "timeout, not a sandbox, so only pass code you wrote or trust. A pass covers only the mutations you " +
        "ran: it says nothing about values you didn't try, fields changed one at a time but never together, " +
        "or a proxy field you never touched (a ZIP code standing in for race, a graduation year for age). " +
        "Re-run this in CI whenever the function changes.",
      inputSchema: {
        fnSource: z
          .string()
          .min(1)
          .describe(
            'JS source for the pure function `(input) => output` under test, e.g. "(applicant) => ' +
              'scoreApplicant(applicant)". Built and run in a worker thread with a bounded timeout (default ' +
              "10s, see README).",
          ),
        baseInput: z.any().describe("The baseline input to fn."),
        scenarios: z.array(scenarioSchema).min(1).describe("Named mutation scenarios to re-run fn under."),
      },
    },
    async ({ fnSource, baseInput, scenarios }) => {
      try {
        const result = await runFunctionJob<InvarianceResult<unknown, unknown>>({
          kind: "mutation-invariance",
          fnSource,
          baseInput,
          scenarios,
        });
        const summary = result.passed
          ? `PASSED: output is invariant across all ${scenarios.length} scenario(s).`
          : `FAILED: ${result.failures.length}/${scenarios.length} scenario(s) changed the output` +
            (result.vacuous.length > 0
              ? `; ${result.vacuous.length} scenario(s) were vacuous (the mutation didn't actually change the input).`
              : ".");
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
