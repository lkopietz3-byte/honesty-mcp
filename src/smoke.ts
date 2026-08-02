// Standalone smoke test: builds the real server, connects a real MCP Client
// to it over a pair of linked in-memory transports (no stdio subprocess),
// lists every registered tool, and calls one of them end-to-end. Run with
// `npm run build && npm run smoke` as a quick "does this actually work"
// check independent of the vitest suite.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

// client.callTool()'s declared return type is a back-compat union that
// includes a pre-2025 shape with no `content` field at all -- narrow it at
// runtime rather than fighting that union at the call site (see test/server.test.ts).
function contentBlocks(result: unknown): { type: string; text?: string }[] {
  const r = result as { content?: { type: string; text?: string }[] };
  return r.content ?? [];
}

async function main(): Promise<void> {
  const server = createServer();
  const client = new Client({ name: "smoke-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  console.log(`Connected to ${SERVER_NAME} v${SERVER_VERSION}\n`);

  const { tools } = await client.listTools();
  console.log(`Registered tools (${tools.length}):`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description?.slice(0, 100)}${(tool.description?.length ?? 0) > 100 ? "..." : ""}`);
  }

  console.log("\nCalling check_grounding with a forged citation as an end-to-end smoke check...");
  const result = await client.callTool({
    name: "check_grounding",
    arguments: {
      text: "The bridge opened in 1932 [[cite:1]]. It cost ten million dollars [[cite:missing]].",
      evidence: { "1": "The bridge opened to traffic in 1932." },
    },
  });
  const isError = (result as { isError?: boolean }).isError ?? false;
  const jsonBlock = contentBlocks(result)[1];
  const parsed = jsonBlock && jsonBlock.type === "text" && jsonBlock.text ? JSON.parse(jsonBlock.text) : null;
  console.log(`  isError: ${isError}`);
  console.log(`  isClean: ${parsed?.isClean}, invalid: ${parsed?.counts?.invalid}`);
  if (isError || parsed?.isClean !== false || parsed?.counts?.invalid !== 1) {
    throw new Error("Smoke check failed: expected isClean=false and exactly 1 invalid citation.");
  }

  await client.close();
  await server.close();
  console.log("\nSmoke test passed.");
}

main().catch((err) => {
  console.error("Smoke test FAILED:", err);
  process.exit(1);
});
