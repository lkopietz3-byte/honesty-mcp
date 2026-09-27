// Proves the worker-thread timeout fix for check_payout_invariance (runtime
// mode), check_mutation_invariance, and compute_divergence (groupBySource).
//
// Before this fix, all three built a caller-supplied function via
// buildFunctionFromSource and called the wrapped kit SYNCHRONOUSLY on the
// server's own (single) main thread, with no timeout of any kind -- a
// `while (true) {}` source string would block the whole stdio server
// forever. Section A below reproduces that exact old pattern (same
// buildFunctionFromSource, same kit call, same synchronous execution) as a
// permanent regression pin: it documents, with a real assertion, that this
// call shape has no way to bound a slow/hung caller function -- so if
// anyone ever routes one of these tools back through it instead of
// runFunctionJob, the contrast with Section B (which proves the ACTUAL
// shipped tools stay bounded) is explicit. Section B is the test that
// matters for this fix; Section A is the "why".
//
// How this was actually proven before the fix existed (not reproduced on
// every test run, to avoid shipping a test with a deliberately tight
// timeout): with Section A's own guard temporarily tightened to 1500ms
// (below the loop's fixed 3000ms), `npx vitest run` reported
//   FAIL  ... blocks for the full duration ... 3004ms
//   Error: Test timed out in 1500ms.
// i.e. the old call shape blew straight through a timeout guard set below
// its actual running time -- proving nothing bounded it. See the honesty-mcp
// report for the full captured output. Section A below uses a generous
// 5000ms guard instead, so this file's normal run PASSES while still
// asserting the same underlying fact (elapsed >= 2900ms with zero
// intervention).
//
// A genuinely infinite `while (true) {}` is only ever run inside a worker
// thread in this file (Section B), never on the main thread (Section A),
// because a synchronous main-thread infinite loop cannot be interrupted by
// vitest's own test timeout -- the single JS thread never yields back to
// vitest's timer, so a tight guard would be powerless against true
// infinity. Section A uses a busy loop bounded to a known, finite 3000ms
// specifically so it's safe to run in the normal suite.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { WORKER_TIMEOUT_ENV_VAR } from "../src/lib/runFunctionJob.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("Section A -- the pre-fix pattern (direct, synchronous, in-process) has no timeout", () => {
  it(
    "calling buildFunctionFromSource + assertPayoutInvariance synchronously (the old in-process pattern) blocks for the full duration of a slow rank function, with nothing to cut it off",
    { timeout: 5000 },
    async () => {
      const { buildFunctionFromSource } = await import("../src/lib/buildFunction.js");
      const { assertPayoutInvariance } = await import("payout-invariance-kit");

      const rankFn = buildFunctionFromSource(
        "(input) => { const start = Date.now(); while (Date.now() - start < 3000) {} return input; }",
        "rankFnSource",
      );

      const start = Date.now();
      assertPayoutInvariance(rankFn, [1, 2, 3], [{ name: "noop", mutate: (i: unknown) => (i as number[]).slice() }]);
      const elapsed = Date.now() - start;

      // Nothing bounded this call: it took the full ~3000ms the busy loop
      // asked for. That is exactly the shape of bug this fix closes for the
      // three real tools (see Section B) -- calling a kit function this way
      // gives a `while (true) {}` source string no reason to ever return.
      expect(elapsed).toBeGreaterThanOrEqual(2900);
    },
  );
});

describe("Section B -- the shipped fix enforces a real timeout", () => {
  let server: McpServer;
  let client: Client;
  const originalEnv = process.env[WORKER_TIMEOUT_ENV_VAR];

  beforeEach(async () => {
    server = createServer();
    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    if (originalEnv === undefined) delete process.env[WORKER_TIMEOUT_ENV_VAR];
    else process.env[WORKER_TIMEOUT_ENV_VAR] = originalEnv;
  });

  it(
    "check_payout_invariance (runtime mode) with an infinite loop errors out quickly instead of hanging",
    { timeout: 8000 },
    async () => {
      process.env[WORKER_TIMEOUT_ENV_VAR] = "200";
      const start = Date.now();
      const result = (await client.callTool({
        name: "check_payout_invariance",
        arguments: {
          mode: "runtime",
          rankFnSource: "() => { while (true) {} }",
          baseInput: [1, 2, 3],
          mutations: [{ name: "noop", mutateSource: "(input) => [...input]" }],
        },
      })) as { isError?: boolean; content?: { type: string; text?: string }[] };
      const elapsed = Date.now() - start;

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toMatch(/Timed out after 200ms/);
      expect(elapsed).toBeLessThan(4000);
    },
  );

  it(
    "check_mutation_invariance with an infinite loop errors out quickly instead of hanging",
    { timeout: 8000 },
    async () => {
      process.env[WORKER_TIMEOUT_ENV_VAR] = "200";
      const start = Date.now();
      const result = (await client.callTool({
        name: "check_mutation_invariance",
        arguments: {
          fnSource: "() => { while (true) {} }",
          baseInput: {},
          scenarios: [{ name: "s", mutateSource: "(x) => ({ ...x, changed: true })" }],
        },
      })) as { isError?: boolean; content?: { type: string; text?: string }[] };
      const elapsed = Date.now() - start;

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toMatch(/Timed out after 200ms/);
      expect(elapsed).toBeLessThan(4000);
    },
  );

  it(
    "compute_divergence with a hung groupBySource errors out quickly instead of hanging",
    { timeout: 8000 },
    async () => {
      process.env[WORKER_TIMEOUT_ENV_VAR] = "200";
      const start = Date.now();
      const result = (await client.callTool({
        name: "compute_divergence",
        arguments: {
          pairs: [{ engineJudgment: "a", humanJudgment: "b", group: "g" }],
          config: { groupBySource: "(pair) => { while (true) {} }" },
        },
      })) as { isError?: boolean; content?: { type: string; text?: string }[] };
      const elapsed = Date.now() - start;

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toMatch(/Timed out after 200ms/);
      expect(elapsed).toBeLessThan(4000);
    },
  );

  it("check_payout_invariance surfaces a thrown rankFn error as a clean tool error, not a crash", async () => {
    const result = (await client.callTool({
      name: "check_payout_invariance",
      arguments: {
        mode: "runtime",
        rankFnSource: "() => { throw new Error('deliberate boom'); }",
        baseInput: [1, 2, 3],
        mutations: [{ name: "noop", mutateSource: "(input) => [...input]" }],
      },
    })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/deliberate boom/);
  });

  it("check_mutation_invariance surfaces an async (Promise-returning) fn as a clean tool error", async () => {
    const result = (await client.callTool({
      name: "check_mutation_invariance",
      arguments: {
        fnSource: "async (input) => input",
        baseInput: {},
        scenarios: [{ name: "s", mutateSource: "(x) => ({ ...x, changed: true })" }],
      },
    })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/returned a Promise/);
  });
});
