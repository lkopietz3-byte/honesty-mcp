// Small, shared helpers for turning a kit's plain-data result into an MCP
// CallToolResult. Kept deliberately tiny: every tool handler in this server
// returns either a JSON-pretty-printed result (jsonResult) behind a
// human-readable one-line summary, or an error (errorResult) when the
// handler itself couldn't complete (bad input, a thrown error from the
// wrapped kit, invalid JS source in a code-execution tool, ...).
//
// `isError` is reserved for the second case (the tool call itself failed).
// A content-checking tool that ran successfully and concluded "this fails
// the check" is NOT an error from MCP's point of view -- it's a normal,
// successful result whose payload happens to be a failing verdict. Callers
// (an agent deciding whether to block a PR, say) read the verdict out of the
// structured JSON, not out of isError.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * A successful tool result: a human-readable summary as one content block,
 * followed by the full JSON payload as a second content block. Kept as two
 * separate blocks (rather than one concatenated string) so callers can
 * reliably locate the machine-readable payload even when `summary` itself
 * is multi-paragraph text (e.g. claims-registry-kit's formatted report).
 */
export function jsonResult(summary: string, data: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(data, jsonReplacer, 2) },
    ],
  };
}

/** A tool result carrying only human-readable text (no structured payload). */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** An error result: the tool call itself could not be completed. */
export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/** Extracts a readable message from anything a handler might throw. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// JSON.stringify chokes on Map/Set (rare, but corroboration-kit-style
// libraries sometimes carry them) and silently renders an Error as "{}"
// (its message/stack are non-enumerable) -- e.g. cost-governor-kit's
// ReserveConfirmResult.commitError is typed `unknown` and can be a real
// Error. Make the output robust instead of silently dropping data or
// throwing mid-response.
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}
