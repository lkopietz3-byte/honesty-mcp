// corroborate_evidence — wraps corroboration-kit's corroborate (+ coverageOf).
//
// Content-checking shape: hand it the evidence signals gathered for a claim
// (and either a coverage level or the raw sample-size numbers to derive
// one), get back a graded verdict.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { corroborate, coverageOf, type Coverage } from "corroboration-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const signalSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe(
      "The distinct source artifact this signal was read from (a document id, URL, file path, table, API " +
        "response, sampled record). Independence is counted by distinct `source`, never by signal count -- " +
        "two signals sharing a source count as ONE independent source.",
    ),
  kind: z
    .enum(["textual", "structural", "behavioral", "declarative"])
    .describe(
      "Evidence type. Only non-'textual' kinds (structural/behavioral/declarative) can unlock a 'confirmed' " +
        "verdict -- a purely textual match is cheap to fake by repetition.",
    ),
  vote: z.enum(["supports", "contradicts", "inconclusive"]).describe("What this signal concluded about the claim."),
  detail: z.string().describe("Free-form, human-readable explanation of what this signal found."),
});

export function registerCorroborationTool(server: McpServer): void {
  server.registerTool(
    "corroborate_evidence",
    {
      title: "Grade evidence corroboration for a claim",
      description:
        "Grades confidence in a claim from a set of independent evidence signals -- NOT a vote count. " +
        "'confirmed' requires 2+ distinct supporting sources AND at least one non-textual signal; " +
        "disagreement among sources surfaces as 'mixed' rather than being averaged away; a null result is " +
        "'not-found' only under adequate coverage, otherwise 'inconclusive' (a thin sample can't prove a " +
        "negative); and thin coverage caps the verdict below 'confirmed' no matter how clean the signals " +
        "look. Use this whenever several pieces of evidence were gathered for a claim (by you, another tool, " +
        "or a research/verification pass) and you need an honest, non-inflated verdict instead of eyeballing " +
        "how many checks 'passed'.",
      inputSchema: {
        signals: z.array(signalSchema).describe("The evidence signals gathered about the claim. May be empty."),
        coverage: z.union([
          z.enum(["strong", "partial", "thin"]).describe("Coverage level, if already known."),
          z
            .object({
              sampledUnits: z
                .number()
                .int()
                .nonnegative()
                .describe("How many evidence units were actually examined."),
              totalUnits: z
                .number()
                .describe("Size of the full evidence pool. <= 0 (unknown/empty pool) is treated as thin."),
              hadStructuralReadAccess: z
                .boolean()
                .describe(
                  "Whether the scan also had a structural/manifest-level view of the pool (a table of " +
                    "contents, a schema, an index) independent of the per-unit sample.",
                ),
            })
            .describe("Derive a coverage level from sample-size numbers instead of stating one directly."),
        ]),
      },
    },
    async ({ signals, coverage }) => {
      try {
        const resolvedCoverage: Coverage =
          typeof coverage === "string"
            ? coverage
            : coverageOf(coverage.sampledUnits, coverage.totalUnits, coverage.hadStructuralReadAccess);
        const result = corroborate(signals, resolvedCoverage);
        const summary =
          `Verdict: ${result.verdict} (coverage: ${result.coverage}) -- ` +
          `${result.supports} supporting source(s), ${result.contradicts} contradicting source(s).`;
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
