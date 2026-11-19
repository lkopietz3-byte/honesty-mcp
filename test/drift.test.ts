// Release-drift guards. Each test fails when two places that must agree have
// drifted apart: the package, lockfile and registry versions, the tool list in the README
// versus what the server really registers, and the CHANGELOG entry for the
// current version. They read the files at the repository root, so they check
// what would actually be published.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CODE_EXEC_ENV_VAR } from "../src/lib/codeExec.js";
import { WORKER_TIMEOUT_ENV_VAR } from "../src/lib/runFunctionJob.js";
import { createServer, SERVER_VERSION } from "../src/server.js";

function readRepoFile(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
}

interface PackageJson {
  version: string;
  mcpName: string;
  name: string;
  dependencies: Record<string, string>;
}
interface ServerJson {
  name: string;
  version: string;
  packages: { identifier: string; version: string; environmentVariables?: { name: string }[] }[];
}
interface PackageLock {
  version: string;
  packages: Record<string, Pick<PackageJson, "version" | "dependencies">>;
}

const pkg = JSON.parse(readRepoFile("package.json")) as PackageJson;
const lock = JSON.parse(readRepoFile("package-lock.json")) as PackageLock;
const serverJson = JSON.parse(readRepoFile("server.json")) as ServerJson;
const readme = readRepoFile("README.md");

async function registeredToolNames(codeExec = true): Promise<string[]> {
  vi.stubEnv(CODE_EXEC_ENV_VAR, codeExec ? "1" : undefined);
  const server = createServer();
  const client = new Client({ name: "drift-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    vi.unstubAllEnvs();
    await client.close();
    await server.close();
  }
}

/** Tool and kit names from the README's tool tables. */
function readmeTools(): [string, string][] {
  return [...readme.matchAll(/^\| `([a-z][a-z0-9_]*)` \| ([a-z][a-z0-9-]*) (?:\(`\w+`\) )?\| /gm)]
    .map(([, name, kit]) => [name!, kit!]);
}

describe("version drift", () => {
  it("the package, lockfile, server and registry versions are the same", () => {
    expect([
      SERVER_VERSION, lock.version, lock.packages[""]?.version, serverJson.version, serverJson.packages[0]?.version,
    ]).toEqual(Array<string>(5).fill(pkg.version));
    expect(lock.packages[""]?.dependencies).toEqual(pkg.dependencies);
  });

  it("server.json names the same registry entry and npm package as package.json", () => {
    expect(serverJson.name).toBe(pkg.mcpName);
    expect(serverJson.packages[0]?.identifier).toBe(pkg.name);
  });

  it("server.json lists every environment variable the code reads, and the README names them", () => {
    const listed = (serverJson.packages[0]?.environmentVariables ?? []).map((v) => v.name).sort();
    expect(listed).toEqual([CODE_EXEC_ENV_VAR, WORKER_TIMEOUT_ENV_VAR].sort());
    for (const name of listed) expect(readme, `README should mention ${name}`).toContain(name);
  });

  it("CHANGELOG.md has an unreleased or dated entry for the current version", () => {
    const changelog = readRepoFile("CHANGELOG.md");
    const escaped = pkg.version.replace(/\./g, "\\.");
    const currentEntry = new RegExp(
      `^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$|^## \\[Unreleased\\]\\r?\\n\\r?\\nChanges for ${escaped}\\.$`,
      "m",
    );
    expect(changelog).toMatch(currentEntry);
  });
});

describe("README claims match the server", () => {
  it("the README tool tables list exactly the tools the server registers", async () => {
    expect(readmeTools().map(([name]) => name).sort()).toEqual(await registeredToolNames());
  });

  it("the README's stated tool total matches the number of registered tools", async () => {
    const registered = await registeredToolNames();
    const totals = [...readme.matchAll(/\*\*(\d+) tools total\*\*/g)].map((m) => Number(m[1]));
    expect(totals).toEqual([registered.length]);
  });

  it("the README's tool and kit totals match both code-execution settings", async () => {
    const kitByTool = new Map(readmeTools());
    const totals = [];
    for (const codeExec of [false, true]) {
      const names = await registeredToolNames(codeExec);
      totals.push([names.length, new Set(names.map((name) => kitByTool.get(name))).size]);
    }
    const documented = [...readme.matchAll(/\*\*(\d+) tools across (\d+) kits\*\*/g)]
      .map(([, tools, kits]) => [Number(tools), Number(kits)]);
    expect(documented).toEqual(totals);
  });

  it("the README's split between content-checking and scaffolding tools matches the server", async () => {
    const registered = await registeredToolNames();
    const scaffolding = registered.filter((name) => name.startsWith("scaffold_"));
    const match = /\*\*(\d+) content-checking kits, (\d+) tools\*\*/.exec(readme);
    expect(match, "README should state the content-checking split").not.toBeNull();
    const contentKits = new Set(readmeTools().filter(([name]) => !name.startsWith("scaffold_")).map(([, kit]) => kit));
    expect(Number(match?.[1])).toBe(contentKits.size);
    expect(Number(match?.[2])).toBe(registered.length - scaffolding.length);
    expect(readme).toMatch(new RegExp(`\\*\\*${scaffolding.length} scaffolding tools\\*\\*`));
  });

  it("every wrapped kit dependency is named in the README", () => {
    const kits = Object.keys(pkg.dependencies).filter(
      (name) => name !== "@modelcontextprotocol/sdk" && name !== "zod",
    );
    expect(new Set(readmeTools().map(([, kit]) => kit))).toEqual(new Set(kits));
  });
});
