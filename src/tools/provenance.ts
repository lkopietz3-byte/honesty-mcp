// check_provenance_claims — wraps provenance-kit's validateClaims.
//
// Content-checking shape: hand it a list of reader-facing claims (each
// tagged with a provenance tier), get back every place the copy's certainty
// language outruns what its tier actually backs.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateClaims, type ValidateClaimsOptions } from "provenance-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const tierEnum = z.enum(["verified", "modeled", "editorial"]);

const claimSchema = z.object({
  id: z.string().describe("Stable identifier for the claim (slug, DB id, DOM id)."),
  text: z.string().describe("The claim text exactly as it would be shown to a reader."),
  tier: tierEnum.describe(
    "'verified' = checked directly against the source's own published material. 'modeled' = an estimate " +
      "derived from public signal, explicitly not a measurement or guarantee. 'editorial' = stated judgment/opinion.",
  ),
  sourceRef: z.string().optional().describe("Pointer to what backs the claim (URL, doc citation, record id)."),
});

const certaintyPhraseSchema = z.union([
  z.string().describe("A bare phrase to scan for."),
  z.object({
    phrase: z.string(),
    reason: z.string().optional().describe("Why this phrase asserts certainty, surfaced in offense messages."),
  }),
]);

/** Registers `check_provenance_claims` on `server`. */
export function registerProvenanceTool(server: McpServer): void {
  server.registerTool(
    "check_provenance_claims",
    {
      title: "Check claims for unbacked certainty language",
      description:
        "Scans reader-facing claims for certainty-implying language (\"(verified)\", \"independently " +
        "verified\", \"guaranteed\", \"fact-checked\", \"100% accurate\", ...) that isn't backed by an " +
        "appropriate provenance tier, plus tiers that require a sourceRef but don't have one, and claims " +
        "carrying an unrecognized tier. Run it on any copy, marketing page, or AI-drafted content that makes " +
        "factual-sounding claims before it ships. The default phrase list is a small starter list, not a " +
        "taxonomy -- it will miss phrases it doesn't know about (e.g. 'clinically proven', 'third-party " +
        "tested'); extend `certaintyPhrases` for your domain. A negation word ('not', 'without', ...) " +
        "suppresses a match only inside the same clause (a comma, semicolon, period, colon, !, ?, em or en " +
        "dash, or line break ends it; a plain hyphen does not), after the last 'and'/'but', and within `negationWindow` characters. It is a " +
        "window, not a parser, so it can still suppress an overclaim the negation does not govern. An empty " +
        "result means no wording offenses were found under the configured rules; it does not verify the claims.",
      inputSchema: {
        claims: z.array(claimSchema).min(1).describe("The claims to check."),
        certaintyPhrases: z
          .array(certaintyPhraseSchema)
          .optional()
          .describe(
            "Override the certainty-phrase vocabulary. Defaults to a generic starter list ('(verified)', " +
              "'independently verified', 'proprietary dataset', 'guaranteed', 'fact-checked', '100% accurate', ...).",
          ),
        certaintyRequiresTier: z
          .array(tierEnum)
          .optional()
          .describe("Tiers strong enough to back certainty language. Default ['verified']."),
        requireSourceRefForTiers: z
          .array(tierEnum)
          .optional()
          .describe("Tiers that must carry a visibly non-empty sourceRef (not only whitespace or invisible characters). Default ['verified']."),
        caseSensitive: z.boolean().optional().describe("Case-sensitive phrase matching. Default false."),
        negationWindow: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Maximum characters before a phrase match to scan for a negation word ('not', 'without', ...), cut off at the start of the clause. Default 40."),
      },
    },
    ({ claims, certaintyPhrases, certaintyRequiresTier, requireSourceRefForTiers, caseSensitive, negationWindow }) => {
      try {
        const options: ValidateClaimsOptions = {
          certaintyPhrases,
          certaintyRequiresTier,
          requireSourceRefForTiers,
          caseSensitive,
          negationWindow,
        };
        const offenses = validateClaims(claims, options);
        const summary =
          offenses.length === 0
            ? `CLEAN: ${claims.length} claim(s) checked; no wording offenses found under the configured rules (this does not verify the claims).`
            : `FOUND ${offenses.length} offense(s) across ${claims.length} claim(s).`;
        return jsonResult(summary, offenses);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
