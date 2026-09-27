// check_claims_registry — wraps claims-registry-kit's generateClaimsReport
// (which itself funnels through evaluateClaim / checkStaleness / checkEvidenceLinked).
//
// Content-checking shape: hand it a list of public-facing claims each tied
// to an evidence reference and a last-verified date, get back which ones
// are current, stale (evidence review overdue), or unverified (no evidence
// reference at all).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatClaimsReportAsText, generateClaimsReport, type Claim } from "claims-registry-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const claimSchema = z.object({
  id: z.string().describe("Stable identifier for this claim, unique within your registry."),
  text: z.string().describe("The actual public-facing sentence, verbatim -- what a user or visitor reads."),
  evidenceRef: z
    .string()
    .describe(
      "A reference to whatever proves this claim true -- a file path, URL, test name, doc id. Empty/" +
        "whitespace-only counts as missing evidence.",
    ),
  verifiedAt: z.string().describe("ISO 8601 date this claim's evidence was last confirmed to still hold."),
  verifiedBy: z.string().optional().describe("Who or what last verified this claim (a name, 'automated-test', an agent id)."),
});

/** Registers `check_claims_registry` on `server`. */
export function registerClaimsRegistryTool(server: McpServer): void {
  server.registerTool(
    "check_claims_registry",
    {
      title: "Check public claims for stale or missing evidence",
      description:
        "Keeps public-facing product claims honest over time by checking each one against its own claimed " +
        "evidence -- the SOC2-control-evidence pattern applied to marketing/product copy instead of " +
        "compliance controls. Buckets every claim into 'current' (evidence present, review within policy), " +
        "'stale' (evidence present but `verifiedAt` is older than `maxAgeDays`, or unparseable), or " +
        "'unverified' (no evidenceRef at all -- this always wins over staleness, since a fresh date next to " +
        "an empty reference proves nothing). Use this as a periodic 'Monday-morning' review or a CI gate on " +
        "a claims registry, to catch marketing copy that drifted out of sync with what the product actually " +
        "does after a refactor. Note: this only checks that a reference EXISTS and is fresh, not that the " +
        "thing it points to still actually supports the claim's text -- pair with check_grounding for that.",
      inputSchema: {
        claims: z.array(claimSchema).min(1).describe("The claims to evaluate."),
        maxAgeDays: z
          .number()
          .nonnegative()
          .describe(
            "Staleness policy: evidence older than this many days is flagged stale. 0 is valid (every claim " +
              "must have been verified today or it's stale) -- the kit requires a finite number >= 0.",
          ),
        now: z.string().optional().describe("ISO 'now' timestamp to evaluate against. Defaults to the current time."),
      },
    },
    ({ claims, maxAgeDays, now }) => {
      try {
        const nowDate = now ? new Date(now) : new Date();
        if (Number.isNaN(nowDate.getTime())) {
          throw new Error(`\`now\` is not a valid date: ${JSON.stringify(now)}`);
        }
        const report = generateClaimsReport(claims as Claim[], maxAgeDays, nowDate);
        const text = formatClaimsReportAsText(report);
        return jsonResult(text, report);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
