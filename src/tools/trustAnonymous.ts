// assess_anonymous_authenticity — wraps trust-core's anonymous.assessAuthenticity.
//
// Use when you don't know who's behind a signal: crawled mentions, imported
// reviews with no verifiable identity, aggregator feeds. Reports heuristic
// sentiment patterns; it does not establish independence or fabrication.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { anonymous } from "trust-core";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const signalSchema = z.object({
  id: z.string().describe("Identifier for this signal, for reference in the output."),
  source: z
    .string()
    .describe(
      "Key into config.sourceWeights -- the source type. The library's illustrative example uses " +
        "'forum'|'community'|'marketplace'|'aggregator'|'blog'|'social'; supply your own via `config.sourceWeights`. " +
        "A source type that is not in sourceWeights has credibility 0, so that signal carries no weight.",
    ),
  sentiment: z.number().min(-1).max(1).describe("Net sentiment, -1 to 1."),
  confidence: z.number().min(0).max(1).describe("Extraction/observation confidence, 0 to 1."),
  publishedAt: z.string().nullable().optional().describe("ISO date the material was published, or null/omitted if unknown."),
});

const configSchema = z
  .object({
    sourceWeights: z.record(z.string(), z.number()).optional().describe("Overrides for source -> credibility weight, 0..1ish."),
    weights: z
      .object({
        consensus: z.number(),
        diversity: z.number(),
        volume: z.number(),
        recency: z.number(),
      })
      .optional()
      .describe("Relative weighting of the four positive components."),
    astroturfWeight: z.number().optional().describe("How much the pattern penalty (the kit's `astroturf` rules) is subtracted from the positive composite."),
    recency: z
      .object({
        halfLifeDays: z.number(),
        missingDateAgeDays: z.number(),
      })
      .optional(),
    volumeSaturation: z.number().optional().describe("Source count at which the log-scaled volume term saturates to full credit."),
    astroturf: z
      .object({
        concentrationSourceCeiling: z.number().describe("Source count at/under which single-source concentration is penalized."),
        concentrationPenalty: z.number(),
        uniformMeanThreshold: z.number().describe("Mean sentiment above this is a candidate for the uniformity penalty."),
        uniformVarianceThreshold: z.number().describe("Sentiment variance below this is a candidate for the uniformity penalty."),
        uniformPenalty: z.number(),
        minSignalsForUniformCheck: z.number().describe("Minimum signal count before the pattern checks apply at all."),
      })
      .optional(),
    confidence: z
      .object({
        high: z.number(),
        moderate: z.number(),
      })
      .optional(),
  })
  .optional()
  .describe(
    "Partial override merged over the library's illustrative EXAMPLE_ANONYMOUS_CONFIG -- omit to use the " +
      "example config as-is.",
  );

/** Registers `assess_anonymous_authenticity` on `server`. */
export function registerTrustAnonymousTool(server: McpServer): void {
  server.registerTool(
    "assess_anonymous_authenticity",
    {
      title: "Score how organic unattributed signals look",
      description:
        "Scores how organic a corpus of UNATTRIBUTED, scraped sentiment signals (crawled mentions, imported " +
        "reviews with no verifiable identity, aggregator feeds) looks, weighing a positive composite of " +
        "consensus/diversity/volume/recency against a heuristic penalty for two specific patterns: evidence " +
        "concentrated in a single source type, and unusually uniform sentiment (near-maximal with near-zero " +
        "variance). Neither pattern establishes fabrication, and source types are counted without verifying " +
        "that they are independent. It cannot show that sentiment is fabricated or that any reviewer is fake, " +
        "and varied sentiment spread across several sources isn't caught by these two checks. Treat a low " +
        "score as 'looks statistically unusual in a specific way worth a human look', not as a finding. " +
        "Signals with zero confidence, zero source weight or fully decayed recency carry no weight; when no " +
        "signal carries weight, confidence is 'insufficient' and trustScore is null (no score is reported). " +
        "Use this for reviews/mentions/buzz with no identity behind them. For signals from known, identified " +
        "contributors, use score_trust_identified instead.",
      inputSchema: {
        signals: z.array(signalSchema).describe("The unattributed signals to assess. May be empty."),
        config: configSchema,
        now: z.string().describe("ISO 'now' timestamp recency decay is computed against. Pass a fixed value for determinism."),
      },
    },
    ({ signals, config, now }) => {
      try {
        const resolvedConfig = anonymous.resolveAnonymousConfig(config);
        const result = anonymous.assessAuthenticity(signals, resolvedConfig, { now });
        const counts = `${result.eligibleSignalCount} eligible of ${result.signalCount} submitted signal(s)`;
        const summary = result.confidence.level === "insufficient" || result.trustScore === null
          ? `No evidence-backed assessment: ${result.confidence.reason ?? "no signal carried any weight"}. ` +
            `${counts}. No anonymous trust score is available. Independence is not verified.`
          : `Heuristic trust score: ${result.trustScore}/100 across ${result.sourceCount} distinct source type(s) ` +
            `(confidence: ${result.confidence.level}), from ${counts}. ` +
            `Independence is not verified. Heuristic flags: low source count=${result.flags.lowSourceCount}, ` +
            `uniform sentiment=${result.flags.uniformSentiment}. Kit explanation: ${result.explanation}`;
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
