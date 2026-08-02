// Builds the McpServer and registers every tool. Split out from index.ts so
// tests (and the smoke script) can construct a real server instance without
// going through the stdio transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGroundingTool } from "./tools/grounding.js";
import { registerCorroborationTool } from "./tools/corroboration.js";
import { registerPayoutInvarianceTool } from "./tools/payoutInvariance.js";
import { registerMutationInvarianceTool } from "./tools/mutationInvariance.js";
import { registerTrustIdentifiedTool } from "./tools/trustIdentified.js";
import { registerTrustAnonymousTool } from "./tools/trustAnonymous.js";
import { registerProvenanceTool } from "./tools/provenance.js";
import { registerClaimsRegistryTool } from "./tools/claimsRegistry.js";
import { registerAuditChainTools } from "./tools/auditChain.js";
import { registerAgentReceiptScaffoldTool } from "./tools/agentReceiptScaffold.js";
import { registerCostGovernorScaffoldTool } from "./tools/costGovernorScaffold.js";
import { registerAdviceLedgerGradeTool, registerAdviceLedgerDivergenceTool } from "./tools/adviceLedger.js";

export const SERVER_NAME = "honesty-mcp";
export const SERVER_VERSION = "0.1.0";

/** Builds a fresh McpServer with every honesty-kit tool registered. */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // 9 content-checking kits, 12 tools (one tool each, except payout-invariance,
  // audit-chain, and advice-ledger which each split into two genuinely
  // distinct operations -- see README.md for the mapping).
  registerGroundingTool(server);
  registerCorroborationTool(server);
  registerPayoutInvarianceTool(server);
  registerMutationInvarianceTool(server);
  registerTrustIdentifiedTool(server);
  registerTrustAnonymousTool(server);
  registerProvenanceTool(server);
  registerClaimsRegistryTool(server);
  registerAuditChainTools(server); // append_audit_entry + verify_audit_chain
  registerAdviceLedgerGradeTool(server); // grade_decision
  registerAdviceLedgerDivergenceTool(server); // compute_divergence

  // 2 scaffold/guidance tools (agent-receipt-kit, cost-governor-kit -- runtime
  // libraries, not content checks).
  registerAgentReceiptScaffoldTool(server);
  registerCostGovernorScaffoldTool(server);

  return server;
}
