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

// --- 1. Estimated spend check before the call. Accuracy depends on estimates/rates. ---
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

// --- 2. Advisory check-then-commit: this does not reserve concurrent capacity. ---
class MyLedger implements UsageLedger {
  async checkUnderLimit(key: string, limit: number) {
    // READ-ONLY. e.g.: SELECT count FROM usage WHERE key = $1
    return (await db.getCount(key)) < limit;
  }
  async commitUsage(key: string) {
    // Called ONLY after the guarded call returns successfully. Make the count
    // increment atomic; that alone cannot prevent concurrent upstream calls.
    await db.increment(key);
  }
}

const result = await withReserveConfirm(
  new MyLedger(),
  \`\${userId}:\${today}\`,
  FREE_DAILY_LIMIT,
  () => callAnthropic(userId, prompt), // a thrown result does not commit local usage
);
// A timeout may still have incurred provider cost. Reconcile before retrying.
// Strict concurrent limits require an atomic reservation before upstream work.
if (!result.allowed) return send429("Daily limit reached");
return send200(result.result);
`;

export function registerCostGovernorScaffoldTool(server: McpServer): void {
  server.registerTool(
    "scaffold_cost_governor",
    {
      title: "Scaffold the cost-governor-kit spend-safety pattern",
      description:
        "cost-governor-kit is a RUNTIME LIBRARY your app installs and calls at the moment it's about to make " +
        "an AI API call -- it is not something this MCP server can 'check' on demand the way it checks a " +
        "document's citations. Its advisory check-then-commit helper (withReserveConfirm) needs a live UsageLedger " +
        "backed by YOUR database and an async callback making the real call, neither of which exist as " +
        "content to hand this tool. Call this to get all three pieces explained (estimated pre-call spend check, " +
        "cache-aware pricing math, advisory successful-result counting), an install step, a copy-" +
        "pasteable starter snippet, and (optionally) a live worked example: real checkPreCallCeiling calls " +
        "(one allowed, one blocked) plus a real withReserveConfirm run against an in-memory demo ledger (one " +
        "call under the limit, one over). Use this when you're building or reviewing anything that calls a " +
        "paid AI API. This example does not enforce strict concurrent limits or make provider retries safe.",
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
              "reference-impl/supabase-usage-ledger.sql demonstrates the legacy UsageLedger for Postgres/Supabase; it does not reserve capacity before concurrent upstream calls.",
          },
          threePieces: [
            "1. pricing.ts / estimateCostUsd -- cache-aware cost math (cache_read, cache_creation_5m, cache_creation_1h priced as separate line items, never collapsed).",
            "2. preCallCeiling.ts / checkPreCallCeiling -- checks estimated next-call cost against caller-supplied spend and rates before the call; it cannot guarantee actual spend or coordinate concurrent requests.",
            "3. reserveConfirm.ts / withReserveConfirm -- advisory read-only check followed by a commit when the callback resolves successfully. A rejected callback skips the local commit but may still have incurred provider cost.",
          ],
          concurrency_and_recovery:
            "Strict concurrent capacity needs an atomic reservation before paid work. Repeated operations must not start work again under the same hold. Keep ambiguous provider/confirmation outcomes for reconciliation; do not release capacity or retry paid work blindly. The live example below demonstrates only the legacy advisory API.",
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
        const underLimitRun = await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, async () => "call ok");
        await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, async () => "call ok"); // consumes the 2nd slot
        const overLimitRun = await withReserveConfirm(demoLedger, "demo-user:2026-01-01", 2, async () => "should not run");

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
    async checkUnderLimit(key, limit) {
      return (counts.get(key) ?? 0) < limit;
    },
    async commitUsage(key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  };
}
