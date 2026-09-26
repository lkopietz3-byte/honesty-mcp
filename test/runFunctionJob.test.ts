// Unit tests for runFunctionJob.ts -- the worker_threads-based runner that
// check_payout_invariance (runtime mode), check_mutation_invariance, and
// compute_divergence (config.groupBySource) use to run caller-supplied JS
// source off the main thread with a bounded timeout.
//
// See workerTimeout.test.ts for the end-to-end proof (through the actual
// MCP tools) that this replaced synchronous, unbounded in-process execution.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKER_TIMEOUT_MS,
  resolveWorkerTimeoutMs,
  runFunctionJob,
  WORKER_TIMEOUT_ENV_VAR,
} from "../src/lib/runFunctionJob.js";

describe("resolveWorkerTimeoutMs", () => {
  it("returns the default when the env var is unset", () => {
    delete process.env[WORKER_TIMEOUT_ENV_VAR];
    expect(resolveWorkerTimeoutMs()).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("returns the default when the env var is blank", () => {
    process.env[WORKER_TIMEOUT_ENV_VAR] = "   ";
    try {
      expect(resolveWorkerTimeoutMs()).toBe(DEFAULT_WORKER_TIMEOUT_MS);
    } finally {
      delete process.env[WORKER_TIMEOUT_ENV_VAR];
    }
  });

  it("honors a valid positive override", () => {
    process.env[WORKER_TIMEOUT_ENV_VAR] = "250";
    try {
      expect(resolveWorkerTimeoutMs()).toBe(250);
    } finally {
      delete process.env[WORKER_TIMEOUT_ENV_VAR];
    }
  });

  it("rejects zero, negative, and non-numeric overrides", () => {
    for (const bad of ["0", "-5", "not-a-number", "NaN", "Infinity"]) {
      process.env[WORKER_TIMEOUT_ENV_VAR] = bad;
      try {
        expect(() => resolveWorkerTimeoutMs()).toThrow(WORKER_TIMEOUT_ENV_VAR);
      } finally {
        delete process.env[WORKER_TIMEOUT_ENV_VAR];
      }
    }
  });
});

describe("runFunctionJob: normal jobs", () => {
  it("runs a payout-invariance job and returns the real kit result", async () => {
    const result = await runFunctionJob<{ passed: boolean }>(
      {
        kind: "payout-invariance",
        rankFnSource: "(candidates) => candidates.slice().sort((a, b) => b.payout - a.payout)",
        baseInput: [
          { id: "a", payout: 1 },
          { id: "b", payout: 5 },
        ],
        mutations: [{ name: "zero out payout", mutateSource: "(input) => input.map((c) => ({ ...c, payout: 0 }))" }],
      },
      2000,
    );
    // Deliberately payout-sensitive ranker -> the mutation should flip the order -> fails.
    expect(result.passed).toBe(false);
  });

  it("runs a mutation-invariance job and returns the real kit result", async () => {
    const result = await runFunctionJob<{ passed: boolean }>(
      {
        kind: "mutation-invariance",
        fnSource: "(applicant) => applicant.income > 50000",
        baseInput: { income: 80000, name: "Emily" },
        scenarios: [{ name: "swap name", mutateSource: "(input) => ({ ...input, name: 'Jamal' })" }],
      },
      2000,
    );
    // Decision genuinely ignores name -> passes.
    expect(result.passed).toBe(true);
  });

  it("runs a divergence-group-by job and returns the real kit result", async () => {
    const result = await runFunctionJob<{ groups: { group: string | null }[] }>(
      {
        kind: "divergence-group-by",
        pairs: [
          { engineJudgment: "approve", humanJudgment: "reject", group: "x" },
          { engineJudgment: "approve", humanJudgment: "reject", group: "y" },
        ],
        floors: { minComparablePairs: 1, minDivergentCount: 1, minDivergentRate: 0 },
        groupBySource: "(pair) => pair.group",
      },
      2000,
    );
    expect(result.groups.map((g) => g.group).sort()).toEqual(["x", "y"]);
  });
});

describe("runFunctionJob: error propagation", () => {
  it("rejects with the kit's own error message when the built function throws", async () => {
    await expect(
      runFunctionJob(
        {
          kind: "payout-invariance",
          rankFnSource: "() => { throw new Error('rankFn boom'); }",
          baseInput: [1, 2, 3],
          mutations: [{ name: "noop", mutateSource: "(input) => [...input]" }],
        },
        2000,
      ),
    ).rejects.toThrow(/rankFn boom/);
  });

  it("rejects with a clear message for invalid source (not valid JS)", async () => {
    await expect(
      runFunctionJob(
        {
          kind: "mutation-invariance",
          fnSource: "this is not valid js (((",
          baseInput: {},
          scenarios: [{ name: "s", mutateSource: "(x) => x" }],
        },
        2000,
      ),
    ).rejects.toThrow(/fnSource/);
  });

  it("rejects when the built function returns a Promise (kit forbids async rank functions)", async () => {
    await expect(
      runFunctionJob(
        {
          kind: "payout-invariance",
          rankFnSource: "async (input) => input",
          baseInput: [1, 2, 3],
          mutations: [{ name: "noop", mutateSource: "(input) => [...input]" }],
        },
        2000,
      ),
    ).rejects.toThrow(/returned a Promise/);
  });
});

describe("runFunctionJob: timeout enforcement", () => {
  it(
    "terminates a genuinely infinite loop and rejects within a small bounded time",
    { timeout: 8000 },
    async () => {
      const start = Date.now();
      await expect(
        runFunctionJob(
          {
            kind: "mutation-invariance",
            fnSource: "() => { while (true) {} }",
            baseInput: {},
            scenarios: [{ name: "s", mutateSource: "(x) => ({ ...x, changed: true })" }],
          },
          200, // explicit small timeout -- this is the whole point of the test
        ),
      ).rejects.toThrow(/Timed out after 200ms/);
      const elapsed = Date.now() - start;
      // Generous upper bound for worker startup/teardown overhead on a slow
      // machine; the point is "hundreds of ms", not "however long the loop runs".
      expect(elapsed).toBeLessThan(4000);
    },
  );
});
