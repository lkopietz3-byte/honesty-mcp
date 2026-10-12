// corroborate_evidence — wraps corroboration-kit's corroborate (+ coverageOf).
//
// Content-checking shape: hand it the evidence signals gathered for a claim
// (and either a coverage level or the raw sample-size numbers to derive
// one), get back a graded verdict.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { corroborate, coverageOf, type Coverage } from "corroboration-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";
import { installedKitVersion, kitAtLeast } from "../lib/kitVersion.js";

/** corroboration-kit 0.3.0 added origins (`origin`, `derivedFrom`, `inferOrigins`) and the `groups` result field. */
const ORIGINS_MIN_VERSION = "0.3.0";

/** Whether the installed corroboration-kit counts independent origins. Read when the tool is registered. */
function kitCountsOrigins(): boolean {
  return kitAtLeast("corroboration-kit", ORIGINS_MIN_VERSION);
}

/** The `corroborate` signature of the origins release; the older types do not declare its third argument. */
type CorroborateWithOptions = (
  signals: unknown,
  coverage: Coverage,
  options?: { inferOrigins?: boolean },
) => ReturnType<typeof corroborate> & { groups?: { signals: number[]; merges: unknown[] }[] };

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
        "and normalizes HTTP(S) URLs (exactly which spellings merge is in the tool description). A source made " +
        "only of whitespace or invisible characters is rejected. Independence is not verified.",
    ),
  origin: z
    .string()
    .optional()
    .describe(
      "[corroboration-kit 0.3+] Who published this, when you know it better than the URL shows: signals that " +
        "declare the same origin count once, and a signal that declares one is not grouped by its URL. Omit the " +
        "key when unknown; null is rejected.",
    ),
  derivedFrom: z
    .array(z.string())
    .optional()
    .describe(
      "[corroboration-kit 0.3+] Sources this one copies or summarizes. Signals that share an upstream, or one " +
        "that names another signal's `source`, count once.",
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

/** What counts as one source, worded for the installed kit. */
function sourceCountingNote(originsSupported: boolean): string {
  return originsSupported
    ? "Sources are counted by independent origin, not by string: spellings of one page (host letter case, " +
        "percent-escape case, a trailing host dot, an empty query, #fragment, default port) are one source, and " +
        "so are pages of one site or repository, hosts that share a registered domain, and a copy next to its " +
        "upstream. The result's `groups` says which signals were merged and why. Declare `origin` or " +
        "`derivedFrom` on a signal when you know better, or pass `inferOrigins: false` to count by page only. "
    : "Sources are counted by normalized identity only: host letter case, #fragment and default port (:443) " +
        "fold together, but a trailing slash, http versus https, a query string, www., a mirror of the same file " +
        "and './docs/a.md' versus 'docs/a.md' count as separate sources, so canonicalize sources before calling. ";
}

function corroborationDescription(originsSupported: boolean): string {
  return (
    "Grades the supplied evidence for a claim and reports two things: the evidence direction " +
    "('supports', 'contradicts', 'mixed' or 'none') and a verdict for how strong the evidence is in that " +
    "direction. Read the direction first: a 'confirmed' verdict with direction 'contradicts' means the supplied " +
    "evidence strongly contradicts the claim. The grade uses distinct normalized source identities and " +
    "caller-assigned signal kinds. " +
    sourceCountingNote(originsSupported) +
    "Independence is not verified. 'confirmed' requires 2+ distinct sources in " +
    "the same direction (supporting OR contradicting) AND at least one non-textual signal in that direction. " +
    "Disagreement among sources surfaces as 'mixed' rather than being averaged away; a null result is " +
    "'not-found' only under adequate coverage, otherwise 'inconclusive' (a thin sample can't prove a " +
    "negative); and thin coverage caps the verdict below 'confirmed' no matter how clean the signals " +
    "look. Use this whenever several pieces of evidence were gathered for a claim (by you, another tool, " +
    "or a research/verification pass) and you need an honest, non-inflated verdict instead of eyeballing " +
    "how many checks 'passed'."
  );
}

/** Registers `corroborate_evidence` on `server`. */
export function registerCorroborationTool(server: McpServer): void {
  const originsSupported = kitCountsOrigins();
  server.registerTool(
    "corroborate_evidence",
    {
      title: "Grade evidence corroboration for a claim",
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: corroborationDescription(originsSupported),
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
        inferOrigins: z
          .boolean()
          .optional()
          .describe(
            "[corroboration-kit 0.3+] Default true: pages of one site or repository, and hosts that share a " +
              "registered domain, count as one source. Pass false to count by page (spellings of one page still " +
              "merge, and declared `origin` / `derivedFrom` still apply).",
          ),
      },
    },
    ({ signals, coverage, inferOrigins }) => {
      try {
        const usesOrigins =
          inferOrigins !== undefined || signals.some((signal) => signal.origin !== undefined || signal.derivedFrom !== undefined);
        if (usesOrigins && !originsSupported) {
          // An older kit would ignore these and count every string as its own source: refuse instead.
          throw new Error(
            `\`origin\`, \`derivedFrom\` and \`inferOrigins\` need corroboration-kit ${ORIGINS_MIN_VERSION} or later; ` +
              `the installed version is ${installedKitVersion("corroboration-kit") ?? "unknown"}. Remove them, or upgrade the kit.`,
          );
        }
        const resolvedCoverage: Coverage =
          typeof coverage === "string"
            ? coverage
            : coverageOf(coverage.sampledUnits, coverage.totalUnits, coverage.hadStructuralReadAccess);
        // Built conditionally: the kit rejects an options object it does not recognize.
        const run = corroborate as unknown as CorroborateWithOptions;
        const result =
          inferOrigins !== undefined ? run(signals, resolvedCoverage, { inferOrigins }) : run(signals, resolvedCoverage);
        const merged = (result.groups ?? []).filter((group) => group.signals.length > 1).length;
        const mergedNote =
          merged > 0
            ? ` ${merged} source(s) combine several signals that were counted together (see \`groups\` for why).`
            : "";
        const summary =
          `Evidence direction: ${result.direction} -- verdict: ${result.verdict} (coverage: ${result.coverage}) -- ` +
          `${result.supports} supporting source(s), ${result.contradicts} contradicting source(s).${mergedNote}`;
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
