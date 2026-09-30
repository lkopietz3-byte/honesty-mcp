// scaffold_agent_receipts — agent-receipt-kit does NOT get a "check this
// content" tool. Its core function, verifyReceipt, checks an AgentClaim
// against a WorkPacket that a human or orchestrator issued BEFORE the agent
// ran -- that packet only exists inside the calling application's own
// runtime, at the moment it authorizes an agent. An MCP tool call has no
// access to "the packet this application issued ten minutes ago" unless the
// caller re-supplies it, which is exactly the point: this kit is a pattern
// you WIRE INTO your own agent-orchestration code (issue before, verify
// after), not something this server can meaningfully check on demand the
// way it can check a document's citations or a claim's provenance tier.
//
// So this tool returns guidance instead: what the pattern is, when to use
// it, the install step, a starter snippet -- plus a live worked example run
// against the REAL kit functions (issuePacket + verifyReceipt), so the
// guidance isn't just prose.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { issuePacket, verifyReceipt } from "agent-receipt-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const STARTER_SNIPPET = `import { issuePacket, verifyReceipt } from "agent-receipt-kit";

// 1. BEFORE the agent runs: issue a packet describing exactly what it may do.
const packet = issuePacket(
  { repo: "acme/checkout", pathAllowlist: ["src/checkout/**"] }, // scope: whatever your domain needs
  "local",                                                        // authorityLevel: 'observe' | 'prepare' | 'local'
  ["read-file", "write-file", "run-tests"],                       // allowedActions
  ["scan-finding-42", "test-report-7"],                           // evidenceIds it may cite
);
// Hand packet.id / packet.scope / packet.authorityLevel to the agent as its instructions.
// Keep \`packet\` around (DB row, in-memory map, wherever) for the verify step below.

// 2. AFTER the agent reports back, its claim is UNTRUSTED by default:
const claim = {
  packetId: packet.id,
  claimedActions: ["read-file", "write-file"],
  citedEvidenceIds: ["scan-finding-42"],
  claimedFacts: { testsPassing: true },
};

// Optional: a fresher, independently-observed reality to cross-check claimedFacts against.
const currentState = { testsPassing: true };

const receipt = verifyReceipt(packet, claim, currentState);
if (!receipt.accepted) {
  // receipt.unauthorizedActions / receipt.droppedEvidenceIds / receipt.contradictions
  // tell you exactly what to reject and why -- log receipt.reason, don't just discard the claim.
  throw new Error(receipt.reason);
}
`;

/** Registers `scaffold_agent_receipts` on `server`. */
export function registerAgentReceiptScaffoldTool(server: McpServer): void {
  server.registerTool(
    "scaffold_agent_receipts",
    {
      title: "Scaffold the agent-receipt-kit authorization pattern",
      description:
        "agent-receipt-kit is a RUNTIME LIBRARY your own agent-orchestration code imports and calls at two " +
        "specific moments (issue a WorkPacket before an agent runs, verify its AgentClaim after) -- it is not " +
        "something this MCP server can 'check' on demand the way it checks a document's citations, because " +
        "the packet only exists inside your application's own runtime. Call this tool to get the pattern " +
        "explained, an install step, a copy-pasteable starter snippet for wiring issuePacket/verifyReceipt " +
        "into your own agent loop, and (optionally) a live worked example run against the real kit -- one " +
        "accepted claim, one rejected claim -- so you can see actual output before wiring it in. Use this " +
        "when you're building or reviewing anything that lets an AI agent report back what it did (a coding " +
        "agent, a browser-automation agent, a data-processing agent) and you don't yet trust that report by " +
        "construction.",
      inputSchema: {
        includeWorkedExample: z
          .boolean()
          .optional()
          .default(true)
          .describe("Also run a live accepted/rejected example against the real issuePacket/verifyReceipt, not just show a snippet."),
      },
    },
    ({ includeWorkedExample }) => {
      try {
        const guidance = {
          kit: "agent-receipt-kit",
          why_a_scaffold_tool_not_a_check_tool:
            "verifyReceipt's inputs (a WorkPacket and an AgentClaim) only exist inside the calling " +
              "application's own runtime, generated at the moment it authorizes and then hears back from an " +
              "agent. There is nothing standing content for this MCP server to 'check' the way check_grounding " +
              "checks a document -- the pattern has to be wired into your own code.",
          install: {
            note: "Published on npm. Node >= 20.19 or >= 22.12 is needed if you load it with require().",
            command: "npm install agent-receipt-kit",
          },
          pattern: [
            "1. Before the agent runs: issuePacket(scope, authorityLevel, allowedActions, evidenceIds) -> WorkPacket.",
            "2. Hand the agent its authority (packet.id/scope/authorityLevel/allowedActions/evidenceIds) as instructions.",
            "3. After the agent reports back: verifyReceipt(packet, claim, currentState?) -> ReceiptResult.",
            "4. Act only on receipt.accepted === true, and read it as 'no mismatch found against the packet and supplied state', not as verified truth. Check receipt.coverage for which claimed facts were actually compared. Log receipt.reason either way -- it's human-readable.",
            "5. Optional: createRefutationTrail to keep a running history of claims that got refuted.",
          ],
          starterSnippet: STARTER_SNIPPET,
        };

        if (!includeWorkedExample) {
          return jsonResult("Guidance for wiring agent-receipt-kit into your own agent-orchestration code.", guidance);
        }

        // Live worked example against the REAL kit functions.
        const packet = issuePacket(
          { repo: "acme/checkout", pathAllowlist: ["src/checkout/**"] },
          "local",
          ["read-file", "write-file", "run-tests"],
          ["scan-finding-42", "test-report-7"],
          { id: "pkt-demo-1", issuedAt: "2026-01-01T00:00:00.000Z" },
        );

        const acceptedClaim = {
          packetId: packet.id,
          claimedActions: ["read-file", "write-file"],
          citedEvidenceIds: ["scan-finding-42"],
          claimedFacts: { testsPassing: true },
        };
        const acceptedResult = verifyReceipt(packet, acceptedClaim, { testsPassing: true });

        const rejectedClaim = {
          packetId: packet.id,
          claimedActions: ["read-file", "write-file", "deploy-to-prod"], // unauthorized action
          citedEvidenceIds: ["scan-finding-42", "invented-evidence-99"], // dropped evidence id
          claimedFacts: { testsPassing: true }, // contradicts fresher observation below
        };
        const rejectedResult = verifyReceipt(packet, rejectedClaim, { testsPassing: false });

        const worked = {
          packet,
          acceptedExample: { claim: acceptedClaim, result: acceptedResult },
          rejectedExample: { claim: rejectedClaim, result: rejectedResult },
        };

        return jsonResult(
          "Guidance for wiring agent-receipt-kit into your own agent-orchestration code, plus a live worked example (one accepted claim, one rejected claim) run against the real issuePacket/verifyReceipt.",
          { ...guidance, workedExample: worked },
        );
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
