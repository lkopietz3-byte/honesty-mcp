// Kit-version compatibility. This server accepts two release lines of several
// wrapped kits (the 0.2 line it was built on, and the 0.3 line with the
// integrated fixes; claims-registry-kit 0.3 and 0.4). Each test below runs the
// branch that matches whatever is installed, so the whole file is meant to be
// run in both installs: `npm ci` (registry kits) and again after installing the
// newer kit tarballs. A test that needs a newer kit is skipped, not weakened,
// when the older one is installed.
//
// What is checked here:
//   - the version helper itself,
//   - every new input is passed to the kit when the kit supports it, and is
//     refused with a clear error (never silently ignored) when it does not,
//   - descriptions say what the installed kit really does,
//   - the wrapper's own summaries (empty audit chain, default phrase list).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { corroborate, type Coverage } from "corroboration-kit";
import { anonymous } from "trust-core";
import { assertNoPayoutImports } from "payout-invariance-kit";
import { createServer } from "../src/server.js";
import { installedKitVersion, kitAtLeast, parseVersion, versionAtLeast } from "../src/lib/kitVersion.js";

let server: McpServer;
let client: Client;

beforeEach(async () => {
  server = createServer();
  client = new Client({ name: "compat-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
});

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function summaryOf(result: ToolResult): string {
  return result.content?.[0]?.text ?? "";
}

function jsonOf(result: ToolResult): any {
  expect(result.isError, summaryOf(result)).not.toBe(true);
  return JSON.parse(result.content?.[1]?.text ?? "null");
}

async function descriptionOf(tool: string): Promise<string> {
  const { tools } = await client.listTools();
  return tools.find((t) => t.name === tool)?.description ?? "";
}

const NEW_CORROBORATION = kitAtLeast("corroboration-kit", "0.3.0");
const NEW_PAYOUT = kitAtLeast("payout-invariance-kit", "0.3.0");
const NEW_TRUST = kitAtLeast("trust-core", "0.3.0");
const NEW_LEDGER = kitAtLeast("advice-ledger-kit", "0.3.0");
const NEW_REGISTRY = kitAtLeast("claims-registry-kit", "0.4.0");
const NEW_PROVENANCE = kitAtLeast("provenance-kit", "0.3.0");

describe("kit version helper", () => {
  it.each([
    ["0.3.0", "0.3.0", true],
    ["0.3.1", "0.3.0", true],
    ["0.4.0", "0.3.0", true],
    ["1.0.0", "0.9.9", true],
    ["0.2.9", "0.3.0", false],
    ["0.3.0", "0.3.1", false],
    ["0.3.0-rc.1", "0.3.0", true],
    ["not-a-version", "0.3.0", false],
    ["0.3.0", "bad", false],
  ])("versionAtLeast(%s, %s) is %s", (have, need, expected) => {
    expect(versionAtLeast(have, need)).toBe(expected);
  });

  it("parses only major.minor.patch", () => {
    expect(parseVersion("12.4.30-beta.2+build")).toEqual([12, 4, 30]);
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });

  it("reads the installed version of a real kit and null for a package that is not installed", () => {
    expect(installedKitVersion("grounding-kit")).toMatch(/^\d+\.\d+\.\d+/);
    expect(installedKitVersion("definitely-not-an-installed-kit")).toBeNull();
    expect(kitAtLeast("definitely-not-an-installed-kit", "0.0.1")).toBe(false);
  });
});

describe("corroborate_evidence: origins (corroboration-kit 0.3+)", () => {
  const pageA = { source: "https://example.com/a", kind: "structural", vote: "supports", detail: "d" };
  const pageB = { source: "https://example.com/b", kind: "textual", vote: "supports", detail: "d" };
  const strong: Coverage = "strong";

  it.runIf(NEW_CORROBORATION)("passes a declared origin on each signal to the kit, so two pages of one site can count twice", async () => {
    const signals = [{ ...pageA, origin: "team-a" }, { ...pageB, origin: "team-b" }];
    const expected = (corroborate as unknown as (s: unknown, c: Coverage) => unknown)(signals, strong);
    const result = await call("corroborate_evidence", { signals, coverage: strong });
    expect(jsonOf(result)).toEqual(expected);
    expect(jsonOf(result).supports).toBe(2);
    expect(jsonOf(result).verdict).toBe("confirmed");
  });

  it.runIf(NEW_CORROBORATION)("without a declared origin, two pages of one site count once (the kit's default)", async () => {
    const result = await call("corroborate_evidence", { signals: [pageA, pageB], coverage: strong });
    expect(jsonOf(result).supports).toBe(1);
    expect(jsonOf(result).verdict).toBe("likely");
    expect(summaryOf(result)).toMatch(/counted together/i);
  });

  it.runIf(NEW_CORROBORATION)("passes derivedFrom to the kit", async () => {
    const signals = [
      { source: "https://a.example.org/x", kind: "structural", vote: "supports", detail: "d", derivedFrom: ["https://b.other.net/y"] },
      { source: "https://b.other.net/y", kind: "textual", vote: "supports", detail: "d" },
    ];
    const result = await call("corroborate_evidence", { signals, coverage: strong });
    expect(jsonOf(result).supports).toBe(1);
    const withoutLineage = signals.map(({ source, kind, vote, detail }) => ({ source, kind, vote, detail }));
    const without = await call("corroborate_evidence", { signals: withoutLineage, coverage: strong });
    expect(jsonOf(without).supports).toBe(2);
  });

  it.runIf(NEW_CORROBORATION)("passes inferOrigins:false, which keeps the 0.2 counting of pages", async () => {
    const result = await call("corroborate_evidence", { signals: [pageA, pageB], coverage: strong, inferOrigins: false });
    expect(jsonOf(result).supports).toBe(2);
  });

  it.runIf(NEW_CORROBORATION)("one page under two URL spellings counts once", async () => {
    const result = await call("corroborate_evidence", {
      signals: [pageA, { ...pageA, source: "https://example.com/a/" }, { ...pageA, source: "http://example.com/a?utm_source=x" }],
      coverage: strong,
    });
    expect(jsonOf(result).supports).toBe(1);
    expect(jsonOf(result).verdict).not.toBe("confirmed");
  });

  it.skipIf(NEW_CORROBORATION)("refuses origin, derivedFrom and inferOrigins instead of ignoring them (older kit)", async () => {
    for (const args of [
      { signals: [{ ...pageA, origin: "x" }], coverage: strong },
      { signals: [{ ...pageA, derivedFrom: ["y"] }], coverage: strong },
      { signals: [pageA], coverage: strong, inferOrigins: false },
    ]) {
      const result = await call("corroborate_evidence", args);
      expect(result.isError).toBe(true);
      expect(summaryOf(result)).toMatch(/corroboration-kit 0\.3\.0 or later/);
    }
  });

  it("the description says what counts as one source for the installed kit", async () => {
    const description = await descriptionOf("corroborate_evidence");
    expect(description).toContain("normalized source identities");
    if (NEW_CORROBORATION) {
      expect(description).toMatch(/origin/);
      expect(description).toMatch(/pages of one site/i);
    } else {
      expect(description).toMatch(/trailing slash/i);
      expect(description).toMatch(/count as (separate|distinct)/i);
    }
  });
});

describe("check_payout_invariance: static-imports matching", () => {
  const files = { "rank.ts": "score += offer.commissionRate * 0.1;\nconst u = card.affiliateUrl;" };

  it("matches whole words by default: commission does not match commissionRate", async () => {
    const result = await call("check_payout_invariance", { mode: "static-imports", files, payoutIdentifiers: ["commission", "affiliate"] });
    expect(summaryOf(result)).toMatch(/^CLEAN/);
    expect(jsonOf(result)).toEqual(assertNoPayoutImports(files, ["commission", "affiliate"]));
  });

  it.runIf(NEW_PAYOUT)("finds suffixed names with matchIdentifierParts:true", async () => {
    const result = await call("check_payout_invariance", {
      mode: "static-imports",
      files,
      payoutIdentifiers: ["commission", "affiliate"],
      matchIdentifierParts: true,
    });
    expect(summaryOf(result)).toMatch(/^FOUND/);
    const offenses = jsonOf(result) as { file: string; matches: { line: number }[] }[];
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.matches.map((m) => m.line)).toEqual([1, 2]);
  });

  it.runIf(NEW_PAYOUT)("matchIdentifierParts:false behaves like leaving it out", async () => {
    const result = await call("check_payout_invariance", {
      mode: "static-imports",
      files,
      payoutIdentifiers: ["commission"],
      matchIdentifierParts: false,
    });
    expect(summaryOf(result)).toMatch(/^CLEAN/);
  });

  it.skipIf(NEW_PAYOUT)("refuses matchIdentifierParts:true instead of ignoring it (older kit)", async () => {
    const result = await call("check_payout_invariance", {
      mode: "static-imports",
      files,
      payoutIdentifiers: ["commission"],
      matchIdentifierParts: true,
    });
    expect(result.isError).toBe(true);
    expect(summaryOf(result)).toMatch(/payout-invariance-kit 0\.3\.0 or later/);
  });

  it("the description says matching is whole-word and that suffixed names are not matched", async () => {
    const description = await descriptionOf("check_payout_invariance");
    expect(description).toMatch(/whole-word/i);
    expect(description).toContain("commissionRate");
    expect(description).toMatch(/NOT matched|not matched/);
    if (NEW_PAYOUT) expect(description).toContain("matchIdentifierParts");
    else expect(description).not.toMatch(/matchIdentifierParts:\s*true/);
  });

  it("the runtime description says the ranking function must be deterministic", async () => {
    const description = await descriptionOf("check_payout_invariance");
    expect(description).toMatch(/deterministic/i);
  });
});

describe("assess_anonymous_authenticity: fullCountWeight (trust-core 0.3+)", () => {
  const now = "2026-10-01T00:00:00Z";
  const signals = [
    { id: "1", source: "forum", sentiment: 0.5, confidence: 0.9, publishedAt: "2026-09-20" },
    { id: "2", source: "blog", sentiment: 0.4, confidence: 0.9, publishedAt: "2026-09-20" },
  ];

  it.runIf(NEW_TRUST)("passes fullCountWeight to the kit", async () => {
    // A high bar: each source type must reach credibility x confidence of 2 to count as a whole one.
    const config = { fullCountWeight: 2 };
    // The older kit's types do not know fullCountWeight, so go through a loosely typed reference.
    const resolve = anonymous.resolveAnonymousConfig as (partial?: unknown) => ReturnType<typeof anonymous.resolveAnonymousConfig>;
    const expected = anonymous.assessAuthenticity(signals, resolve(config), { now });
    const result = await call("assess_anonymous_authenticity", { signals, config, now });
    expect(jsonOf(result)).toEqual(expected);
    const baseline = await call("assess_anonymous_authenticity", { signals, now });
    expect(jsonOf(result).trustScore).not.toBe(jsonOf(baseline).trustScore);
  });

  it.skipIf(NEW_TRUST)("refuses fullCountWeight instead of ignoring it (older kit)", async () => {
    const result = await call("assess_anonymous_authenticity", { signals, config: { fullCountWeight: 2 }, now });
    expect(result.isError).toBe(true);
    expect(summaryOf(result)).toMatch(/trust-core 0\.3\.0 or later/);
  });

  it("the description says a negative corpus can score below a positive one", async () => {
    const description = await descriptionOf("assess_anonymous_authenticity");
    expect(description).toMatch(/not a sentiment ranking|ranks? (an )?honest negative/i);
  });
});

describe("score_trust_identified: description lists the example vocabulary", () => {
  it("names the valid tier, source and proof keys of the example configuration", async () => {
    const description = await descriptionOf("score_trust_identified");
    for (const key of ["new", "standard", "verified", "expert", "imported", "referred", "direct", "none", "self_attested", "documented"]) {
      expect(description, `description should list ${key}`).toContain(key);
    }
  });
});

describe("grade_decision: description matches the installed advice-ledger-kit", () => {
  it("states the tie rule that the installed kit applies", async () => {
    const description = await descriptionOf("grade_decision");
    if (NEW_LEDGER) {
      expect(description).toMatch(/not lower than the baseline/);
      expect(description).not.toMatch(/not higher than the baseline/);
    } else {
      expect(description).toMatch(/not higher than the baseline/);
      expect(description).not.toMatch(/not lower than the baseline/);
    }
  });

  it("says the refute threshold is a fixed count, not a rate", async () => {
    const description = await descriptionOf("grade_decision");
    expect(description).toMatch(/fixed count/);
  });

  it.runIf(NEW_LEDGER)("a tie in the bad rate is not-holding", async () => {
    const day = (n: number) => `2026-05-${String(n).padStart(2, "0")}`;
    const result = await call("grade_decision", {
      decision: { recommendationId: "r1", status: "adopted", decidedAt: "2026-06-01" },
      recommendation: { id: "r1", subjectId: "s", checkKey: "k", proposedAt: "2026-05-01" },
      config: { refuteThreshold: 4 },
      observations: [
        ...[1, 2, 3].map((n) => ({ subjectId: "s", checkKey: "k", state: "bad", observedAt: day(n) })),
        { subjectId: "s", checkKey: "k", state: "good", observedAt: day(4) },
        ...["2026-06-10", "2026-06-20", "2026-06-30"].map((d) => ({ subjectId: "s", checkKey: "k", state: "bad", observedAt: d, exposed: true })),
        { subjectId: "s", checkKey: "k", state: "good", observedAt: "2026-07-04", exposed: true },
      ],
    });
    expect(jsonOf(result).verdict).toBe("not-holding");
  });
});

describe("check_claims_registry: description matches the installed claims-registry-kit", () => {
  it("mentions placeholder references and the 24-hour rule only when the kit applies them", async () => {
    const description = await descriptionOf("check_claims_registry");
    if (NEW_REGISTRY) {
      expect(description).toMatch(/placeholder/i);
      expect(description).toMatch(/TODO/);
      expect(description).toMatch(/24 hours/);
    } else {
      expect(description).not.toMatch(/placeholder/i);
    }
  });

  it.runIf(NEW_REGISTRY)("a placeholder evidenceRef is unverified", async () => {
    const result = await call("check_claims_registry", {
      now: "2026-10-01",
      maxAgeDays: 90,
      claims: [{ id: "c1", text: "It is safe.", evidenceRef: "TODO", verifiedAt: "2026-09-22" }],
    });
    expect(jsonOf(result).counts).toEqual({ current: 0, stale: 0, unverified: 1, total: 1 });
  });
});

describe("check_provenance_claims", () => {
  it("the description says custom phrases match as prefixes and does not offer a trailing-space workaround", async () => {
    const description = await descriptionOf("check_provenance_claims");
    expect(description).toMatch(/prefix/i);
    expect(description).toContain("provenance");
    expect(description).not.toMatch(/trailing space/i);
  });

  it("the description says a limits sentence such as 'outside this guarantee' is still reported", async () => {
    const description = await descriptionOf("check_provenance_claims");
    expect(description).toContain("outside this guarantee");
  });

  it("the description says the default list is small and what that means for a CLEAN result", async () => {
    const description = await descriptionOf("check_provenance_claims");
    expect(description).toMatch(/SOC 2|HIPAA|best-in-class/);
  });

  it("a CLEAN result with the default list says how short the list is", async () => {
    const result = await call("check_provenance_claims", {
      claims: [{ id: "a", text: "SOC 2 certified and HIPAA-ready.", tier: "editorial" }],
    });
    expect(summaryOf(result)).toMatch(/^CLEAN/);
    expect(summaryOf(result)).toMatch(/default phrase list has only \d+ phrases/);
  });

  it("a CLEAN result with a custom list does not claim anything about the default list", async () => {
    const result = await call("check_provenance_claims", {
      claims: [{ id: "a", text: "Plain text.", tier: "editorial" }],
      certaintyPhrases: ["guaranteed"],
    });
    expect(summaryOf(result)).toMatch(/^CLEAN/);
    expect(summaryOf(result)).not.toMatch(/default phrase list/);
  });

  it("custom phrases match as prefixes: 'proven' also flags 'provenance'", async () => {
    const result = await call("check_provenance_claims", {
      claims: [{ id: "a", text: "Each record carries a provenance snapshot.", tier: "editorial" }],
      certaintyPhrases: ["proven"],
    });
    expect(summaryOf(result)).toMatch(/^FOUND/);
  });

  it.runIf(NEW_PROVENANCE)("a trailing space in a custom phrase no longer prevents the prefix match", async () => {
    const result = await call("check_provenance_claims", {
      claims: [{ id: "a", text: "Each record carries a provenance snapshot.", tier: "editorial" }],
      certaintyPhrases: ["proven "],
    });
    expect(summaryOf(result)).toMatch(/^FOUND/);
  });
});

describe("check_grounding: description", () => {
  it("calls an invalid unit a lead for human review, not a hard stop, and names the lexical limits", async () => {
    const description = await descriptionOf("check_grounding");
    expect(description).not.toMatch(/hard stop/i);
    expect(description).toMatch(/human review/i);
    expect(description).toMatch(/paraphrase/i);
    expect(description).toMatch(/figure|number/i);
    expect(description).toMatch(/negat/i);
  });
});

describe("verify_audit_chain: summary", () => {
  it("does not call an empty chain verified", async () => {
    const result = await call("verify_audit_chain", { chain: [] });
    expect(jsonOf(result).valid).toBe(true);
    expect(summaryOf(result)).toMatch(/empty chain/i);
    expect(summaryOf(result)).toMatch(/nothing was checked/i);
    expect(summaryOf(result)).not.toMatch(/all 0 entries verified/);
  });

  it("still says all entries verified for a real chain", async () => {
    const appended = await call("append_audit_entry", { chain: [], payload: { step: 0 } });
    const chain = jsonOf(appended).chain;
    const result = await call("verify_audit_chain", { chain });
    expect(summaryOf(result)).toMatch(/^VALID: all 1 entry verified/);
  });
});

describe("mutation and scaffold descriptions", () => {
  it("check_mutation_invariance says the function must not change its argument", async () => {
    const description = await descriptionOf("check_mutation_invariance");
    expect(description).toMatch(/must not (modify|change|edit)/i);
  });

  it("scaffold_agent_receipts mentions requireCoverage and the snapshot field", async () => {
    const result = await call("scaffold_agent_receipts", { includeWorkedExample: false });
    const text = result.content?.[1]?.text ?? "";
    expect(text).toContain("requireCoverage");
    expect(text).toContain("snapshot");
  });

  it("scaffold_cost_governor points at admission control and the time-zone rule for expiresAt", async () => {
    const result = await call("scaffold_cost_governor", { includeWorkedExample: false });
    const text = result.content?.[1]?.text ?? "";
    expect(text).toContain("admitBeforeCall");
    expect(text).toMatch(/expiresAt/);
  });
});
