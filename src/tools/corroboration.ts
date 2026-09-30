// corroborate_evidence — wraps corroboration-kit's corroborate (+ coverageOf).
//
// Content-checking shape: hand it the evidence signals gathered for a claim
// (and either a coverage level or the raw sample-size numbers to derive
// one), get back a graded verdict.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { corroborate, coverageOf, type Coverage } from "corroboration-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

// corroboration-kit's own rule: a source made only of whitespace, control,
// invisible formatting characters or the braille blank is missing.
const BLANK_SOURCE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\u2800]*$/u;

const signalSchema = z.object({
  source: z
    .string()
    .min(1)
    .refine((value) => !BLANK_SOURCE.test(value), {
      message: "source must contain a visible character (not only whitespace or invisible characters)",
    })
    .describe(
      "The distinct source artifact this signal was read from (a document id, URL, file path, table, API " +
        "response, sampled record). Distinct normalized source identities are counted, never signal count -- " +
        "two signals sharing an identity count once. The kit trims whitespace, applies NFC normalization " +
        "and normalizes HTTP(S) URLs. A source made only of whitespace or invisible characters is rejected. " +
        "Independence is not verified.",
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

/** Registers `corroborate_evidence` on `server`. */
export function registerCorroborationTool(server: McpServer): void {
  server.registerTool(
    "corroborate_evidence",
    {
      title: "Grade evidence corroboration for a claim",
      description:
        "Grades the supplied evidence for a claim and reports two things: the evidence direction " +
        "('supports', 'contradicts', 'mixed' or 'none') and a verdict for how strong the evidence is in that " +
        "direction. Read the direction first: a 'confirmed' verdict with direction 'contradicts' means the supplied " +
        "evidence strongly contradicts the claim. The grade uses distinct normalized source identities and " +
        "caller-assigned signal kinds. Independence is not verified. 'confirmed' requires 2+ distinct sources in " +
        "the same direction (supporting OR contradicting) AND at least one non-textual signal in that direction. " +
        "Disagreement among sources surfaces as 'mixed' rather than being averaged away; a null result is " +
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
                .describe(
                  "Size of the full evidence pool. 0 (unknown/empty pool) is treated as thin. A negative " +
                    "value, or a sampledUnits greater than totalUnits, is an impossible input the kit rejects " +
                    "outright (surfaces as a tool error, not a coverage verdict).",
                ),
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
    ({ signals, coverage }) => {
      try {
        const resolvedCoverage: Coverage =
          typeof coverage === "string"
            ? coverage
            : coverageOf(coverage.sampledUnits, coverage.totalUnits, coverage.hadStructuralReadAccess);
        const result = corroborate(signals, resolvedCoverage);
        const summary =
          `Evidence direction: ${result.direction} -- verdict: ${result.verdict} (coverage: ${result.coverage}) -- ` +
          `${result.supports} supporting source(s), ${result.contradicts} contradicting source(s).`;
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
