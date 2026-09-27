// score_trust_identified — wraps trust-core's identified.scoreEntity.
//
// Use when every signal has an identity and a history behind it: a reviewer
// account, a rater, an inspector, a verified buyer.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { identified } from "trust-core";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const signalSchema = z.object({
  id: z.string().describe("Identifier for this signal, for reference in the output."),
  tier: z
    .string()
    .describe(
      "Key into config.tierWeights -- the contributor's standing/tier. The library's illustrative example " +
        "uses 'new'|'standard'|'verified'|'expert'; supply your own vocabulary via `config.tierWeights`.",
    ),
  source: z.string().describe("Key into config.sourceWeights -- how the signal reached the system."),
  proof: z.string().describe("Key into config.proofWeights -- strength of evidence the event happened."),
  reputation: z.number().min(0).max(100).nullable().describe("Contributor reputation 0-100, or null if unknown (treated as neutral)."),
  occurredAt: z.string().nullable().describe("ISO date the underlying event happened, or null if unknown."),
  value: z.number().min(0).max(100).describe("The 0-100 score this signal reports."),
});

const configSchema = z
  .object({
    tierWeights: z.record(z.string(), z.number()).optional().describe("Overrides for tier -> weight multiplier."),
    sourceWeights: z.record(z.string(), z.number()).optional().describe("Overrides for source -> weight multiplier."),
    proofWeights: z.record(z.string(), z.number()).optional().describe("Overrides for proof -> weight multiplier."),
    reputation: z
      .object({
        floor: z.number().describe("Multiplier applied at reputation 0."),
        ceil: z.number().describe("Multiplier applied at reputation 100."),
        neutral: z.number().describe("Multiplier applied when reputation is unknown."),
      })
      .optional(),
    recency: z
      .object({
        halfLifeDays: z.number().describe("Days for the recency multiplier to halve."),
        missingDateAgeDays: z.number().describe("Assumed age (days) for signals with no occurredAt."),
      })
      .optional(),
    confidence: z
      .object({
        high: z.number().describe("Effective sample size at/above which confidence is 'high'."),
        moderate: z.number().describe("Effective sample size at/above which confidence is 'moderate'."),
      })
      .optional(),
  })
  .optional()
  .describe(
    "Partial override merged over the library's illustrative EXAMPLE_IDENTIFIED_CONFIG (tiers new/standard/" +
      "verified/expert). Real callers should supply their own tier/source/proof vocabulary for their domain " +
      "-- omit to use the example config as-is.",
  );

/** Registers `score_trust_identified` on `server`. */
export function registerTrustIdentifiedTool(server: McpServer): void {
  server.registerTool(
    "score_trust_identified",
    {
      title: "Score an entity from known contributors",
      description:
        "Scores one entity (or one dimension of one entity -- quality, reliability, communication, ...) from " +
        "signals contributed by KNOWN, identified sources: reviewer accounts, raters, inspectors, verified " +
        "buyers. Weighs each signal by tier x source x proof-strength x reputation x recency decay, sums to " +
        "an effective (credibility-weighted) sample size, and shrinks the result toward a domain baseline " +
        "('prior') by a configurable dial -- thin evidence stays close to the prior, deep evidence overrides " +
        "it. Use this for trust/reputation scores backed by attributable evidence. For unattributed/scraped " +
        "signals with no identity behind them, use assess_anonymous_authenticity instead.",
      inputSchema: {
        signals: z.array(signalSchema).describe("The identified signals to score from. May be empty (yields the prior)."),
        config: configSchema,
        asOf: z.string().describe("ISO 'now' timestamp recency decay is computed against. Pass a fixed value for determinism."),
        prior: z.number().min(0).max(100).describe("The domain/category baseline the score shrinks toward when evidence is thin."),
        dial: z
          .union([z.enum(["as_is", "balanced", "strict"]), z.number()])
          .optional()
          .describe("Shrinkage strength: a named preset, or a raw phantom-prior-signal count. Defaults to 'balanced'."),
      },
    },
    ({ signals, config, asOf, prior, dial }) => {
      try {
        const resolvedConfig = identified.resolveIdentifiedConfig(config);
        const result = identified.scoreEntity(signals, resolvedConfig, { asOf, prior, dial });
        const summary =
          `Score: ${result.score.toFixed(1)}/100 (raw: ${result.raw === null ? "n/a (no evidence)" : result.raw.toFixed(1)}), ` +
          `confidence: ${result.confidence.level} (nEff=${result.nEff.toFixed(2)}), from ${result.signalCount} signal(s).`;
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
