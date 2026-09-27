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
});

describe("check_provenance_claims (provenance-kit)", () => {
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
});

describe("corroborate_evidence (corroboration-kit)", () => {
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
});

describe("score_trust_identified / assess_anonymous_authenticity (trust-core)", () => {
  it("shrinks a thin-evidence score toward the prior", async () => {
    const result = await client.callTool({
      name: "score_trust_identified",
      arguments: {
        signals: [{ id: "s1", tier: "new", source: "imported", proof: "none", reputation: null, occurredAt: null, value: 95 }],
        asOf: "2026-01-01T00:00:00.000Z",
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
});

describe("append_audit_entry / verify_audit_chain (audit-chain-kit)", () => {
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
});

describe("scaffold tools (agent-receipt-kit, cost-governor-kit)", () => {
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
  });
});
