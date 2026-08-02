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

export const SERVER_NAME = "honesty-mcp";
export const SERVER_VERSION = "0.1.0";

/** Builds a fresh McpServer with every honesty-kit tool registered. */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // 8 content-checking tools (kits 1-8, one kit split across two tools each
  // for payout-invariance and audit-chain -- see README.md for the mapping).
  registerGroundingTool(server);
  registerCorroborationTool(server);
  registerPayoutInvarianceTool(server);
  registerMutationInvarianceTool(server);
  registerTrustIdentifiedTool(server);
  registerTrustAnonymousTool(server);
  registerProvenanceTool(server);
  registerClaimsRegistryTool(server);
  registerAuditChainTools(server); // append_audit_entry + verify_audit_chain

  // 2 scaffold/guidance tools (kits 9-10 -- runtime libraries, not content checks).
  registerAgentReceiptScaffoldTool(server);
  registerCostGovernorScaffoldTool(server);

  return server;
}
