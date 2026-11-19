// check_freshness — wraps freshness-kit's checkDatasetFreshness.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkDatasetFreshness } from "freshness-kit";
import { parseIsoInstant } from "../lib/isoInstant.js";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

/** Registers `check_freshness` on `server`. */
export function registerFreshnessTool(server: McpServer): void {
  server.registerTool(
    "check_freshness",
    {
      title: "Check which review dates are overdue",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Classifies each supplied review date as fresh, aging or stale at the caller's required as-of date. " +
        "The whole-day age must exceed a threshold to reach the next level. The dataset level is the worst " +
        "record's level. This measures time since the supplied dates. It cannot tell whether a review happened " +
        "or whether the data is accurate. As of 2026-08-02T12:00:00Z with thresholds of 14 and 45 days, a " +
        "2026-07-20 review is fresh at 13 days and a 2026-06-01 review is stale at 62 days.",
      inputSchema: z.strictObject({
        records: z.array(z.strictObject({
          id: z.string().max(1_000).describe("Record identifier, echoed in the result."),
          reviewedOn: z.string().max(29).describe("Review date as YYYY-MM-DD or a zoned ISO timestamp with seconds."),
        })).max(10_000).describe("Records with review dates. An empty array has no dates to check."),
        config: z.strictObject({
          warnAfterDays: z.number().int().nonnegative().describe("Whole days after which a record becomes aging."),
          staleAfterDays: z.number().int().nonnegative().describe("Whole days after which a record becomes stale."),
        }),
        now: z.string().max(29)
          .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/)
          .describe("Required as-of date (YYYY-MM-DD at UTC midnight) or zoned ISO timestamp with seconds."),
      }),
    },
    ({ records, config, now }) => {
      try {
        const parsed = parseIsoInstant(now);
        if (parsed === null) throw new Error("`now` must be a valid calendar date or an ISO timestamp with an explicit zone.");
        const result = checkDatasetFreshness(records, config, undefined, new Date(parsed.instant));
        const summary = result.records.length === 0
          ? "No review dates supplied."
          : `Review-date freshness: ${result.level} across ${result.records.length} record(s), based on the oldest review date.`;
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
