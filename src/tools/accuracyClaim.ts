// assess_accuracy_claim — wraps accuracy-claim-kit's assessAccuracyClaim.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assessAccuracyClaim } from "accuracy-claim-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const sampleFields = {
  n: z.number().int().positive().describe("Number of items in the denominator."),
  correct: z.number().int().nonnegative().optional().describe("Number of correct items. Supply correct, errors, or both."),
  errors: z.number().int().nonnegative().optional().describe("Number of errors. If both counts are given, they must sum to n."),
};

const optionsSchema = z.strictObject({
  confidence: z.number().min(0.5).lt(1).optional().describe("Two-sided confidence level. Default 0.95."),
  minN: z.number().int().positive().optional().describe("Minimum sample size for an interval-based verdict. Default 30."),
  maxAgeDays: z.number().int().nonnegative().optional().describe("Maximum age of the evaluation. Requires now."),
  now: z.string().length(10).optional().describe("Reference date in YYYY-MM-DD form."),
  requireScope: z.boolean().optional().describe("Refuse a claim with no declared population."),
  conservative: z.boolean().optional().describe("Require support at the conservative end of the interval."),
  strictPrecision: z.boolean().optional().describe("Treat excessive printed precision as an overstatement."),
}).optional().describe("Optional assessment policy. Omit to use the kit defaults.");

/** Registers `assess_accuracy_claim` on `server`. */
export function registerAccuracyClaimTool(server: McpServer): void {
  server.registerTool(
    "assess_accuracy_claim",
    {
      title: "Assess an accuracy claim against its counts",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Judges a claimed accuracy or related rate against the supplied counts and returns the kit's verdict, " +
        "reasons and suggested statement. It takes the caller's word on who labeled the items and how they were " +
        "sampled. It cannot determine whether the system is accurate, the labels are right or the sample represents " +
        "production. For a random sample with human labels and 990 of 1,000 correct, an accuracy claim of " +
        "'98%' is supported and '99.5%' is contradicted.",
      inputSchema: z.strictObject({
        claim: z.strictObject({
          metric: z.enum([
            "accuracy", "error-rate", "precision", "recall", "false-positive-rate", "false-negative-rate",
            "specificity", "npv", "sensitivity", "ppa", "ppv", "npa", "opa",
            "f1", "auc", "roc-auc", "wer", "cer", "bleu", "rouge", "map", "composite", "other",
          ]).describe("Claimed metric. The kit returns a refusal for recognized metrics it cannot assess."),
          value: z.number().describe("Claimed rate as a proportion from 0 to 1."),
          display: z.string().max(64).optional().describe("Printed form of the claim's figure."),
          text: z.string().max(2_000).optional().describe("Claim wording. Required to name the benchmark for fixed-set claims."),
        }),
        sample: z.strictObject(sampleFields).optional().describe("Counts. Omit if they were not disclosed."),
        provenance: z.strictObject({
          source: z.enum(["human", "automated", "by-construction", "model", "mixed", "unknown"])
            .describe("Declared label source. Automated means deterministic known answers."),
          raters: z.number().int().positive().optional().describe("Number of independent human raters, if known."),
        }),
        sampling: z.enum(["random", "stratified", "ranked", "convenience", "unknown", "complete", "held-out-split", "cross-validation"])
          .describe("How the items were selected."),
        strata: z.array(z.strictObject({ name: z.string().max(1_000), ...sampleFields })).max(1_000).optional()
          .describe("Required for stratified samples. Counts must add up to the sample."),
        retractions: z.strictObject({
          count: z.number().int().nonnegative(),
          includedInSample: z.boolean(),
        }).optional().describe("Known retractions and whether the sample included them."),
        benchmark: z.strictObject({ name: z.string().max(200) }).optional()
          .describe("The named set for complete or held-out-split sampling."),
        population: z.strictObject({ claimed: z.string().max(200), evaluated: z.string().max(200) }).optional()
          .describe("Identifiers for the population claimed and the population evaluated."),
        evaluatedAt: z.string().length(10).optional().describe("Evaluation date in YYYY-MM-DD form."),
        options: optionsSchema,
      }),
    },
    ({ options, ...input }) => {
      try {
        const result = assessAccuracyClaim(input, options);
        return jsonResult(`Claim versus supplied counts: ${result.verdict}. ${result.suggestedStatement}`, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
