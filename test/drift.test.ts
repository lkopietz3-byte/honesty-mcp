// Release-drift guards. Each test fails when two places that must agree have
// drifted apart: the version in four places, the tool list in the README
// versus what the server really registers, and the CHANGELOG entry for the
// current version. They read the files at the repository root, so they check
// what would actually be published.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
  packages: { identifier: string; version: string }[];
}

const pkg = JSON.parse(readRepoFile("package.json")) as PackageJson;
const serverJson = JSON.parse(readRepoFile("server.json")) as ServerJson;
const readme = readRepoFile("README.md");

async function registeredToolNames(): Promise<string[]> {
  const server = createServer();
  const client = new Client({ name: "drift-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

/** Tool names in the README's two tool tables: rows that start with a backticked name and a `Wraps` cell. */
function readmeToolNames(): string[] {
  const names: string[] = [];
  for (const line of readme.split("\n")) {
    const match = /^\| `([a-z][a-z0-9_]*)` \| /.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names.sort();
}

describe("version drift", () => {
  it("package.json, SERVER_VERSION and both server.json versions are the same", () => {
    expect({
      serverVersion: SERVER_VERSION,
      serverJson: serverJson.version,
      serverJsonPackage: serverJson.packages[0]?.version,
    }).toEqual({
      serverVersion: pkg.version,
      serverJson: pkg.version,
      serverJsonPackage: pkg.version,
    });
  });

  it("server.json names the same registry entry and npm package as package.json", () => {
    expect(serverJson.name).toBe(pkg.mcpName);
    expect(serverJson.packages[0]?.identifier).toBe(pkg.name);
  });

  it("CHANGELOG.md has a dated entry for the current version", () => {
    const changelog = readRepoFile("CHANGELOG.md");
    const escaped = pkg.version.replace(/\./g, "\\.");
    expect(changelog).toMatch(new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"));
  });
});

describe("README claims match the server", () => {
  it("the README tool tables list exactly the tools the server registers", async () => {
    expect(readmeToolNames()).toEqual(await registeredToolNames());
  });

  it("the README's stated tool total matches the number of registered tools", async () => {
    const registered = await registeredToolNames();
    const totals = [...readme.matchAll(/\*\*(\d+) tools total\*\*/g)].map((m) => Number(m[1]));
    expect(totals).toEqual([registered.length]);
  });

  it("the README's split between content-checking and scaffolding tools matches the server", async () => {
    const registered = await registeredToolNames();
    const scaffolding = registered.filter((name) => name.startsWith("scaffold_"));
    const match = /\*\*(\d+) content-checking kits, (\d+) tools\*\*/.exec(readme);
    expect(match, "README should state the content-checking split").not.toBeNull();
    expect(Number(match?.[2])).toBe(registered.length - scaffolding.length);
    expect(readme).toMatch(new RegExp(`\\*\\*${scaffolding.length} scaffolding tools\\*\\*`));
  });

  it("every wrapped kit dependency is named in the README", () => {
    const kits = Object.keys(pkg.dependencies).filter(
      (name) => name !== "@modelcontextprotocol/sdk" && name !== "zod",
    );
    expect(kits).toHaveLength(11);
    for (const kit of kits) expect(readme, `README should mention ${kit}`).toContain(kit);
  });
});
