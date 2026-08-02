#!/usr/bin/env node
// honesty-mcp entrypoint. Connects the server built in server.ts to the
// standard stdio transport -- the transport Claude Code, Claude Desktop, and
// most local/CLI MCP client integrations expect for a locally-run server.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only -- stdout is the JSON-RPC channel and must stay clean.
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("honesty-mcp: fatal error starting server:", err);
  process.exit(1);
});
