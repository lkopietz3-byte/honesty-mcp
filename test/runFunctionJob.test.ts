// Unit tests for runFunctionJob.ts -- the worker_threads-based runner that
// check_payout_invariance (runtime mode), check_mutation_invariance, and
// compute_divergence (config.groupBySource) use to run caller-supplied JS
// source off the main thread with a bounded timeout.
//
// See workerTimeout.test.ts for the end-to-end proof (through the actual
// MCP tools) that this replaced synchronous, unbounded in-process execution.

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKER_TIMEOUT_MS,
  MAX_WORKER_TIMEOUT_MS,
  resolveWorkerTimeoutMs,
  runFunctionJob,
  WORKER_TIMEOUT_ENV_VAR,
} from "../src/lib/runFunctionJob.js";

describe("runFunctionJob: caller output never reaches stdout", () => {
  it("routes console.log, console.error and process.stdout.write from caller code to stderr", async () => {
    const stdoutWrites: string[] = [];
    const stderrWrites: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    try {
      const result = await runFunctionJob<{ passed: boolean }>(
        {
          kind: "mutation-invariance",
          fnSource:
            '(x) => { console.log("LEAK_LOG"); console.error("LEAK_ERR"); process.stdout.write("LEAK_RAW\\n"); return x.v; }',
          baseInput: { v: 1, other: 1 },
          scenarios: [{ name: "change other", mutateSource: "(i) => ({ ...i, other: 2 })" }],
        },
        5000,
      );
      expect(result.passed).toBe(true);
      // Give the worker's piped streams a moment to flush before asserting.
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
    expect(stdoutWrites.join("")).not.toMatch(/LEAK_/);
    expect(stderrWrites.join("")).toMatch(/LEAK_LOG/);
  });
});

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

  it("accepts the largest delay Node's timers honor", () => {
    process.env[WORKER_TIMEOUT_ENV_VAR] = String(MAX_WORKER_TIMEOUT_MS);
    try {
      expect(resolveWorkerTimeoutMs()).toBe(MAX_WORKER_TIMEOUT_MS);
    } finally {
      delete process.env[WORKER_TIMEOUT_ENV_VAR];
    }
  });

  it("rejects delays Node would silently turn into 1 ms", () => {
    // setTimeout clamps anything above 2147483647 ms to 1 ms, so accepting
    // these would make every job time out immediately.
    for (const bad of [String(MAX_WORKER_TIMEOUT_MS + 1), "2147483648", "1e12"]) {
      process.env[WORKER_TIMEOUT_ENV_VAR] = bad;
      try {
        expect(() => resolveWorkerTimeoutMs()).toThrow(WORKER_TIMEOUT_ENV_VAR);
      } finally {
        delete process.env[WORKER_TIMEOUT_ENV_VAR];
      }
    }
  });

  it("rejects a timeoutMs argument outside the timer range", async () => {
    const job = {
      kind: "payout-invariance" as const,
      rankFnSource: "(c) => c",
      baseInput: [],
      mutations: [{ name: "noop", mutateSource: "(i) => i" }],
    };
    await expect(runFunctionJob(job, MAX_WORKER_TIMEOUT_MS + 1)).rejects.toThrow(RangeError);
    await expect(runFunctionJob(job, 0)).rejects.toThrow(RangeError);
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
