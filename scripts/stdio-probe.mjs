// Launches the honesty-mcp server as a real stdio subprocess, the way MCP
// clients do, and checks the things an in-memory test cannot see.
//
//   node scripts/stdio-probe.mjs                     probe dist/index.js
//   node scripts/stdio-probe.mjs <path/to/index.js>  probe another build
//
// The server is started with its working directory set to a fresh, empty
// temporary folder, because `npx honesty-mcp` and `claude mcp add` launch it
// from wherever the client happens to be, not from the install folder.
//
// Checks:
//   1. All three tools that run caller-supplied code succeed from that
//      unrelated folder (check_payout_invariance runtime mode,
//      check_mutation_invariance, compute_divergence with groupBySource).
//   2. Every line the server writes to stdout parses as JSON-RPC, even when
//      the caller's code calls console.log, console.error or
//      process.stdout.write.
//   3. The server still answers a normal call afterwards.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = resolve(process.argv[2] ?? join(root, 'dist', 'index.js'));
const cwd = mkdtempSync(join(tmpdir(), 'honesty-mcp-stdio-'));

const server = spawn(process.execPath, [bin], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
const failTimer = setTimeout(() => {
  console.error('stdio-probe: no answer within 60s');
  server.kill('SIGKILL');
  process.exit(1);
}, 60_000);

let stderr = '';
server.stderr.on('data', (d) => { stderr += d; });

let buffer = '';
const nonJsonLines = [];
const pending = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() === '') continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      nonJsonLines.push(line.slice(0, 120));
      continue;
    }
    const resolveCall = pending.get(message.id);
    if (resolveCall) {
      pending.delete(message.id);
      resolveCall(message);
    }
  }
});

let nextId = 0;
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolveCall) => {
    pending.set(id, resolveCall);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function callTool(name, args) {
  const response = await request('tools/call', { name, arguments: args });
  const text = response.result?.content?.[0]?.text ?? JSON.stringify(response.error);
  assert.notEqual(response.result?.isError, true, `${name} returned an error from ${cwd}: ${text}`);
  return text;
}

const noisy =
  'console.log("PROBE_STDOUT_LOG"); console.error("PROBE_STDERR_LOG"); process.stdout.write("PROBE_RAW_WRITE\\n");';

try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'stdio-probe', version: '1' },
  });
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  await callTool('check_payout_invariance', {
    mode: 'runtime',
    rankFnSource: `(input) => { ${noisy} return input.items.map((item) => item.id); }`,
    baseInput: { items: [{ id: 'a', payout: 1 }, { id: 'b', payout: 2 }] },
    mutations: [
      { name: 'double payouts', mutateSource: '(i) => ({ items: i.items.map((x) => ({ ...x, payout: x.payout * 2 })) })' },
    ],
  });

  await callTool('check_mutation_invariance', {
    fnSource: `(input) => { ${noisy} return input.score; }`,
    baseInput: { score: 1, zip: '68101' },
    scenarios: [{ name: 'change zip', mutateSource: '(i) => ({ ...i, zip: "10001" })' }],
  });

  await callTool('compute_divergence', {
    pairs: [
      { engineJudgment: 'a', humanJudgment: 'a', group: 'x' },
      { engineJudgment: 'a', humanJudgment: 'b', group: 'y' },
    ],
    config: { groupBySource: `(pair) => { ${noisy} return pair.group; }` },
  });

  await callTool('check_grounding', {
    text: 'The sky is blue [e1].',
    evidence: { e1: 'The sky is blue.' },
  });

  assert.deepEqual(nonJsonLines, [], `non-JSON lines reached stdout: ${JSON.stringify(nonJsonLines)}`);
  console.log(JSON.stringify({ status: 'passed', bin, cwd, stdoutLinesChecked: nextId }));
} catch (error) {
  console.error(`stdio-probe failed: ${error instanceof Error ? error.message : String(error)}`);
  if (stderr) console.error(`server stderr (last 800 chars):\n${stderr.slice(-800)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(failTimer);
  server.kill();
}
