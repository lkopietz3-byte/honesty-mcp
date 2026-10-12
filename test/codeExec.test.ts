// The code-execution switch (src/lib/codeExec.ts): which tools exist, what the
// choke point does, and that nothing else changes. Each test sets or clears
// HONESTY_MCP_ENABLE_CODE_EXEC itself and restores the suite default after.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CODE_EXEC_ENABLED_BY_DEFAULT,
  CODE_EXEC_ENV_VAR,
  CODE_EXEC_DISABLED_MESSAGE,
  CodeExecDisabledError,
  isCodeExecEnabled,
} from "../src/lib/codeExec.js";
import { runFunctionJob } from "../src/lib/runFunctionJob.js";
import { createServer, CODE_EXEC_OFF_INSTRUCTIONS } from "../src/server.js";

const suiteDefault = process.env[CODE_EXEC_ENV_VAR];

function setSwitch(value: string | undefined): void {
  if (value === undefined) delete process.env[CODE_EXEC_ENV_VAR];
  else process.env[CODE_EXEC_ENV_VAR] = value;
}

afterEach(() => {
  setSwitch(suiteDefault);
});

async function connect(): Promise<{ server: McpServer; client: Client; close: () => Promise<void> }> {
  const server = createServer();
  const client = new Client({ name: "code-exec-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    server,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const MUTATION_ARGS = {
  fnSource: "(input) => input.score",
  baseInput: { score: 1, zip: "68101" },
  scenarios: [{ name: "change zip", mutateSource: '(i) => ({ ...i, zip: "10001" })' }],
};

const ALL_TOOLS = [
  "append_audit_entry",
  "assess_anonymous_authenticity",
  "check_claims_registry",
  "check_grounding",
  "check_mutation_invariance",
  "check_payout_invariance",
  "check_provenance_claims",
  "compute_divergence",
  "corroborate_evidence",
  "grade_decision",
  "scaffold_agent_receipts",
  "scaffold_cost_governor",
  "score_trust_identified",
  "verify_audit_chain",
];

describe("isCodeExecEnabled", () => {
  it("is off by default: the named default constant is false", () => {
    expect(CODE_EXEC_ENABLED_BY_DEFAULT).toBe(false);
    expect(isCodeExecEnabled({})).toBe(false);
  });

  it("is on only for exactly '1'", () => {
    expect(isCodeExecEnabled({ [CODE_EXEC_ENV_VAR]: "1" })).toBe(true);
    for (const value of ["true", "yes", "TRUE", "on", "0", "", " 1", "1 ", "2", "enabled"]) {
      expect(isCodeExecEnabled({ [CODE_EXEC_ENV_VAR]: value }), `value ${JSON.stringify(value)}`).toBe(false);
    }
  });
});

describe("variable unset", () => {
  beforeEach(() => {
    setSwitch(undefined);
  });

  it("does not register check_mutation_invariance, and registers the other 13 tools", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).not.toContain("check_mutation_invariance");
      expect(names).toEqual(ALL_TOOLS.filter((n) => n !== "check_mutation_invariance"));
    } finally {
      await close();
    }
  });

  it("calling the missing tool fails and never runs the supplied code", async () => {
    const { client, close } = await connect();
    try {
      const outcome = await client
        .callTool({
          name: "check_mutation_invariance",
          arguments: { ...MUTATION_ARGS, fnSource: '(i) => { globalThis.__codeExecRan = true; return i.score; }' },
        })
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
      const failed = "error" in outcome || (outcome.result as { isError?: boolean }).isError === true;
      expect(failed).toBe(true);
      expect((globalThis as Record<string, unknown>)["__codeExecRan"]).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("lists check_payout_invariance with static-imports mode only and no runtime inputs", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "check_payout_invariance");
      const properties = tool?.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties["mode"]?.enum).toEqual(["static-imports"]);
      for (const key of ["rankFnSource", "baseInput", "mutations"]) expect(properties).not.toHaveProperty(key);
      expect(tool?.description).toContain(CODE_EXEC_ENV_VAR);

      const refused = await client.callTool({
        name: "check_payout_invariance",
        arguments: {
          mode: "runtime",
          rankFnSource: "(x) => x",
          baseInput: [],
          mutations: [{ name: "n", mutateSource: "(x) => x" }],
        },
      }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      const failed = "error" in refused || (refused.result as { isError?: boolean }).isError === true;
      expect(failed).toBe(true);
    } finally {
      await close();
    }
  });

  it("lists compute_divergence without groupBySource and refuses it if sent", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "compute_divergence");
      const config = (tool?.inputSchema.properties as Record<string, { properties?: Record<string, unknown> }>)["config"];
      expect(config?.properties).toBeDefined();
      expect(config?.properties).not.toHaveProperty("groupBySource");

      const outcome = await client
        .callTool({
          name: "compute_divergence",
          arguments: {
            pairs: [{ engineJudgment: "a", humanJudgment: "b", group: "x" }],
            config: { groupBySource: '(p) => { globalThis.__codeExecRan = true; return p.group; }' },
          },
        })
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
      const failed = "error" in outcome || (outcome.result as { isError?: boolean }).isError === true;
      expect(failed).toBe(true);
      expect((globalThis as Record<string, unknown>)["__codeExecRan"]).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("the server instructions name the variable and say it is not a sandbox", async () => {
    const { client, close } = await connect();
    try {
      const instructions = client.getInstructions();
      expect(instructions).toBe(CODE_EXEC_OFF_INSTRUCTIONS);
      expect(instructions).toContain(`${CODE_EXEC_ENV_VAR}=1`);
      expect(instructions).toContain("not a sandbox");
    } finally {
      await close();
    }
  });

  it("the other tools and the non-executing modes still work", async () => {
    const { client, close } = await connect();
    try {
      const grounding = (await client.callTool({
        name: "check_grounding",
        arguments: { text: "The sky is blue [e1].", evidence: { e1: "The sky is blue." } },
      })) as { isError?: boolean };
      expect(grounding.isError).not.toBe(true);

      const staticImports = (await client.callTool({
        name: "check_payout_invariance",
        arguments: {
          mode: "static-imports",
          files: { "rank.ts": "const x = affiliateCommission;" },
          payoutIdentifiers: ["affiliateCommission"],
        },
      })) as { isError?: boolean; content?: { text?: string }[] };
      expect(staticImports.isError).not.toBe(true);
      expect(staticImports.content?.[0]?.text).toContain("FOUND");

      const divergence = (await client.callTool({
        name: "compute_divergence",
        arguments: {
          pairs: [
            { engineJudgment: "a", humanJudgment: "b", group: "x" },
            { engineJudgment: "a", humanJudgment: "a", group: "x" },
          ],
        },
      })) as { isError?: boolean };
      expect(divergence.isError).not.toBe(true);
    } finally {
      await close();
    }
  });

  it("runFunctionJob, the single choke point, rejects before starting a worker and names the variable", async () => {
    await expect(
      runFunctionJob({
        kind: "mutation-invariance",
        fnSource: "(i) => i",
        baseInput: 1,
        scenarios: [{ name: "n", mutateSource: "(i) => i + 1" }],
      }),
    ).rejects.toThrow(CodeExecDisabledError);
    await expect(
      runFunctionJob({ kind: "divergence-group-by", pairs: [], floors: {}, groupBySource: "(p) => p.group" }),
    ).rejects.toThrow(CODE_EXEC_ENV_VAR);
    expect(CODE_EXEC_DISABLED_MESSAGE).toContain(`${CODE_EXEC_ENV_VAR}=1`);
    expect(CODE_EXEC_DISABLED_MESSAGE).toContain("not a sandbox");
  });
});

describe.each(["true", "yes", "0", "", "garbage"])("variable set to %j", (value) => {
  beforeEach(() => {
    setSwitch(value);
  });

  it("is treated as off: check_mutation_invariance is not registered", async () => {
    const { client, close } = await connect();
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain("check_mutation_invariance");
      expect(names).toHaveLength(13);
    } finally {
      await close();
    }
  });

  it("the choke point stays closed", async () => {
    await expect(
      runFunctionJob({ kind: "divergence-group-by", pairs: [], floors: {}, groupBySource: "(p) => p.group" }),
    ).rejects.toThrow(CodeExecDisabledError);
  });
});

describe('variable set to "1"', () => {
  beforeEach(() => {
    setSwitch("1");
  });

  it("registers all 14 tools, including check_mutation_invariance, and the instructions are absent", async () => {
    const { client, close } = await connect();
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(ALL_TOOLS);
      expect(client.getInstructions()).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("runs caller code in all three paths", async () => {
    const { client, close } = await connect();
    try {
      const mutation = (await client.callTool({ name: "check_mutation_invariance", arguments: MUTATION_ARGS })) as {
        isError?: boolean;
        content?: { text?: string }[];
      };
      expect(mutation.isError).not.toBe(true);
      expect(mutation.content?.[0]?.text).toContain("PASSED");

      const payout = (await client.callTool({
        name: "check_payout_invariance",
        arguments: {
          mode: "runtime",
          rankFnSource: "(items) => items.map((i) => i.id)",
          baseInput: [{ id: "a", payout: 1 }, { id: "b", payout: 2 }],
          mutations: [
            { name: "double", mutateSource: "(items) => items.map((i) => ({ ...i, payout: i.payout * 2 }))" },
          ],
        },
      })) as { isError?: boolean; content?: { text?: string }[] };
      expect(payout.isError).not.toBe(true);
      expect(payout.content?.[0]?.text).toContain("PASSED");

      const divergence = (await client.callTool({
        name: "compute_divergence",
        arguments: {
          pairs: [
            { engineJudgment: "a", humanJudgment: "b", group: "x" },
            { engineJudgment: "a", humanJudgment: "a", group: "y" },
          ],
          config: { groupBySource: "(p) => p.group" },
        },
      })) as { isError?: boolean };
      expect(divergence.isError).not.toBe(true);
    } finally {
      await close();
    }
  });
});

describe("tool annotations", () => {
  it("marks the pure tools read-only and closed-world, and the code-running tools neither", async () => {
    setSwitch("1");
    const enabled = await connect();
    try {
      const byName = new Map((await enabled.client.listTools()).tools.map((t) => [t.name, t.annotations]));
      for (const name of ["check_grounding", "grade_decision", "verify_audit_chain", "scaffold_cost_governor"]) {
        expect(byName.get(name), name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
      for (const name of ["check_mutation_invariance", "check_payout_invariance", "compute_divergence"]) {
        expect(byName.get(name), name).toMatchObject({ readOnlyHint: false, openWorldHint: true });
      }
    } finally {
      await enabled.close();
    }

    setSwitch(undefined);
    const disabled = await connect();
    try {
      const byName = new Map((await disabled.client.listTools()).tools.map((t) => [t.name, t.annotations]));
      for (const name of ["check_payout_invariance", "compute_divergence"]) {
        expect(byName.get(name), name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
    } finally {
      await disabled.close();
    }
  });
});
