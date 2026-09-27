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
return send200(result.result);

// Need the limit to actually hold under concurrent requests? withReserveConfirm
// can't do that (concurrent callers can all pass the read-only check before any
// commits). Use withCapacityReservation + your own CapacityReservationLedger
// adapter instead -- see the kit's README, "Strict capacity reservation".
`;

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
        "calls (one allowed, one blocked) plus a real withReserveConfirm run against an in-memory demo ledger " +
        "(one call under the limit, one over). Use this when you're building or reviewing anything that calls " +
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
            note:
              "This kit is currently only available as a local sibling directory (monorepo-adjacent setup, " +
                "not yet published to npm) -- see this server's own README.md.",
            local_dev: "npm install cost-governor-kit@file:../cost-governor-kit",
            once_published: "npm install cost-governor-kit",
            reference_impl:
              "reference-impl/supabase-usage-ledger.sql implements only the advisory UsageLedger for " +
                "Postgres/Supabase. Its commit-time re-check caps the recorded count but does not prevent " +
                "concurrent over-limit paid calls -- it is not a concurrency-safe reservation.",
          },
          threePieces: [
            "1. pricing.ts / estimateCostUsd -- cache-aware cost math (cache_read, cache_creation_5m, cache_creation_1h priced as separate line items, never collapsed). Cache reads are priced at a fixed 0.1x, which over-estimates models with a lower real cache-read rate.",
            "2. preCallCeiling.ts / checkPreCallCeiling -- checks an ESTIMATED next-call cost against caller-supplied spend-so-far and rates before the call (rates always passed in live, never a hardcoded default). It is only as good as the estimate and cannot coordinate concurrent requests.",
            "3. reserveConfirm.ts / withReserveConfirm -- an ADVISORY check (read-only) before the call, commit only after it resolves successfully, so a call that throws is never committed. Concurrent callers can all pass the read-only check before any of them commits, so this cannot enforce a strict concurrent limit -- and a commit that itself fails discards the successful result even though the paid call happened. For a real reservation, use withCapacityReservation with your own CapacityReservationLedger adapter.",
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
        const sampleCostUsd = estimateCostUsd(rates, {
          inputTokens: 10_000,
          outputTokens: 2_000,
          cacheReadTokens: 5_000,
          cacheCreation1hTokens: 1_000,
        });

        const demoLedger = makeInMemoryLedger();
        const underLimitRun = await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, () => Promise.resolve("call ok"));
        await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, () => Promise.resolve("call ok")); // consumes the 2nd slot
        const overLimitRun = await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, () => Promise.resolve("should not run"));

        const worked = {
          preCallCeiling: {
            ratesLogged: formatRatesForLog(rates),
            allowedExample: allowedCheck,
            blockedExample: blockedCheck,
          },
          pricing: { sampleUsage: "10k in / 2k out / 5k cache-read / 1k cache-create-1h", sampleCostUsd },
          reserveConfirm: {
            limit: 2,
            firstCallResult: underLimitRun,
            secondCallConsumedTheLimit: true,
            thirdCallResult: overLimitRun,
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
