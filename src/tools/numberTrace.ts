// trace_numbers — wraps number-trace-kit's traceNumbers.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { traceNumbers } from "number-trace-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const optionsSchema = z.strictObject({
  preset: z.enum(["strict", "report"]).optional().describe("Default strict. Report enables derivations and looser unit matching."),
  locale: z.string().max(100).optional().describe("Locale for the answer. Default en-US."),
  evidenceLocale: z.string().max(100).optional().describe("Locale for the evidence. Defaults to the answer locale."),
  derivations: z.array(z.enum(["sum", "difference", "ratio", "percent-change", "percent-of", "average", "product"]))
    .max(7).optional().describe("Override the preset's enabled derivations."),
  maxOperands: z.union([z.literal(2), z.literal(3)]).optional().describe("Number of operands to try for sums, differences and averages. Default 2."),
  maxCandidates: z.number().int().min(1).max(1_000_000).optional().describe("Limit the derivation search. Report preset default 50,000."),
  roundSums: z.boolean().optional().describe("Allow sums and differences to match after rounding."),
  evidenceScale: z.union([z.enum(["thousand", "million", "billion", "trillion"]), z.number().int().min(0).max(12)])
    .optional().describe("Scale of bare evidence values. The kit does not infer it from a table heading."),
  evidenceScaleApplies: z.enum(["bare", "bare-and-currency"]).optional()
    .describe("Set bare-and-currency to also scale currency cells without their own magnitude."),
  evidenceCurrency: z.string().max(4).optional().describe("Currency code for bare evidence values."),
  evidenceOrder: z.enum(["oldest-first", "newest-first"]).optional().describe("Order of periods for directional derivations."),
  rounding: z.array(z.enum(["half-up", "half-even"])).max(2).optional().describe("Use [] to require exact matches."),
  signMode: z.enum(["explicit", "strict", "magnitude"]).optional().describe("Use strict to flag dropped signs as unknown."),
  ignoreStructure: z.boolean().optional().describe("Skip list markers, bracket citations and similar labels."),
  checkIdentifiers: z.boolean().optional().describe("Report an unknown when a skipped identifier is absent from the evidence."),
}).optional().describe("Optional tracing settings. Omit to use the kit's strict preset.");

/** Registers `trace_numbers` on `server`. */
export function registerNumberTraceTool(server: McpServer): void {
  server.registerTool(
    "trace_numbers",
    {
      title: "Trace numbers in an answer to evidence",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "Checks whether numbers in an answer appear in the supplied evidence, allowing recognized rounding. " +
        "The report preset can match derived values such as sums, using operands anywhere in the evidence. " +
        "It cannot check whether the numbers are true, appear in the right sentence, or belong to the right table row. " +
        "Numbers written as words are not read. Read the per-number statuses and skipped list even when the kit " +
        "returns 'clean', since it can return that verdict with no numbers checked. " +
        "With evidence 'North: 12 orders. South: 15 orders.', 'North: 12 orders.' traces, 'North: 13 orders.' " +
        "is untraced, and 'Total: 27 orders.' is derived as a sum with the report preset.",
      inputSchema: z.strictObject({
        answer: z.string().max(2_000_000).describe("The answer text to check."),
        evidence: z.string().max(2_000_000).describe("Evidence as plain text."),
        options: optionsSchema,
      }),
    },
    ({ answer, evidence, options }) => {
      try {
        const result = traceNumbers(answer, evidence, options);
        const { traced, rounded, derived, untraced, unknown, ignored, skipped } = result.counts;
        return jsonResult(
          `Number trace: ${traced} traced, ${rounded} rounded, ${derived} derived, ${untraced} untraced, ` +
            `${unknown} unknown, ${ignored} ignored, ${skipped} skipped. Matches concern values in the supplied evidence.`,
          result,
        );
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
