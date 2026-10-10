// check_payout_invariance static-imports mode must never read a path the
// caller names. payout-invariance-kit reads any path it is given and returns
// the matching lines, which would let an agent read arbitrary files one line
// at a time. The tool boundary accepts a map of path -> content only.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CODE_EXEC_ENV_VAR } from "../src/lib/codeExec.js";
import { createServer } from "../src/server.js";

const CANARY_TEXT = "HONESTY_CANARY_SECRET_9f3a1c";
let dir: string;
let canaryPath: string;
const suiteDefault = process.env[CODE_EXEC_ENV_VAR];
let server: McpServer;
let client: Client;

async function start(): Promise<void> {
  server = createServer();
  client = new Client({ name: "file-read-test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "honesty-canary-"));
  canaryPath = join(dir, "outside-any-root.txt");
  writeFileSync(canaryPath, `${CANARY_TEXT} this line must never be returned\n`);
});

afterEach(async () => {
  await client.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
  if (suiteDefault === undefined) delete process.env[CODE_EXEC_ENV_VAR];
  else process.env[CODE_EXEC_ENV_VAR] = suiteDefault;
});

type ToolOutcome = { isError?: boolean; content?: { text?: string }[] } | { thrown: string };

async function call(args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    return (await client.callTool({ name: "check_payout_invariance", arguments: args })) as ToolOutcome;
  } catch (error) {
    return { thrown: error instanceof Error ? error.message : String(error) };
  }
}

describe.each([
  ["code execution off (default)", undefined],
  ["code execution on", "1"],
])("static-imports mode with %s", (_label, value) => {
  beforeEach(async () => {
    if (value === undefined) delete process.env[CODE_EXEC_ENV_VAR];
    else process.env[CODE_EXEC_ENV_VAR] = value;
    await start();
  });

  it("rejects a list of paths with a clear error and returns nothing from the file", async () => {
    const outcome = await call({
      mode: "static-imports",
      files: [canaryPath],
      payoutIdentifiers: [CANARY_TEXT],
    });
    expect(JSON.stringify(outcome)).not.toContain(CANARY_TEXT);
    expect(JSON.stringify(outcome)).not.toContain("must never be returned");
    expect("thrown" in outcome ? false : outcome.isError).toBe(true);
    if (!("thrown" in outcome)) {
      expect(outcome.content?.[0]?.text).toContain("does not read files from disk");
      expect(outcome.content?.[0]?.text).toContain("map of path -> file content");
    }
  });

  it("rejects an empty list of paths the same way", async () => {
    const outcome = await call({ mode: "static-imports", files: [], payoutIdentifiers: ["x"] });
    expect("thrown" in outcome ? false : outcome.isError).toBe(true);
  });

  it("does not treat a path used as a map key as something to read", async () => {
    const outcome = await call({
      mode: "static-imports",
      files: { [canaryPath]: "const nothing = 1;" },
      payoutIdentifiers: [CANARY_TEXT],
    });
    expect("thrown" in outcome ? true : outcome.isError).not.toBe(true);
    expect(JSON.stringify(outcome)).not.toContain("must never be returned");
    if (!("thrown" in outcome)) expect(outcome.content?.[0]?.text).toContain("CLEAN");
  });

  it("still scans content that the caller sends", async () => {
    const outcome = await call({
      mode: "static-imports",
      files: { "rank.ts": `const a = ${CANARY_TEXT};` },
      payoutIdentifiers: [CANARY_TEXT],
    });
    expect("thrown" in outcome ? "" : outcome.content?.[0]?.text).toContain("FOUND");
  });
});
