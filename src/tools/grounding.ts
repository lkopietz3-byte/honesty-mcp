// check_grounding — wraps grounding-kit's classifyDocument.
//
// Content-checking shape: hand it AI-generated text plus the evidence map
// it's supposed to be citing, get back a verdict for each checked unit.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { classifyDocument } from "grounding-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";
import { kitAtLeast } from "../lib/kitVersion.js";

/**
 * The tool description. It says plainly what the default lexical matcher can
 * and cannot do (each example below was run against the kit), and names the
 * per-unit reasons only when the installed grounding-kit reports them.
 */
function groundingDescription(): string {
  const reasons = kitAtLeast("grounding-kit", "0.3.0")
    ? "Each unit carries `reasons` (per cited id: supported, not-supported, no-content-words, invalid-evidence or " +
      "unknown-id), and `nonClaims` lists scaffolding lines (rules, table separators, bare fences) that were set aside. "
    : "To see why a unit is 'invalid', compare its `citedIds` with the keys of `evidence`: an id that is not a key " +
      "is missing evidence; otherwise the default matcher rejected it. ";
  return (
    "Checks citation markers and lexical support in AI-generated text. Splits `text` into checked units and " +
    "classifies each one against `evidence`: 'grounded' (cites a marker accepted by the default lexical " +
    "support matcher), 'placeholder' (an honest '[TK]'/'[citation needed]' gap), 'ungrounded' (an uncited " +
    "unit without a placeholder), or 'invalid' (cites a marker id that is missing from `evidence`, or " +
    "whose evidence is rejected by the default support matcher; this outranks every other status). " +
    "'invalid' means the unit needs human review. It does not establish that a citation was fabricated, and " +
    "it covers both a missing id and a matcher rejection. " +
    reasons +
    "This is a mechanical check, not a truth checker. The default support matcher counts overlapping words. " +
    "It rejects some faithful paraphrases (evidence '65% of the audio is English' against the claim 'about two " +
    "thirds of the audio is English'), and it accepts a wrong figure or a negated claim when most other words " +
    "overlap ('trained on 68,000 hours' passes against evidence of 680,000 hours; 'does not support " +
    "real-time transcription' passes against evidence that it does). It cannot verify that the evidence itself is " +
    "true. Use this before shipping any AI-written report, summary, or answer that cites sources, to find " +
    "citations that need a person to look: send every 'invalid' unit to review, and treat 'ungrounded' units as " +
    "claims that should probably cite something but currently don't. A 'grounded' unit is not confirmed " +
    "true. For higher-stakes content, use grounding-kit directly with a custom `supports()` function " +
    "(embedding-similarity or NLI-based) instead of the default matcher."
  );
}

/** Registers `check_grounding` on `server`. */
export function registerGroundingTool(server: McpServer): void {
  server.registerTool(
    "check_grounding",
    {
      title: "Check citation grounding",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: groundingDescription(),
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
