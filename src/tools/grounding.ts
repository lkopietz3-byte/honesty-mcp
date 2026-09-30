// check_grounding — wraps grounding-kit's classifyDocument.
//
// Content-checking shape: hand it AI-generated text plus the evidence map
// it's supposed to be citing, get back a verdict for each checked unit.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { classifyDocument } from "grounding-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

/** Registers `check_grounding` on `server`. */
export function registerGroundingTool(server: McpServer): void {
  server.registerTool(
    "check_grounding",
    {
      title: "Check citation grounding",
      description:
        "Checks citation markers and lexical support in AI-generated text. Splits `text` into checked units and " +
        "classifies each one against `evidence`: 'grounded' (cites a marker accepted by the default lexical " +
        "support matcher), 'placeholder' (an honest '[TK]'/'[citation needed]' gap), 'ungrounded' (an uncited " +
        "unit without a placeholder), or 'invalid' (cites a marker id that is missing from `evidence`, or " +
        "whose evidence is rejected by the default support matcher; this outranks every other status). " +
        "An invalid result does not establish that a citation was fabricated. This is a mechanical/structural check, not " +
        "a truth checker: the default support check is naive substring/word-overlap matching, not semantic " +
        "entailment -- it can pass a coincidental word match and can fail a genuine paraphrase, and it cannot " +
        "verify that the evidence itself is true. Use this before shipping any AI-written report, summary, or " +
        "answer that cites sources, to flag citations that need review. Treat any " +
        "'invalid' sentence as a hard stop; treat 'ungrounded' sentences as claims that should probably cite " +
        "something but currently don't. For higher-stakes content, use grounding-kit directly with a custom " +
        "`supports()` function (embedding-similarity or NLI-based) instead of the default matcher.",
      inputSchema: {
        text: z
          .string()
          .min(1)
          .max(2_000_000)
          .describe(
            "The AI-generated text to check (up to 2,000,000 characters). Citation markers use the kit's default convention " +
              '`[[cite:id]]` (e.g. "The bridge opened in 1932 [[cite:source-a]]."). This tool uses the ' +
              "default marker/placeholder patterns; if your generator emits a different citation syntax " +
              "(e.g. \"[1]\"), rewrite markers to `[[cite:1]]` before calling, or use grounding-kit directly " +
              "with a custom markerPattern.",
          ),
        evidence: z
          .record(z.string(), z.string())
          .describe(
            "Map of citation marker id -> the evidence text/span it claims to support. This is the closed " +
              "world: a marker cited in `text` whose id is NOT a key here is flagged invalid, and a marker " +
              "whose evidence text doesn't plausibly support the sentence is also flagged invalid. Pass {} if " +
              "there is no evidence at all (every citation will then be invalid, and uncited claims will be " +
              "'ungrounded').",
          ),
      },
    },
    ({ text, evidence }) => {
      try {
        const result = classifyDocument(text, evidence);
        const summary = result.isClean
          ? `Structurally clean: ${result.sentences.length} checked unit(s), ${result.counts.placeholder} placeholder(s), ` +
            `${result.counts.grounded} grounded, 0 ungrounded, 0 invalid citations. This does not verify truth or semantic support.`
          : `${result.counts.invalid} invalid unit(s) (missing evidence or rejected by the default support matcher), ` +
            `${result.counts.ungrounded} ungrounded unit(s), ${result.counts.placeholder} placeholder(s), ` +
            `${result.counts.grounded} grounded, out of ${result.sentences.length} checked unit(s). ` +
            "This does not verify truth or semantic support.";
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
