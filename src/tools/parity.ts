// check_parity — wraps parity-kit's compareMirror and auditReviewStamps.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditReviewStamps, compareMirror } from "parity-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const MAX_RECORDS = 10_000;
const MAX_DATASET_LENGTH = 2_000_000;

const datasetSchema = z.union([
  z.array(z.unknown()).max(MAX_RECORDS),
  // Keep id-keyed objects intact, including an own key named "__proto__".
  z.unknown()
    .refine(
      (value): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value),
      "Expected an object keyed by record id",
    )
    .meta({ type: "object", additionalProperties: true }),
]).describe("Array of records or an object keyed by record id. Up to 10,000 records and 2,000,000 characters of JSON.");

const fieldName = z.string().min(1).max(4_096);
const fieldNames = z.array(fieldName).max(128);
const commonOptions = {
  key: fieldName.optional().describe("Field that identifies a record. Default id."),
  ignoreFields: fieldNames.optional().describe("Fields to leave out. Unknown field names are reported."),
  allowEmpty: z.boolean().optional().describe("Allow an empty canonical set or snapshot. Default false."),
  foldCase: z.boolean().optional().describe("Fold case when looking for look-alike keys. Default true."),
  foldInvisible: z.boolean().optional().describe("Ignore invisible characters when looking for look-alike keys. Default true."),
};

const checkSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("mirror"),
    canonical: datasetSchema.describe("Canonical records."),
    mirror: datasetSchema.describe("Copied records to compare."),
    options: z.strictObject({
      ...commonOptions,
      fields: fieldNames.min(1).optional().describe("Fields to compare. Default all fields."),
      reviewedField: fieldName.optional().describe("Review-date field used to detect an unchanged stamp hiding drift."),
      numberTolerance: z.number().nonnegative().optional().describe("Absolute tolerance for numeric fields. Default 0."),
    }).optional(),
  }),
  z.strictObject({
    mode: z.literal("review-stamps"),
    before: datasetSchema.describe("Earlier snapshot."),
    after: datasetSchema.describe("Later snapshot."),
    options: z.strictObject({
      ...commonOptions,
      reviewedField: fieldName.describe("Field containing the review date."),
      sourceFields: fieldNames.describe("Source fields. Pass [] if there are none."),
      reviewerField: fieldName.optional().describe("Field containing the reviewer."),
      expiryField: fieldName.optional().describe("Field containing an expiry or next-review date."),
      valueFields: fieldNames.optional().describe("Fields that count as values when looking for a change."),
      now: z.union([z.string().max(35), z.number()]).optional()
        .describe("Explicit zoned timestamp or epoch milliseconds. Omit to skip future-date checks."),
      bulkThreshold: z.number().int().nonnegative().optional().describe("Flag more than this many bumps to one UTC day. Default 10."),
    }),
  }),
]);

/** Registers `check_parity` on `server`. */
export function registerParityTool(server: McpServer): void {
  server.registerTool(
    "check_parity",
    {
      title: "Compare a mirror or audit review stamps",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "With mode 'mirror', compares caller-supplied canonical and mirror records for missing, extra or changed " +
        "data. With mode 'review-stamps', compares before and after snapshots for date changes with no visible " +
        "evidence of a recheck. A changed value, source or reviewer can count as evidence even if no one reviewed " +
        "anything. List automatic edits in ignoreFields. The stamp audit does not flag value changes by themselves. " +
        "The kit cannot tell which copy is right, whether its data is true or current, or whether a recheck took " +
        "place. Look-alike key detection covers only a limited set of characters. Supply JSON data directly. " +
        "For record 'a' with a canonical price of 10, a mirror price of 10 yields 'ok' and a mirror price of 25 " +
        "yields 'flagged'. Moving reviewedOn from '2026-01-01' to '2026-01-02' while price stays 10 is flagged as " +
        "stamp-only. If price changes to 11 with the date, the same audit reports 'ok'.",
      inputSchema: z.strictObject({ check: checkSchema }),
    },
    ({ check }) => {
      try {
        const [first, second] = check.mode === "mirror" ? [check.canonical, check.mirror] : [check.before, check.after];
        for (const dataset of [first, second]) {
          const recordCount = Array.isArray(dataset) ? dataset.length : Object.keys(dataset).length;
          if (recordCount > MAX_RECORDS || JSON.stringify(dataset).length > MAX_DATASET_LENGTH) {
            return errorResult(`Each dataset is limited to ${MAX_RECORDS} records and ${MAX_DATASET_LENGTH} characters of JSON.`);
          }
        }
        const result = check.mode === "mirror"
          ? compareMirror(first, second, check.options)
          : auditReviewStamps(first, second, check.options);
        const label = check.mode === "mirror" ? "Mirror comparison" : "Review stamp audit";
        return jsonResult(`${label}: ${result.status}. Compared ${result.compared} record(s) in the supplied data.`, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
