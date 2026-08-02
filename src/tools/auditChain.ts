// append_audit_entry / verify_audit_chain — wrap audit-chain-kit's
// appendEntry and verifyChain: an append-only, hash-chained audit log with a
// dependency-free verifier a skeptical third party can run themselves.
//
// Two tools, not one, because they're genuinely different operations: one
// mutates (well -- returns a new, longer chain; nothing is mutated in
// place), one only reads and reports.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appendEntry, verifyChain, type ChainEntry } from "audit-chain-kit";
import { errorMessage, errorResult, jsonResult } from "../lib/result.js";

const chainEntrySchema = z.object({
  index: z.number().int().nonnegative().describe("Position of this entry in the chain, starting at 0."),
  payload: z.any().describe("Caller data for this entry."),
  prevHash: z.string().describe("The previous entry's entryHash, or 64 zeros for the first entry."),
  createdAt: z.string().describe("ISO-8601 timestamp set at append time."),
  entryHash: z.string().describe("SHA-256 hex digest binding this entry (and transitively every prior entry) together."),
});

export function registerAuditChainTools(server: McpServer): void {
  server.registerTool(
    "append_audit_entry",
    {
      title: "Append a tamper-evident audit-chain entry",
      description:
        "Appends one entry to an append-only, hash-chained audit log and returns the new (longer) chain. " +
        "Each entry's hash binds its payload, index, and the previous entry's hash together, so any later " +
        "tampering with an earlier entry breaks the chain in a way verify_audit_chain will detect. Use this " +
        "wherever you need a tamper-evident record of events (agent actions, approvals, state transitions) " +
        "that a skeptical third party can later verify independently. This function does not persist " +
        "anything itself -- store the returned chain (or just the new entry) in whatever your app already uses.",
      inputSchema: {
        chain: z.array(chainEntrySchema).describe("The existing chain, in order, exactly as previously returned/stored. Pass [] to start a new chain."),
        payload: z.any().describe("Caller data for the new entry -- any JSON-serializable value."),
      },
    },
    async ({ chain, payload }) => {
      try {
        const nextChain = await appendEntry(chain as ChainEntry[], payload);
        const newEntry = nextChain[nextChain.length - 1]!;
        const summary =
          `Appended entry #${newEntry.index} (hash ${newEntry.entryHash.slice(0, 16)}...). ` +
          `Chain now has ${nextChain.length} entr${nextChain.length === 1 ? "y" : "ies"}.`;
        return jsonResult(summary, { chain: nextChain, newEntry });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );

  server.registerTool(
    "verify_audit_chain",
    {
      title: "Verify a tamper-evident audit chain",
      description:
        "Independently re-verifies a hash chain from genesis: recomputes every entry's hash and confirms " +
        "each entry's prevHash matches the preceding entry's entryHash. Detects a mutated payload (stored " +
        "entryHash no longer matches recomputed hash), a severed link or spliced-out middle entry (prevHash " +
        "mismatch), and -- if you pass `expectedMinLength` -- entries deleted from the END of the chain " +
        "(a tail deletion leaves no broken pointer for the walk to find on its own). Proves the chain is " +
        "internally consistent and unaltered since it was hashed; it does NOT prove nobody with write access " +
        "ever rewrote the whole chain from genesis (tamper-evident, not tamper-proof). Use this to audit a " +
        "chain you did not produce yourself before trusting it.",
      inputSchema: {
        chain: z.array(chainEntrySchema).describe("The chain to verify, exactly as stored/received."),
        expectedMinLength: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("If you know how long the chain should be, pass it to also catch a tail truncation."),
      },
    },
    async ({ chain, expectedMinLength }) => {
      try {
        const result = await verifyChain(
          chain as ChainEntry[],
          undefined,
          expectedMinLength !== undefined ? { expectedMinLength } : undefined,
        );
        const summary = result.valid
          ? `VALID: all ${chain.length} entr${chain.length === 1 ? "y" : "ies"} verified.`
          : `INVALID: ${result.reason}`;
        return jsonResult(summary, result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
