// scaffold_cost_governor — cost-governor-kit does NOT get a "check this
// content" tool either, for the same class of reason as agent-receipt-kit:
// its most distinctive piece (withReserveConfirm) takes a live UsageLedger
// -- an object with async checkUnderLimit/commitUsage methods backed by
// YOUR database -- and an async callback that makes the actual guarded API
// call. That's a runtime contract your app's request-handling code
// implements and calls, not JSON content this server can evaluate in
// isolation. The pricing math (estimateCostUsd) and the pre-call ceiling
// (checkPreCallCeiling) ARE pure data-in/data-out and could technically be
// exposed as a "check" tool on their own -- but they're one third of this
// kit's actual pitch (assembled together on purpose, see the kit's own
// README), so splitting them out into a separate content-check tool while
// leaving reserve/confirm behind would misrepresent the kit as much as
// forcing the whole thing into a check-shaped tool would. This tool treats
// the kit as one unit and demonstrates all three pieces live.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  checkPreCallCeiling,
  estimateCostUsd,
  formatRatesForLog,
  withReserveConfirm,
  type UsageLedger,
} from "cost-governor-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const STARTER_SNIPPET = `import { checkPreCallCeiling, withReserveConfirm, type UsageLedger } from "cost-governor-kit";

// --- 1. Estimated pre-call spend check. Accuracy depends on your estimate/rates. ---
const check = checkPreCallCeiling({
  spentSoFarUsd: runningTotal,
  ceilingUsd: 25,
  estimatedNextCallUsage: { inputTokens: 2000, outputTokens: 500 },
  rates: { inputPerMillion: 3, outputPerMillion: 15 }, // from a CLI flag / config, NEVER hardcoded
});
if (!check.allowed) {
  console.error(check.reason);
  return send429("Spend ceiling reached");
}

// --- 2. Advisory check-then-commit: a call that THROWS never commits, but this ---
// --- is not a concurrency-safe reservation -- see the notes below.            ---
class MyLedger implements UsageLedger {
  async checkUnderLimit(key: string, limit: number) {
    // READ-ONLY. e.g.: SELECT count FROM usage WHERE key = $1
    return (await db.getCount(key)) < limit;
  }
  async commitUsage(key: string) {
    // Called ONLY after the guarded call resolves successfully. Make the
    // increment itself atomic in real storage -- but note commitUsage never
    // receives \`limit\`, so this step alone cannot enforce it under concurrency.
    // If this throws/rejects, withReserveConfirm still returns the successful
    // call's result (see result.commitError below) -- it does NOT discard it.
    await db.increment(key);
  }
}

const result = await withReserveConfirm(
  new MyLedger(),
  \`\${userId}:\${today}\`,
  FREE_DAILY_LIMIT,
  () => callAnthropic(userId, prompt), // a thrown/rejected call never commits locally --
);                                     // but a timeout may still have billed the provider; reconcile before retrying.
if (!result.allowed) return send429("Daily limit reached");
if (Object.hasOwn(result, "commitError")) {
  // The call succeeded but recording its usage failed afterward -- the count
  // may now be under-recorded. Log it; do not retry the paid call for this.
  console.error("cost-governor: commitUsage failed after a successful call", result.commitError);
}
return send200(result.result);

// Need the limit to actually hold under concurrent requests? withReserveConfirm
// can't do that (concurrent callers can all pass the read-only check before any
// commits). Use withCapacityReservation + your own CapacityReservationLedger
// adapter instead -- see the kit's README, "Strict capacity reservation".
`;

/** Registers `scaffold_cost_governor` on `server`. */
export function registerCostGovernorScaffoldTool(server: McpServer): void {
  server.registerTool(
    "scaffold_cost_governor",
    {
      title: "Scaffold the cost-governor-kit spend-safety pattern",
      description:
        "cost-governor-kit is a RUNTIME LIBRARY your app installs and calls at the moment it's about to make " +
        "an AI API call -- it is not something this MCP server can 'check' on demand the way it checks a " +
        "document's citations. Its advisory check-then-commit piece (withReserveConfirm) needs a live " +
        "UsageLedger backed by YOUR database and an async callback making the real call, neither of which " +
        "exist as content to hand this tool. Call this to get all three pieces explained (estimated pre-call " +
        "spend check, cache-aware pricing math, advisory successful-call usage counting), an install step, a " +
        "copy-pasteable starter snippet, and (optionally) a live worked example: real checkPreCallCeiling " +
        "calls (one allowed, one blocked), a real withReserveConfirm run against an in-memory demo ledger " +
        "(one call under the limit, one over, one whose commit fails after a successful call), and a real " +
        "estimateCostUsd comparison of the default 0.1x cache-read rate against a caller-supplied " +
        "cacheReadPerMillion override. Use this when you're building or reviewing anything that calls " +
        "a paid AI API and want a pre-call spend estimate plus usage counting that skips a call that threw -- " +
        "NOT a strict concurrent limit and not proof a timed-out call was never billed by the provider (see " +
        "concurrency_and_recovery in the output, and use withCapacityReservation instead if you need a real " +
        "reservation).",
      inputSchema: {
        includeWorkedExample: z
          .boolean()
          .optional()
          .default(true)
          .describe("Also run live examples against the real checkPreCallCeiling/withReserveConfirm, not just show a snippet."),
      },
    },
    async ({ includeWorkedExample }) => {
      try {
        const guidance = {
          kit: "cost-governor-kit",
          why_a_scaffold_tool_not_a_check_tool:
            "withReserveConfirm's core contract is a live UsageLedger (async checkUnderLimit/commitUsage " +
              "against YOUR database) plus an async callback making the real guarded call -- there is no JSON " +
              "content to hand this MCP server that would make that check meaningful. The pricing math and " +
              "pre-call ceiling ARE plain data-in/data-out, but the kit's own pitch is the three pieces " +
              "assembled together, so this tool demonstrates all three rather than splitting one out.",
          install: {
            note: "Published on npm. Node >= 20.19 or >= 22.12 is needed if you load it with require().",
            command: "npm install cost-governor-kit",
            reference_impl:
              "reference-impl/supabase-usage-ledger.sql implements only the advisory UsageLedger for " +
                "Postgres/Supabase. Its commit-time re-check caps the recorded count but does not prevent " +
                "concurrent over-limit paid calls -- it is not a concurrency-safe reservation.",
          },
          input_rules:
            "Pricing tables, rates and usage records must be plain objects, and a model id must be a string that " +
            "is in your pricing table. Anything else (a Map, a class instance, a non-string or unknown model) throws " +
            "instead of being priced at zero. The strict withCapacityReservation path also requires a plain request " +
            "object with a non-blank key and operationId, and the adapter must return a non-blank reservation id; it " +
            "throws otherwise. withReserveConfirm does not check its key: your UsageLedger decides what a valid key is.",
          threePieces: [
            "1. pricing.ts / estimateCostUsd -- cache-aware cost math (cache_read, cache_creation_5m, cache_creation_1h priced as separate line items, never collapsed). Cache reads are priced at a fixed 0.1x by default, which over-estimates models with a lower real cache-read rate, unless you set ModelRates.cacheReadPerMillion to that model's real per-million cache-read price -- it replaces the 0.1x ratio entirely for that call.",
            "2. preCallCeiling.ts / checkPreCallCeiling -- checks an ESTIMATED next-call cost against caller-supplied spend-so-far and rates before the call (rates always passed in live, never a hardcoded default). It is only as good as the estimate and cannot coordinate concurrent requests.",
            "3. reserveConfirm.ts / withReserveConfirm -- an ADVISORY check (read-only) before the call, commit only after it resolves successfully, so a call that throws is never committed. Concurrent callers can all pass the read-only check before any of them commits, so this cannot enforce a strict concurrent limit. If the commit itself fails after a successful call, the result is NOT discarded -- it returns { allowed: true, result, commitError }, where commitError's presence signals the usage count may be under-recorded for that call. For a real reservation, use withCapacityReservation with your own CapacityReservationLedger adapter.",
          ],
          concurrency_and_recovery:
            "Strict concurrent capacity needs an atomic reservation acquired BEFORE the paid call " +
              "(withCapacityReservation + your own CapacityReservationLedger adapter -- this kit ships no such " +
              "adapter). A thrown, rejected, or ambiguous work outcome keeps the hold for reconciliation rather " +
              "than guessing whether the provider was billed; don't release or retry paid work blindly. The " +
              "worked example below demonstrates only the legacy advisory withReserveConfirm API.",
          starterSnippet: STARTER_SNIPPET,
        };

        if (!includeWorkedExample) {
          return jsonResult("Guidance for wiring cost-governor-kit into your own AI-call path.", guidance);
        }

        // Live worked example against the REAL kit functions.
        const rates = { inputPerMillion: 3, outputPerMillion: 15 };
        const allowedCheck = checkPreCallCeiling({
          spentSoFarUsd: 2.5,
          ceilingUsd: 5,
          estimatedNextCallUsage: { inputTokens: 2000, outputTokens: 500 },
          rates,
        });
        const blockedCheck = checkPreCallCeiling({
          spentSoFarUsd: 4.99,
          ceilingUsd: 5,
          estimatedNextCallUsage: { inputTokens: 2000, outputTokens: 500 },
          rates,
        });
        const sampleUsage = {
          inputTokens: 10_000,
          outputTokens: 2_000,
          cacheReadTokens: 5_000,
          cacheCreation1hTokens: 1_000,
        };
        const sampleCostUsd = estimateCostUsd(rates, sampleUsage);
        // Illustrative override: a model whose real cache-read rate is 0.025x of
        // inputPerMillion (per the kit's own pricing.ts docs), not the 0.1x default.
        const sampleCostUsdWithCacheReadOverride = estimateCostUsd({ ...rates, cacheReadPerMillion: 0.075 }, sampleUsage);

        const demoLedger = makeInMemoryLedger();
        const underLimitRun = await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, () => Promise.resolve("call ok"));
        await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, () => Promise.resolve("call ok")); // consumes the 2nd slot
        const overLimitRun = await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, () => Promise.resolve("should not run"));

        const failingCommitLedger = makeFailingCommitLedger();
        const commitErrorRun = await withReserveConfirm(failingCommitLedger, "demo-user:2026-01-01", 2, () => Promise.resolve("call ok"));

        const worked = {
          preCallCeiling: {
            ratesLogged: formatRatesForLog(rates),
            allowedExample: allowedCheck,
            blockedExample: blockedCheck,
          },
          pricing: {
            sampleUsage: "10k in / 2k out / 5k cache-read / 1k cache-create-1h",
            sampleCostUsd,
            sampleCostUsdWithCacheReadOverride,
            note: "Same usage, cacheReadPerMillion 0.075 instead of the default 0.1x-of-input (0.3): lower total.",
          },
          reserveConfirm: {
            limit: 2,
            firstCallResult: underLimitRun,
            secondCallConsumedTheLimit: true,
            thirdCallResult: overLimitRun,
            commitFailsAfterSuccessfulCallResult: commitErrorRun,
          },
        };

        return jsonResult(
          "Guidance for wiring cost-governor-kit into your own AI-call path, plus a live worked example run against the real checkPreCallCeiling/estimateCostUsd/withReserveConfirm.",
          { ...guidance, workedExample: worked },
        );
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}

/** A ledger whose commitUsage always rejects, to demonstrate withReserveConfirm's commitError result. */
function makeFailingCommitLedger(): UsageLedger {
  return {
    checkUnderLimit() {
      return Promise.resolve(true);
    },
    commitUsage() {
      return Promise.reject(new Error("demo: commitUsage always fails in this ledger"));
    },
  };
}

function makeInMemoryLedger(): UsageLedger {
  const counts = new Map<string, number>();
  return {
    checkUnderLimit(key, limit) {
      return Promise.resolve((counts.get(key) ?? 0) < limit);
    },
    commitUsage(key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return Promise.resolve();
    },
  };
}
