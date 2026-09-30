// End-to-end tests: a REAL MCP Client talking to a REAL McpServer built by
// createServer(), connected over a pair of linked in-memory transports (the
// SDK's own InMemoryTransport -- no stdio subprocess needed, but this is a
// genuine client/server protocol round trip, not a bare function call).
//
// Covers the acceptance bar from the task: listing tools, plus known-good
// and known-bad input for several of the wrapped kits, confirming each
// tool's verdict actually reflects what its underlying kit computes.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runInNewContext } from "node:vm";
import { classifyDocument } from "grounding-kit";
import { corroborate, type Signal } from "corroboration-kit";
import { anonymous } from "trust-core";
import { generateClaimsReport } from "claims-registry-kit";
import { withReserveConfirm } from "cost-governor-kit";
import { createServer } from "../src/server.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

let server: McpServer;
let client: Client;

beforeEach(async () => {
  server = createServer();
  client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
});

/**
 * Every jsonResult() response is [summary text block, JSON text block] --
 * parse the second block. `result` is typed `unknown` on purpose:
 * client.callTool()'s declared return type is a back-compat union that
 * includes a pre-2025 shape with no `content` field at all, which the real
 * (modern) server response never produces -- narrowing it here at runtime
 * is simpler than fighting that union in every test call site.
 */
function parseJson(result: unknown): any {
  const r = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  expect(r.isError).not.toBe(true);
  const block = r.content?.[1];
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("expected a second (JSON) text content block");
  }
  return JSON.parse(block.text);
}

function parseSummary(result: unknown): string {
  const r = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  expect(r.isError).not.toBe(true);
  const block = r.content?.[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("expected a first (summary) text content block");
  }
  return block.text;
}

describe("tool listing", () => {
  it("lists all 14 registered tools with the expected names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "append_audit_entry",
        "assess_anonymous_authenticity",
        "check_claims_registry",
        "check_grounding",
        "check_mutation_invariance",
        "check_payout_invariance",
        "check_provenance_claims",
        "compute_divergence",
        "corroborate_evidence",
        "grade_decision",
        "scaffold_agent_receipts",
        "scaffold_cost_governor",
        "score_trust_identified",
        "verify_audit_chain",
      ].sort(),
    );
    // Every tool must carry a real description (an agent decides whether to
    // call a tool from this text) and an input schema.
    for (const tool of tools) {
      expect(tool.description, `${tool.name} has a description`).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(40);
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

describe("check_grounding (grounding-kit)", () => {
  it("rejects text over the 2,000,000-character cap as an input error", async () => {
    const result = (await client.callTool({
      name: "check_grounding",
      arguments: { text: "a".repeat(2_000_001), evidence: {} },
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("describes a rejected paraphrase as a matcher result, without alleging fabrication", async () => {
    const text = "The bank approved the loan application [[cite:a]].";
    const evidence = { a: "The lender accepted the financing request." };
    const expected = classifyDocument(text, evidence);
    expect(expected.counts.invalid).toBe(1);
    const result = await client.callTool({ name: "check_grounding", arguments: { text, evidence } });
    expect(parseJson(result)).toEqual(expected);
    expect(parseSummary(result)).toContain("rejected by the default support matcher");
    expect(parseSummary(result)).toContain(`${expected.sentences.length} checked unit(s)`);
    expect(parseSummary(result)).not.toMatch(/forged|hallucinated/);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "check_grounding")?.description).not.toContain("i.e. a forged");
  });

  it.each([
    "[citation needed].",
    "The bridge was completed in 1932 [[cite:1]]. [TK].",
  ])("reports structural cleanliness and visible gaps for %s", async (text) => {
    const evidence = { "1": "Construction of the bridge finished in 1932." };
    const expected = classifyDocument(text, evidence);
    expect(expected.isClean).toBe(true);
    expect(expected.counts.placeholder).toBe(1);
    const result = await client.callTool({ name: "check_grounding", arguments: { text, evidence } });
    expect(parseJson(result)).toEqual(expected);
    const summary = parseSummary(result);
    expect(summary).toContain("Structurally clean:");
    expect(summary).toContain(`${expected.sentences.length} checked unit(s)`);
    expect(summary).toContain("1 placeholder(s)");
    expect(summary).toContain("does not verify truth or semantic support");
  });

  it("flags a forged / unsupported citation as invalid", async () => {
    const result = await client.callTool({
      name: "check_grounding",
      arguments: {
        text:
          "The bridge was completed in 1932 [[cite:1]]. It is the longest suspension bridge in the state [[cite:2]].",
        evidence: {
          "1": "Construction of the bridge finished in 1932.",
          // marker "2" is cited in the text but never appears here -> forged/invalid citation.
        },
      },
    });
    const data = parseJson(result);
    expect(data.isClean).toBe(false);
    expect(data.counts.invalid).toBeGreaterThanOrEqual(1);
    const invalidSentence = data.sentences.find((s: any) => s.status === "invalid");
    expect(invalidSentence).toBeTruthy();
    expect(invalidSentence.citedIds).toContain("2");
  });

  it("reports clean for a document whose citations are all backed by evidence", async () => {
    const result = await client.callTool({
      name: "check_grounding",
      arguments: {
        text: "The bridge was completed in 1932 [[cite:1]].",
        evidence: { "1": "Construction of the bridge finished in 1932." },
      },
    });
    const data = parseJson(result);
    expect(data.isClean).toBe(true);
    expect(data.counts.invalid).toBe(0);
    expect(data.counts.ungrounded).toBe(0);
  });
});

describe("check_payout_invariance (payout-invariance-kit)", () => {
  const candidates = [
    { id: "a", quality: 90, payout: 5 },
    { id: "b", quality: 70, payout: 50 },
    { id: "c", quality: 50, payout: 5 },
  ];

  it("flags a failure for a ranker that is genuinely biased by payout", async () => {
    const result = await client.callTool({
      name: "check_payout_invariance",
      arguments: {
        mode: "runtime",
        // Deliberately biased: sorts by payout, not quality.
        rankFnSource: "(candidates) => candidates.slice().sort((a, b) => b.payout - a.payout).map((c) => c.id)",
        baseInput: candidates,
        mutations: [
          {
            name: "zero out every payout",
            mutateSource: "(input) => input.map((c) => ({ ...c, payout: 0 }))",
          },
        ],
      },
    });
    const data = parseJson(result);
    expect(data.passed).toBe(false);
    expect(data.failures.length).toBeGreaterThanOrEqual(1);
    expect(data.failures[0].scenario).toBe("zero out every payout");
  });

  it("passes for a ranker that genuinely ignores payout", async () => {
    const result = await client.callTool({
      name: "check_payout_invariance",
      arguments: {
        mode: "runtime",
        rankFnSource: "(candidates) => candidates.slice().sort((a, b) => b.quality - a.quality).map((c) => c.id)",
        baseInput: candidates,
        mutations: [
          {
            name: "zero out every payout",
            mutateSource: "(input) => input.map((c) => ({ ...c, payout: 0 }))",
          },
          {
            name: "give the worst candidate the highest payout",
            mutateSource:
              "(input) => input.map((c) => (c.id === 'c' ? { ...c, payout: 9999 } : c))",
          },
        ],
      },
    });
    const data = parseJson(result);
    expect(data.passed).toBe(true);
    expect(data.failures.length).toBe(0);
    expect(data.vacuous.length).toBe(0);
  });

  it("static-imports mode flags a file that references a payout identifier", async () => {
    const result = await client.callTool({
      name: "check_payout_invariance",
      arguments: {
        mode: "static-imports",
        files: {
          "src/rank.ts": "export function rank(cs) { return cs.sort((a,b) => b.affiliateCommission - a.affiliateCommission); }",
        },
        payoutIdentifiers: ["affiliateCommission", "payout"],
      },
    });
    const data = parseJson(result);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].file).toBe("src/rank.ts");
  });

  it("runtime mode refuses an empty mutations array with a clear error, not a vacuous pass", async () => {
    const result = (await client.callTool({
      name: "check_payout_invariance",
      arguments: { mode: "runtime", rankFnSource: "(x) => x", baseInput: [], mutations: [] },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/non-empty `mutations`/);
  });

  it("runtime mode refuses a missing rankFnSource with a clear error", async () => {
    const result = (await client.callTool({
      name: "check_payout_invariance",
      arguments: { mode: "runtime", baseInput: [], mutations: [{ name: "n", mutateSource: "(x) => x" }] },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/requires `rankFnSource`/);
  });

  it("static-imports mode refuses an empty payoutIdentifiers array with a clear error", async () => {
    const result = (await client.callTool({
      name: "check_payout_invariance",
      arguments: { mode: "static-imports", files: { "a.ts": "" }, payoutIdentifiers: [] },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/non-empty `payoutIdentifiers`/);
  });

  it.each([
    [{}, ["payout"], "files is empty"],
    [[], ["payout"], "files is empty"],
    [{ "a.ts": "x" }, ["payout", "\u200b"], "payoutIdentifiers[1] is blank"],
  ])("static-imports mode reports an empty scope or blank identifier as a tool error, never CLEAN", async (files, payoutIdentifiers, message) => {
    const result = (await client.callTool({
      name: "check_payout_invariance",
      arguments: { mode: "static-imports", files, payoutIdentifiers },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(message);
  });

  it("static-imports mode refuses a missing files argument with a clear error", async () => {
    const result = (await client.callTool({
      name: "check_payout_invariance",
      arguments: { mode: "static-imports", payoutIdentifiers: ["payout"] },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/requires `files`/);
  });
});

describe("check_provenance_claims (provenance-kit)", () => {
  it("describes a clean result as no wording offenses, not as verified claims", async () => {
    const result = await client.callTool({
      name: "check_provenance_claims",
      arguments: { claims: [{ id: "c1", text: "Our tool summarizes public filings.", tier: "editorial" }] },
    });
    expect(parseJson(result)).toEqual([]);
    expect(parseSummary(result)).toBe(
      "CLEAN: 1 claim(s) checked; no wording offenses found under the configured rules (this does not verify the claims).",
    );
    const { tools } = await client.listTools();
    const description = tools.find((tool) => tool.name === "check_provenance_claims")?.description ?? "";
    expect(description).not.toMatch(/150|one incident|live site/);
    expect(description).toContain("inside the same clause");
    expect(description).toContain("em or en dash");
  });

  it("flags an unbacked '(verified)' claim", async () => {
    const result = await client.callTool({
      name: "check_provenance_claims",
      arguments: {
        claims: [
          {
            id: "claim-1",
            text: "Our data is (verified) accurate for every listing.",
            tier: "editorial",
          },
        ],
      },
    });
    const data = parseJson(result);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].reason).toBe("certainty_phrase_without_backing_tier");
    expect(data[0].phrase).toBe("(verified)");
  });

  it("passes a claim whose certainty language is backed by a verified tier + sourceRef", async () => {
    const result = await client.callTool({
      name: "check_provenance_claims",
      arguments: {
        claims: [
          {
            id: "claim-1",
            text: "Our data is (verified) accurate for every listing.",
            tier: "verified",
            sourceRef: "https://example.com/audit-report",
          },
        ],
      },
    });
    const data = parseJson(result);
    expect(data).toEqual([]);
  });
});

describe("check_mutation_invariance (mutation-invariance-kit)", () => {
  it("flags a scoring function that depends on a protected attribute it shouldn't", async () => {
    const result = await client.callTool({
      name: "check_mutation_invariance",
      arguments: {
        fnSource: "(applicant) => (applicant.name === 'Jamal Washington' ? 60 : 80)",
        baseInput: { name: "Emily Carter", income: 80000 },
        scenarios: [
          {
            name: "swap to a stereotypically Black-coded name",
            mutateSource: "(input) => ({ ...input, name: 'Jamal Washington' })",
            category: "protected-attribute",
          },
        ],
      },
    });
    const data = parseJson(result);
    expect(data.passed).toBe(false);
    expect(data.failures.length).toBe(1);
    expect(data.failures[0].category).toBe("protected-attribute");
  });

  it("passes a scoring function that genuinely ignores the mutated field", async () => {
    const result = await client.callTool({
      name: "check_mutation_invariance",
      arguments: {
        fnSource: "(applicant) => applicant.income > 50000",
        baseInput: { name: "Emily Carter", income: 80000 },
        scenarios: [
          {
            name: "swap to a different name",
            mutateSource: "(input) => ({ ...input, name: 'Jamal Washington' })",
            category: "protected-attribute",
          },
        ],
      },
    });
    const data = parseJson(result);
    expect(data.passed).toBe(true);
    expect(data.failures.length).toBe(0);
    expect(data.vacuous.length).toBe(0);
  });

  it("flags a vacuous scenario (mutate didn't actually change the input) instead of a silent pass", async () => {
    const result = await client.callTool({
      name: "check_mutation_invariance",
      arguments: {
        fnSource: "(applicant) => applicant.income",
        baseInput: { name: "Emily Carter", income: 80000 },
        scenarios: [{ name: "no-op mutation", mutateSource: "(input) => ({ ...input })" }],
      },
    });
    const data = parseJson(result);
    expect(data.vacuous).toEqual(["no-op mutation"]);
  });
});

describe("corroborate_evidence (corroboration-kit)", () => {
  it("counts normalized URL identities once and documents that normalization", async () => {
    const signals: Signal[] = ["https://EXAMPLE.com/doc#s1", "https://example.com:443/doc#s2"].map((source) => ({
      source, kind: "structural", vote: "supports", detail: "Synthetic observation",
    }));
    const expected = corroborate(signals, "strong");
    expect(expected.supports).toBe(1);
    expect(expected.verdict).toBe("likely");
    const result = await client.callTool({ name: "corroborate_evidence", arguments: { signals, coverage: "strong" } });
    expect(parseJson(result)).toEqual(expected);
    expect(parseSummary(result)).toContain("1 supporting source(s)");
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "corroborate_evidence")?.description).toContain("normalized source identities");
  });

  it.each([
    ["supports", "strong", ["supports", "supports"], "confirmed"],
    ["contradicts", "strong", ["contradicts", "contradicts"], "confirmed"],
    ["mixed", "strong", ["supports", "contradicts"], "mixed"],
    ["none", "strong", [], "not-found"],
    ["none", "thin", [], "inconclusive"],
    ["contradicts", "thin", ["contradicts", "contradicts"], "likely"],
    ["supports", "thin", ["supports", "supports"], "likely"],
    ["contradicts", "partial", ["contradicts", "contradicts"], "confirmed"],
  ] as const)("leads with %s direction under %s coverage while retaining the raw kit result", async (direction, coverage, votes, verdict) => {
    const signals: Signal[] = votes.map((vote, index) => ({
      source: `artifact-${index}`,
      kind: "structural",
      vote,
      detail: "Synthetic observation",
    }));
    const expected = corroborate(signals, coverage);
    expect(expected.verdict).toBe(verdict);
    const result = await client.callTool({ name: "corroborate_evidence", arguments: { signals, coverage } });
    expect(parseJson(result)).toEqual(expected);
    expect(parseSummary(result)).toMatch(new RegExp(`^Evidence direction: ${direction} -- verdict: ${verdict}`));
  });

  it("describes confirmed contradiction as a possible result", async () => {
    const { tools } = await client.listTools();
    const description = tools.find((tool) => tool.name === "corroborate_evidence")?.description;
    expect(description).toContain("supporting OR contradicting");
    expect(description).toContain("Independence is not verified");
  });

  it("requires a non-textual signal to reach 'confirmed'", async () => {
    const textOnly = await client.callTool({
      name: "corroborate_evidence",
      arguments: {
        signals: [
          { source: "doc-a", kind: "textual", vote: "supports", detail: "mentions it" },
          { source: "doc-b", kind: "textual", vote: "supports", detail: "also mentions it" },
        ],
        coverage: "strong",
      },
    });
    expect(parseJson(textOnly).verdict).toBe("likely");

    const withStructural = await client.callTool({
      name: "corroborate_evidence",
      arguments: {
        signals: [
          { source: "doc-a", kind: "textual", vote: "supports", detail: "mentions it" },
          { source: "api-b", kind: "structural", vote: "supports", detail: "schema confirms it" },
        ],
        coverage: "strong",
      },
    });
    expect(parseJson(withStructural).verdict).toBe("confirmed");
  });

  it.each(["   ", "\u200b", "\u2066\u2069", "\u2800"])("rejects a source that shows nothing (%j) as an input error", async (source) => {
    const result = (await client.callTool({
      name: "corroborate_evidence",
      arguments: { signals: [{ source, kind: "structural", vote: "supports", detail: "x" }], coverage: "strong" },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("source must contain a visible character");
  });

  it("takes the direction from the kit, so a confirmed contradiction leads with 'contradicts'", async () => {
    const signals: Signal[] = [
      { source: "doc-a", kind: "structural", vote: "contradicts", detail: "schema says otherwise" },
      { source: "doc-b", kind: "textual", vote: "contradicts", detail: "text says otherwise" },
    ];
    const expected = corroborate(signals, "strong");
    expect(expected).toMatchObject({ direction: "contradicts", verdict: "confirmed" });
    const result = await client.callTool({ name: "corroborate_evidence", arguments: { signals, coverage: "strong" } });
    expect(parseJson(result).direction).toBe("contradicts");
    expect(parseSummary(result)).toMatch(/^Evidence direction: contradicts -- verdict: confirmed/);
  });

  it("reports a clear tool error (not a wrong verdict) for an impossible sample size", async () => {
    const result = await client.callTool({
      name: "corroborate_evidence",
      arguments: {
        signals: [{ source: "doc-a", kind: "textual", vote: "supports", detail: "mentions it" }],
        coverage: { sampledUnits: 50, totalUnits: 10, hadStructuralReadAccess: false },
      },
    });
    const r = result as { isError?: boolean; content?: { type: string; text?: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content?.[0]?.text).toMatch(/cannot exceed totalUnits/);
  });
});

describe("score_trust_identified / assess_anonymous_authenticity (trust-core)", () => {
  it("labels an empty anonymous corpus as insufficient evidence with no score, preserving the kit payload", async () => {
    const now = "2026-01-02T00:00:00.000Z";
    const expected = anonymous.assessAuthenticity([], anonymous.resolveAnonymousConfig(), { now });
    expect(expected.trustScore).toBeNull();
    expect(expected.confidence.level).toBe("insufficient");
    const result = await client.callTool({ name: "assess_anonymous_authenticity", arguments: { signals: [], now } });
    expect(parseJson(result)).toEqual(expected);
    const summary = parseSummary(result);
    expect(summary).toContain("No evidence-backed assessment");
    expect(summary).toContain(expected.confidence.reason!);
    expect(summary).toContain("0 eligible of 0 submitted signal(s)");
    expect(summary).not.toMatch(/trust score: \d+\/100/i);
    expect(summary).not.toContain("null/100");
  });

  it("reports source types without claiming their independence or changing the kit payload", async () => {
    const signals = [
      { id: "r1", source: "marketplace", sentiment: 0.9, confidence: 1, publishedAt: "2026-01-01" },
      { id: "r2", source: "marketplace", sentiment: 0.8, confidence: 1, publishedAt: "2026-01-01" },
    ];
    const now = "2026-01-02T00:00:00.000Z";
    const expected = anonymous.assessAuthenticity(signals, anonymous.resolveAnonymousConfig(), { now });
    const result = await client.callTool({ name: "assess_anonymous_authenticity", arguments: { signals, now } });
    expect(parseJson(result)).toEqual(expected);
    expect(parseSummary(result)).toContain("1 distinct source type(s)");
    expect(parseSummary(result)).toContain("Independence is not verified");
    expect(parseSummary(result)).not.toMatch(/independent source/);
  });

  it("shrinks a thin-evidence score toward the prior", async () => {
    const result = await client.callTool({
      name: "score_trust_identified",
      arguments: {
        signals: [{ id: "s1", tier: "new", source: "imported", proof: "none", reputation: null, occurredAt: null, value: 95 }],
        now: "2026-01-01T00:00:00.000Z",
        prior: 50,
      },
    });
    const data = parseJson(result);
    expect(data.score).toBeGreaterThan(50);
    expect(data.score).toBeLessThan(95);
    expect(data.confidence.level).toBe("thin");
  });

  it("penalizes uniform, single-source anonymous sentiment as likely astroturf", async () => {
    const result = await client.callTool({
      name: "assess_anonymous_authenticity",
      arguments: {
        signals: [
          { id: "r1", source: "marketplace", sentiment: 0.99, confidence: 1, publishedAt: "2026-01-01" },
          { id: "r2", source: "marketplace", sentiment: 0.98, confidence: 1, publishedAt: "2026-01-01" },
          { id: "r3", source: "marketplace", sentiment: 0.97, confidence: 1, publishedAt: "2026-01-01" },
        ],
        now: "2026-01-02T00:00:00.000Z",
      },
    });
    const data = parseJson(result);
    expect(data.flags.lowSourceCount).toBe(true);
    expect(data.flags.uniformSentiment).toBe(true);
  });

  const anonSignal = (id: string, confidence: number) => ({
    id, source: "marketplace", sentiment: 0.9, confidence, publishedAt: "2026-01-01",
  });
  const identSignal = (id: string, tier: string) => ({
    id, tier, source: "direct", proof: "verified", reputation: null, occurredAt: "2026-01-01", value: 90,
  });
  const allTierWeights = { new: 0.4, standard: 0, verified: 1.0, expert: 1.3 };
  const trustNow = "2026-01-02T00:00:00.000Z";

  it("treats anonymous signals with zero source weight as insufficient evidence", async () => {
    const result = await client.callTool({
      name: "assess_anonymous_authenticity",
      arguments: { signals: [anonSignal("r1", 1)], config: { sourceWeights: { marketplace: 0 } }, now: trustNow },
    });
    const data = parseJson(result);
    expect(data).toMatchObject({ signalCount: 1, eligibleSignalCount: 0, sourceCount: 0, trustScore: null });
    expect(data.confidence.level).toBe("insufficient");
    expect(parseSummary(result)).toContain("No evidence-backed assessment");
    expect(parseSummary(result)).toContain("0 eligible of 1 submitted signal(s)");
  });

  it("scores only the eligible anonymous signals and forwards the kit explanation", async () => {
    const result = await client.callTool({
      name: "assess_anonymous_authenticity",
      arguments: { signals: [anonSignal("r1", 1), anonSignal("r2", 0)], now: trustNow },
    });
    const data = parseJson(result);
    expect(data).toMatchObject({ signalCount: 2, eligibleSignalCount: 1, sourceCount: 1 });
    expect(data.confidence.level).toBe("thin");
    expect(Number.isFinite(data.trustScore)).toBe(true);
    const summary = parseSummary(result);
    expect(summary).toContain(`Heuristic trust score: ${data.trustScore}/100`);
    expect(summary).toContain("1 eligible of 2 submitted signal(s)");
    expect(summary).toContain(data.explanation);
    expect(summary).toContain("Independence is not verified");
  });

  it("reports an empty identified entity as the prior with insufficient confidence, not a measured score", async () => {
    const result = await client.callTool({
      name: "score_trust_identified",
      arguments: { signals: [], now: trustNow, prior: 60 },
    });
    const data = parseJson(result);
    expect(data).toMatchObject({ score: 60, raw: null, nEff: 0, signalCount: 0, eligibleSignalCount: 0 });
    expect(data.confidence.level).toBe("insufficient");
    const summary = parseSummary(result);
    expect(summary).toMatch(/^Prior only: 60\.0\/100 is the supplied prior, not a measured score\./);
    expect(summary).toContain(data.confidence.reason);
    expect(summary).toContain("0 eligible of 0 submitted signal(s)");
    expect(summary).not.toMatch(/^Score:/);
  });

  it("treats identified signals whose weight is zero as insufficient evidence", async () => {
    const result = await client.callTool({
      name: "score_trust_identified",
      arguments: { signals: [identSignal("a", "standard")], config: { tierWeights: allTierWeights }, now: trustNow, prior: 60 },
    });
    const data = parseJson(result);
    expect(data).toMatchObject({ score: 60, raw: null, nEff: 0, signalCount: 1, eligibleSignalCount: 0 });
    expect(data.confidence.level).toBe("insufficient");
    expect(parseSummary(result)).toContain("Prior only");
    expect(parseSummary(result)).toContain("0 eligible of 1 submitted signal(s)");
  });

  it("rejects a derived overflow as a tool error instead of clamping the score to 100", async () => {
    const result = (await client.callTool({
      name: "score_trust_identified",
      arguments: { signals: [identSignal("a", "verified")], now: trustNow, prior: 60, dial: 1e308 },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("is not a finite number");
  });

  it("gives an anonymous signal with an unlisted source type no weight", async () => {
    const result = await client.callTool({
      name: "assess_anonymous_authenticity",
      arguments: { signals: [{ ...anonSignal("r1", 1), source: "not-in-the-table" }], now: trustNow },
    });
    const data = parseJson(result);
    expect(data).toMatchObject({ signalCount: 1, eligibleSignalCount: 0, trustScore: null });
    expect(parseSummary(result)).toContain("No evidence-backed assessment");
  });

  it("scores identified evidence from the eligible signals only when weights are mixed", async () => {
    const result = await client.callTool({
      name: "score_trust_identified",
      arguments: {
        signals: [identSignal("a", "verified"), identSignal("b", "standard")],
        config: { tierWeights: allTierWeights },
        now: trustNow,
        prior: 60,
      },
    });
    const data = parseJson(result);
    expect(data).toMatchObject({ signalCount: 2, eligibleSignalCount: 1 });
    expect(data.nEff).toBeGreaterThan(0);
    expect(data.score).toBeGreaterThan(60);
    expect(data.score).toBeLessThan(90);
    expect(parseSummary(result)).toMatch(/^Score: /);
    expect(parseSummary(result)).toContain("1 eligible of 2 submitted signal(s)");
  });
});

describe("check_claims_registry (claims-registry-kit)", () => {
  it("buckets current, stale, and unverified claims correctly", async () => {
    const result = await client.callTool({
      name: "check_claims_registry",
      arguments: {
        claims: [
          { id: "fresh", text: "We support SSO.", evidenceRef: "docs/sso.md", verifiedAt: "2026-07-30" },
          { id: "old", text: "We support SAML.", evidenceRef: "docs/saml.md", verifiedAt: "2020-01-01" },
          { id: "none", text: "We are SOC2 certified.", evidenceRef: "", verifiedAt: "2026-07-30" },
        ],
        maxAgeDays: 90,
        now: "2026-08-02T00:00:00.000Z",
      },
    });
    const data = parseJson(result);
    expect(data.counts).toEqual({ current: 1, stale: 1, unverified: 1, total: 3 });
    expect(data.unverified[0].id).toBe("none");
    expect(data.stale[0].id).toBe("old");
  });

  it("accepts maxAgeDays: 0 (a 'must be verified today' policy), not rejected as non-positive", async () => {
    const result = await client.callTool({
      name: "check_claims_registry",
      arguments: {
        claims: [{ id: "a", text: "We support SSO.", evidenceRef: "docs/sso.md", verifiedAt: "2026-08-02" }],
        maxAgeDays: 0,
        now: "2026-08-02T00:00:00.000Z",
      },
    });
    const data = parseJson(result);
    expect(data.counts.total).toBe(1);
  });

  it("rejects an unparseable `now` with a clear error instead of an invalid-date report", async () => {
    const result = (await client.callTool({
      name: "check_claims_registry",
      arguments: {
        claims: [{ id: "a", text: "We support SSO.", evidenceRef: "docs/sso.md", verifiedAt: "2026-08-02" }],
        maxAgeDays: 90,
        now: "not-a-real-date",
      },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/must be 'YYYY-MM-DD' \(UTC midnight\) or a timestamp with an explicit zone/);
  });

  it.each(["2026-08-02T12:00:00", "2026-02-30", "2026-08-02T24:00:00Z"])(
    "rejects `now` = %s instead of guessing local time or rolling the date forward",
    async (now) => {
      const result = (await client.callTool({
        name: "check_claims_registry",
        arguments: {
          claims: [{ id: "a", text: "We support SSO.", evidenceRef: "docs/sso.md", verifiedAt: "2026-08-01" }],
          maxAgeDays: 90,
          now,
        },
      })) as { isError?: boolean; content?: { text?: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain("explicit zone");
    },
  );

  it("reads a bare-date or zoned `now` as the same instant the kit would", async () => {
    const claims = [{ id: "a", text: "We support SSO.", evidenceRef: "docs/sso.md", verifiedAt: "2026-05-04" }];
    const expected = generateClaimsReport(claims, 90, new Date("2026-08-02T00:00:00.000Z"));
    for (const now of ["2026-08-02", "2026-08-02T01:00:00+01:00", "2026-08-02T00:00:00Z"]) {
      const result = await client.callTool({ name: "check_claims_registry", arguments: { claims, maxAgeDays: 90, now } });
      expect(parseJson(result)).toEqual(JSON.parse(JSON.stringify(expected)));
    }
  });

  it("rejects a claim id that shows nothing as a tool error", async () => {
    const result = (await client.callTool({
      name: "check_claims_registry",
      arguments: {
        claims: [{ id: "\u200b", text: "We support SSO.", evidenceRef: "docs/sso.md", verifiedAt: "2026-08-01" }],
        maxAgeDays: 90,
        now: "2026-08-02",
      },
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});

describe("append_audit_entry / verify_audit_chain (audit-chain-kit)", () => {
  it.each(["", " \t\n", "\u200b", "\u2066", "\u034f", " \u115f "])("rejects a blank or invisible-only anchor hash %j as an input error", async (entryHash) => {
    const result = await client.callTool({
      name: "verify_audit_chain",
      arguments: { chain: [], anchor: { index: 0, entryHash } },
    });
    const r = result as { isError?: boolean; content?: { text?: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content?.[0]?.text).toMatch(/anchor|entryHash/);
    const appended = parseJson(await client.callTool({
      name: "append_audit_entry", arguments: { chain: [], payload: { event: "synthetic recovery" } },
    }));
    const recovered = parseJson(await client.callTool({
      name: "verify_audit_chain", arguments: { chain: appended.chain, anchor: { index: 0, entryHash: appended.newEntry.entryHash } },
    }));
    expect(recovered.valid).toBe(true);
  });

  it("builds a chain and confirms tampering is detected", async () => {
    const first = parseJson(
      await client.callTool({ name: "append_audit_entry", arguments: { chain: [], payload: { event: "created" } } }),
    );
    const second = parseJson(
      await client.callTool({
        name: "append_audit_entry",
        arguments: { chain: first.chain, payload: { event: "approved" } },
      }),
    );
    expect(second.chain.length).toBe(2);

    const validCheck = parseJson(
      await client.callTool({ name: "verify_audit_chain", arguments: { chain: second.chain } }),
    );
    expect(validCheck.valid).toBe(true);

    const tampered = second.chain.map((e: any, i: number) => (i === 0 ? { ...e, payload: { event: "TAMPERED" } } : e));
    const invalidCheck = parseJson(
      await client.callTool({ name: "verify_audit_chain", arguments: { chain: tampered } }),
    );
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.brokenAtIndex).toBe(0);
  });

  it("expectedMinLength alone does not catch truncate-and-re-append, but anchor does", async () => {
    // Build a genuine 2-entry chain and save an anchor to entry 0 -- a
    // checkpoint from "somewhere the writer cannot edit" in the real world.
    const first = parseJson(
      await client.callTool({ name: "append_audit_entry", arguments: { chain: [], payload: { event: "created" } } }),
    );
    const genuineSecond = parseJson(
      await client.callTool({
        name: "append_audit_entry",
        arguments: { chain: first.chain, payload: { event: "approved" } },
      }),
    );
    const anchor = { index: 0, entryHash: first.chain[0].entryHash };

    // Attack: delete entry 0 and re-append a FORGED entry, then re-append a
    // new entry 1 on top of it, so the chain is self-consistent and back to
    // length 2 -- same length, different history.
    const forgedFirst = parseJson(
      await client.callTool({ name: "append_audit_entry", arguments: { chain: [], payload: { event: "FORGED" } } }),
    );
    const relinkedSecond = parseJson(
      await client.callTool({
        name: "append_audit_entry",
        arguments: { chain: forgedFirst.chain, payload: genuineSecond.chain[1].payload },
      }),
    );

    const withoutAnchor = parseJson(
      await client.callTool({
        name: "verify_audit_chain",
        arguments: { chain: relinkedSecond.chain, expectedMinLength: 2 },
      }),
    );
    expect(withoutAnchor.valid).toBe(true); // the false negative expectedMinLength's own docs warn about

    const withAnchor = parseJson(
      await client.callTool({
        name: "verify_audit_chain",
        arguments: { chain: relinkedSecond.chain, anchor },
      }),
    );
    expect(withAnchor.valid).toBe(false);
    expect(withAnchor.brokenAtIndex).toBe(0);
  });
});

describe("grade_decision (advice-ledger-kit)", () => {
  const recommendation = {
    id: "rec-1",
    subjectId: "server-1",
    checkKey: "disk-space",
    proposedAt: "2026-01-01T00:00:00Z",
  };
  const decision = { recommendationId: "rec-1", status: "adopted", decidedAt: "2026-01-10T00:00:00Z" };

  it.each(["2026-01-10T00:00:00", "2026-01-10T00:00Z", "2025-02-29"])(
    "rejects decidedAt = %s as a tool error instead of guessing",
    async (decidedAt) => {
      const result = (await client.callTool({
        name: "grade_decision",
        arguments: { decision: { ...decision, decidedAt }, recommendation, observations: [] },
      })) as { isError?: boolean; content?: { text?: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain(`decision.decidedAt must be a`);
      expect(result.content?.[0]?.text).toContain(JSON.stringify(decidedAt));
    },
  );

  it.each([
    ["recommendation.subjectId", { recommendation: { ...recommendation, subjectId: "" }, decision }],
    ["decision.recommendationId", { recommendation, decision: { ...decision, recommendationId: "" } }],
  ])("rejects a blank %s as a tool error (it used to be a refused grade)", async (field, args) => {
    const result = (await client.callTool({
      name: "grade_decision",
      arguments: { ...args, observations: [] },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(`${field} must not be blank`);
  });

  it("rejects a recommendation id that shows nothing as a tool error", async () => {
    const result = (await client.callTool({
      name: "grade_decision",
      arguments: {
        decision: { ...decision, recommendationId: "\u200b" },
        recommendation: { ...recommendation, id: "\u200b" },
        observations: [],
      },
    })) as { isError?: boolean; content?: { text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("must not be blank");
  });

  it("grades 'holding' when the exposed post-decision window clears the refute bar clean", async () => {
    const observations = [
      // Baseline (before decidedAt): 4 observations, 2 bad -- clears minBaselineObservations (3)
      // and minBaselineBadObservations (1), so the "problem existed before" floor is met.
      { subjectId: "server-1", checkKey: "disk-space", state: "bad", observedAt: "2026-01-02T00:00:00Z" },
      { subjectId: "server-1", checkKey: "disk-space", state: "bad", observedAt: "2026-01-04T00:00:00Z" },
      { subjectId: "server-1", checkKey: "disk-space", state: "good", observedAt: "2026-01-06T00:00:00Z" },
      { subjectId: "server-1", checkKey: "disk-space", state: "good", observedAt: "2026-01-08T00:00:00Z" },
      // Result (after decidedAt, exposed): 4 observations, 0 bad -- below the default refuteThreshold (2).
      { subjectId: "server-1", checkKey: "disk-space", state: "good", observedAt: "2026-01-11T00:00:00Z", exposed: true },
      { subjectId: "server-1", checkKey: "disk-space", state: "good", observedAt: "2026-01-13T00:00:00Z", exposed: true },
      { subjectId: "server-1", checkKey: "disk-space", state: "good", observedAt: "2026-01-15T00:00:00Z", exposed: true },
      { subjectId: "server-1", checkKey: "disk-space", state: "good", observedAt: "2026-01-17T00:00:00Z", exposed: true },
    ];
    const result = await client.callTool({ name: "grade_decision", arguments: { decision, recommendation, observations } });
    const data = parseJson(result);
    expect(data.verdict).toBe("holding");
    expect(data.refusalCodes).toEqual([]);
    expect(data.baseline).toEqual({ observations: 4, bad: 2, good: 2, badRate: 0.5 });
    expect(data.result).toEqual({ observations: 4, bad: 0, good: 4, badRate: 0 });
  });

  it("grades 'not-holding' when the exposed bad rate exceeds the baseline's, even below refuteThreshold", async () => {
    const rateRecommendation = { id: "rec-3", subjectId: "server-3", checkKey: "disk-space", proposedAt: "2026-01-01T00:00:00Z" };
    const rateDecision = { recommendationId: "rec-3", status: "adopted", decidedAt: "2026-01-10T00:00:00Z" };
    const observations = [
      // Baseline (before decidedAt): 10 observations, 1 bad (rate 0.1) -- clears every baseline floor.
      { subjectId: "server-3", checkKey: "disk-space", state: "bad", observedAt: "2026-01-02T00:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T01:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T02:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T03:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T04:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T05:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T06:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T07:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T08:00:00Z" },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-02T09:00:00Z" },
      // Result (after decidedAt, exposed): 3 observations, 1 bad (rate 0.333) -- below the default
      // refuteThreshold (2) on count alone, but its rate (0.333) is higher than the baseline's (0.1).
      { subjectId: "server-3", checkKey: "disk-space", state: "bad", observedAt: "2026-01-11T00:00:00Z", exposed: true },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-12T00:00:00Z", exposed: true },
      { subjectId: "server-3", checkKey: "disk-space", state: "good", observedAt: "2026-01-13T00:00:00Z", exposed: true },
    ];
    const result = await client.callTool({
      name: "grade_decision",
      arguments: { decision: rateDecision, recommendation: rateRecommendation, observations },
    });
    const data = parseJson(result);
    expect(data.baseline).toEqual({ observations: 10, bad: 1, good: 9, badRate: 0.1 });
    expect(data.result).toEqual({ observations: 3, bad: 1, good: 2, badRate: 0.333 });
    // Count alone (1 bad, below refuteThreshold 2) would say 'holding' under the old rule --
    // the rate check is what makes this 'not-holding'.
    expect(data.verdict).toBe("not-holding");
    expect(data.refusalCodes).toEqual([]);
  });

  it("refuses to grade a decision with a too-thin, all-good ledger and names the specific floors missed", async () => {
    const thinRecommendation = { id: "rec-2", subjectId: "server-2", checkKey: "cpu-load", proposedAt: "2026-01-01T00:00:00Z" };
    const thinDecision = { recommendationId: "rec-2", status: "adopted", decidedAt: "2026-01-10T00:00:00Z" };
    const observations = [{ subjectId: "server-2", checkKey: "cpu-load", state: "good", observedAt: "2026-01-05T00:00:00Z" }];
    const result = await client.callTool({
      name: "grade_decision",
      arguments: { decision: thinDecision, recommendation: thinRecommendation, observations },
    });
    const data = parseJson(result);
    expect(data.verdict).toBe("refused");
    expect(data.refusalCodes.sort()).toEqual(
      ["baseline_below_minimum", "baseline_lacks_negative_signal", "result_below_minimum", "exposed_result_below_minimum"].sort(),
    );
  });
});

describe("compute_divergence (advice-ledger-kit)", () => {
  // 8 agreements + 4 divergent pairs (rate 4/12 = 0.333, well above the default 0.05 floor);
  // of the 4 divergent pairs, 3 have a laterOutcome (meets the default minResolvedDivergent of
  // 3): engine right twice, human right once, nothing left unaccounted for.
  const pairs = [
    { engineJudgment: "approve", humanJudgment: "approve" },
    { engineJudgment: "approve", humanJudgment: "approve" },
    { engineJudgment: "approve", humanJudgment: "approve" },
    { engineJudgment: "approve", humanJudgment: "approve" },
    { engineJudgment: "reject", humanJudgment: "reject" },
    { engineJudgment: "reject", humanJudgment: "reject" },
    { engineJudgment: "reject", humanJudgment: "reject" },
    { engineJudgment: "reject", humanJudgment: "reject" },
    { engineJudgment: "approve", humanJudgment: "reject", laterOutcome: "approve" }, // engine right
    { engineJudgment: "approve", humanJudgment: "reject", laterOutcome: "approve" }, // engine right
    { engineJudgment: "reject", humanJudgment: "approve", laterOutcome: "approve" }, // human right
    { engineJudgment: "approve", humanJudgment: "reject" }, // unresolved -- no laterOutcome yet
  ];

  it("reports divergence and calibration as separate, unblended engine/human hit counts", async () => {
    const result = await client.callTool({ name: "compute_divergence", arguments: { pairs } });
    const data = parseJson(result);
    expect(data.overall.status).toBe("reportable");
    expect(data.overall.comparablePairs).toBe(12);
    expect(data.overall.divergentCount).toBe(4);
    expect(data.overall.calibration.status).toBe("reportable");
    expect(data.overall.calibration.resolvedDivergent).toBe(3);
    expect(data.overall.calibration.engineRight).toBe(2);
    expect(data.overall.calibration.humanRight).toBe(1);
    expect(data.overall.calibration.neitherRight).toBe(0);
    expect(data.groups).toEqual([]);
  });

  it("buckets by a custom groupBySource function built from JS source", async () => {
    const groupedPairs = pairs.map((p, i) => ({ ...p, group: i < 6 ? "batch-a" : "batch-b" }));
    const result = await client.callTool({
      name: "compute_divergence",
      arguments: {
        pairs: groupedPairs,
        config: { groupBySource: "(pair) => pair.group === 'batch-a' ? 'A' : 'B'" },
      },
    });
    const data = parseJson(result);
    const groupKeys = data.groups.map((g: any) => g.group).sort();
    expect(groupKeys).toEqual(["A", "B"]);
  });

  it("shows the required counts when calibration is withheld", async () => {
    const unresolved = pairs.map(({ engineJudgment, humanJudgment }) => ({ engineJudgment, humanJudgment }));
    const result = await client.callTool({ name: "compute_divergence", arguments: { pairs: unresolved } });
    const data = parseJson(result);
    expect(data.overall.calibration.status).not.toBe("reportable");
    expect(parseSummary(result)).toContain("0 of 4 disagreements have a later outcome (3 required)");
    expect(parseSummary(result)).toContain("they do not show causal benefit or general accuracy");
  });
});

describe("scaffold tools (agent-receipt-kit, cost-governor-kit)", () => {
  it.each([
    { name: "undefined", commitError: undefined },
    { name: "null", commitError: null },
    { name: "false", commitError: false },
    { name: "zero", commitError: 0 },
    { name: "empty string", commitError: "" },
    { name: "NaN", commitError: NaN },
  ])("the generated cost guard recognizes a commit rejection of $name", async ({ commitError }) => {
    const scaffold = parseJson(await client.callTool({
      name: "scaffold_cost_governor",
      arguments: { includeWorkedExample: false },
    }));
    const snippet: string = scaffold.starterSnippet;
    const guard = snippet.match(/if \((.+)\) \{\n {2}\/\/ The call succeeded/);
    if (!guard?.[1]) throw new Error("starter snippet has no post-call commit failure guard");
    const rejectCommit = async (failure: unknown): Promise<void> => { throw failure; };
    const result = await withReserveConfirm({
      checkUnderLimit: () => Promise.resolve(true),
      commitUsage: () => rejectCommit(commitError),
    }, "synthetic-key", 1, () => Promise.resolve("synthetic successful call"));
    expect(result.allowed).toBe(true);
    expect(result.result).toBe("synthetic successful call");
    if (!result.allowed) throw new Error("synthetic ledger unexpectedly rejected the call");
    expect(Object.hasOwn(result, "commitError")).toBe(true);
    expect(result.commitError).toBe(commitError);
    // Execute only the generated guard expression, never the DB/provider starter code.
    const recognized: unknown = runInNewContext(guard[1], { result }, { timeout: 100 });
    expect(recognized).toBe(true);
    const success = await withReserveConfirm({
      checkUnderLimit: () => Promise.resolve(true),
      commitUsage: () => Promise.resolve(),
    }, "synthetic-key", 1, () => Promise.resolve("synthetic successful call"));
    const falselyReported: unknown = runInNewContext(guard[1], { result: success }, { timeout: 100 });
    expect(falselyReported).toBe(false);
  });

  it("scaffold_agent_receipts returns guidance plus a live accepted/rejected worked example", async () => {
    const result = await client.callTool({ name: "scaffold_agent_receipts", arguments: {} });
    const data = parseJson(result);
    expect(data.kit).toBe("agent-receipt-kit");
    expect(data.starterSnippet).toContain("issuePacket");
    expect(data.workedExample.acceptedExample.result.accepted).toBe(true);
    expect(data.workedExample.rejectedExample.result.accepted).toBe(false);
    expect(data.workedExample.rejectedExample.result.unauthorizedActions).toContain("deploy-to-prod");
  });

  it("scaffold_cost_governor returns guidance plus a live pre-call-ceiling and reserve/confirm example", async () => {
    const result = await client.callTool({ name: "scaffold_cost_governor", arguments: {} });
    const data = parseJson(result);
    expect(data.kit).toBe("cost-governor-kit");
    expect(data.workedExample.preCallCeiling.allowedExample.allowed).toBe(true);
    expect(data.workedExample.preCallCeiling.blockedExample.allowed).toBe(false);
    expect(data.workedExample.reserveConfirm.firstCallResult.allowed).toBe(true);
    expect(data.workedExample.reserveConfirm.thirdCallResult.allowed).toBe(false);
    // A commit that fails after a successful call keeps the result instead of discarding it.
    const commitFailure = data.workedExample.reserveConfirm.commitFailsAfterSuccessfulCallResult;
    expect(commitFailure.allowed).toBe(true);
    expect(commitFailure.result).toBe("call ok");
    expect(commitFailure.commitError.message).toMatch(/commitUsage always fails/);
    // A caller-supplied cacheReadPerMillion replaces the fixed 0.1x ratio for that call.
    const sampleCostUsd: number = data.workedExample.pricing.sampleCostUsd;
    const sampleCostUsdWithCacheReadOverride: number = data.workedExample.pricing.sampleCostUsdWithCacheReadOverride;
    expect(sampleCostUsdWithCacheReadOverride).toBeLessThan(sampleCostUsd);
  });
});
