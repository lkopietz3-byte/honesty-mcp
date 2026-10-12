// Builds the McpServer and registers every tool. Split out from index.ts so
// tests (and the smoke script) can construct a real server instance without
// going through the stdio transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CODE_EXEC_ENV_VAR, CODE_EXEC_ENABLING_VALUE, isCodeExecEnabled } from "./lib/codeExec.js";
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

/** The name this server reports to MCP clients during the initialize handshake. */
export const SERVER_NAME = "honesty-mcp";
/** The version this server reports to MCP clients. Keep in sync with package.json's `version`. */
export const SERVER_VERSION = "0.3.0";

/**
 * Text sent to MCP clients in the initialize result while code execution is
 * off, so an agent (and the person reading its transcript) can see why some
 * tools or inputs are missing and what the operator would have to change.
 */
export const CODE_EXEC_OFF_INSTRUCTIONS =
  "Code execution is off. check_mutation_invariance is not available, check_payout_invariance offers " +
  "static-imports mode only, and compute_divergence does not accept config.groupBySource, because those paths " +
  `run caller-supplied JavaScript. The server operator can turn them on by setting ${CODE_EXEC_ENV_VAR}=` +
  `${CODE_EXEC_ENABLING_VALUE} in the server's environment. Turning it on runs that code with this process's ` +
  "filesystem, network and environment access; the worker thread only bounds time and is not a sandbox.";

/**
 * Builds a fresh McpServer with every honesty-kit tool registered. Which
 * tools and inputs are registered depends on whether code execution is
 * enabled (see lib/codeExec.ts), read when this function runs.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    isCodeExecEnabled() ? undefined : { instructions: CODE_EXEC_OFF_INSTRUCTIONS },
  );

  // 14 tools when code execution is enabled, 13 when it is off (the default;
  // check_mutation_invariance is then not registered).
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
