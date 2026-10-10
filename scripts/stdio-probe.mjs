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
// Two sessions run, because code execution is off unless
// HONESTY_MCP_ENABLE_CODE_EXEC is exactly "1":
//
//   Session 1 (variable unset, the default):
//     a. tools/list shows 13 tools: check_mutation_invariance is absent,
//        check_payout_invariance lists static-imports mode only, and
//        compute_divergence has no groupBySource input.
//     b. A tool that does not run caller code still answers.
//     c. A path list for static-imports is refused and returns no file text.
//   Session 2 (variable set to "1"):
//     d. All three tools that run caller-supplied code succeed from that
//        unrelated folder (check_payout_invariance runtime mode,
//        check_mutation_invariance, compute_divergence with groupBySource).
//     e. The server still answers a normal call afterwards.
//   Both sessions:
//     f. Every line the server writes to stdout parses as JSON-RPC, even when
//        the caller's code calls console.log, console.error or
//        process.stdout.write.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = resolve(process.argv[2] ?? join(root, 'dist', 'index.js'));
const cwd = mkdtempSync(join(tmpdir(), 'honesty-mcp-stdio-'));
const SWITCH = 'HONESTY_MCP_ENABLE_CODE_EXEC';
const CANARY = 'PROBE_CANARY_5d1e7b';
const canaryPath = join(cwd, 'canary.txt');
writeFileSync(canaryPath, `${CANARY} must never be returned\n`);

const noisy =
  'console.log("PROBE_STDOUT_LOG"); console.error("PROBE_STDERR_LOG"); process.stdout.write("PROBE_RAW_WRITE\\n");';

/** Starts the server with the code-execution switch set to `switchValue` (undefined = unset). */
function startSession(switchValue) {
  const env = { ...process.env };
  delete env[SWITCH];
  if (switchValue !== undefined) env[SWITCH] = switchValue;
  const server = spawn(process.execPath, [bin], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const failTimer = setTimeout(() => {
    console.error('stdio-probe: no answer within 60s');
    server.kill('SIGKILL');
    process.exit(1);
  }, 60_000);

  const session = { stderr: '', nonJsonLines: [], stdoutText: '' };
  server.stderr.on('data', (d) => { session.stderr += d; });

  let buffer = '';
  const pending = new Map();
  server.stdout.on('data', (chunk) => {
    session.stdoutText += chunk;
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
        session.nonJsonLines.push(line.slice(0, 120));
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
  session.request = (method, params) => {
    const id = ++nextId;
    return new Promise((resolveCall) => {
      pending.set(id, resolveCall);
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };
  session.requestCount = () => nextId;
  session.callToolRaw = (name, args) => session.request('tools/call', { name, arguments: args });
  session.callTool = async (name, args) => {
    const response = await session.callToolRaw(name, args);
    const text = response.result?.content?.[0]?.text ?? JSON.stringify(response.error);
    assert.notEqual(response.result?.isError, true, `${name} returned an error from ${cwd}: ${text}`);
    return text;
  };
  session.initialize = async () => {
    const response = await session.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-probe', version: '1' },
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return response;
  };
  session.listTools = async () => (await session.request('tools/list', {})).result.tools;
  session.close = () => {
    clearTimeout(failTimer);
    server.kill();
  };
  return session;
}

let active;
try {
  // Session 1: the switch is unset (the default). Code execution is off.
  active = startSession(undefined);
  const init = await active.initialize();
  assert.match(
    init.result?.instructions ?? '',
    new RegExp(`${SWITCH}=1`),
    'initialize result should tell the client how to enable code execution',
  );
  const offTools = await active.listTools();
  const offNames = offTools.map((tool) => tool.name);
  assert.equal(offNames.length, 13, `expected 13 tools by default, got ${offNames.length}`);
  assert.ok(!offNames.includes('check_mutation_invariance'), 'check_mutation_invariance must not be listed by default');
  const offPayout = offTools.find((tool) => tool.name === 'check_payout_invariance');
  assert.deepEqual(offPayout?.inputSchema?.properties?.mode?.enum, ['static-imports']);
  assert.ok(!('rankFnSource' in offPayout.inputSchema.properties), 'runtime inputs must not be listed by default');
  const offDivergence = offTools.find((tool) => tool.name === 'compute_divergence');
  assert.ok(!('groupBySource' in (offDivergence?.inputSchema?.properties?.config?.properties ?? {})));

  await active.callTool('check_grounding', { text: 'The sky is blue [e1].', evidence: { e1: 'The sky is blue.' } });

  const pathList = await active.callToolRaw('check_payout_invariance', {
    mode: 'static-imports',
    files: [canaryPath],
    payoutIdentifiers: [CANARY],
  });
  assert.equal(pathList.result?.isError, true, 'a path list must be refused');
  assert.ok(!JSON.stringify(pathList).includes('must never be returned'), 'file text must not be returned');

  assert.deepEqual(active.nonJsonLines, [], `non-JSON lines reached stdout: ${JSON.stringify(active.nonJsonLines)}`);
  const offRequests = active.requestCount();
  active.close();

  // Session 2: the switch is "1". All three code-running paths work from an unrelated folder.
  active = startSession('1');
  const onInit = await active.initialize();
  assert.equal(onInit.result?.instructions, undefined, 'no code-execution-off instructions when enabled');
  const onNames = (await active.listTools()).map((tool) => tool.name);
  assert.equal(onNames.length, 14, `expected 14 tools when enabled, got ${onNames.length}`);

  await active.callTool('check_payout_invariance', {
    mode: 'runtime',
    rankFnSource: `(input) => { ${noisy} return input.items.map((item) => item.id); }`,
    baseInput: { items: [{ id: 'a', payout: 1 }, { id: 'b', payout: 2 }] },
    mutations: [
      { name: 'double payouts', mutateSource: '(i) => ({ items: i.items.map((x) => ({ ...x, payout: x.payout * 2 })) })' },
    ],
  });

  await active.callTool('check_mutation_invariance', {
    fnSource: `(input) => { ${noisy} return input.score; }`,
    baseInput: { score: 1, zip: '68101' },
    scenarios: [{ name: 'change zip', mutateSource: '(i) => ({ ...i, zip: "10001" })' }],
  });

  await active.callTool('compute_divergence', {
    pairs: [
      { engineJudgment: 'a', humanJudgment: 'a', group: 'x' },
      { engineJudgment: 'a', humanJudgment: 'b', group: 'y' },
    ],
    config: { groupBySource: `(pair) => { ${noisy} return pair.group; }` },
  });

  await active.callTool('check_grounding', { text: 'The sky is blue [e1].', evidence: { e1: 'The sky is blue.' } });

  assert.deepEqual(active.nonJsonLines, [], `non-JSON lines reached stdout: ${JSON.stringify(active.nonJsonLines)}`);
  assert.ok(!active.stdoutText.includes('PROBE_STDOUT_LOG'), 'caller console.log must not reach stdout');
  const onRequests = active.requestCount();
  active.close();
  active = undefined;
  console.log(
    JSON.stringify({ status: 'passed', bin, cwd, stdoutLinesChecked: offRequests + onRequests, sessions: ['switch unset', 'switch 1'] }),
  );
} catch (error) {
  console.error(`stdio-probe failed: ${error instanceof Error ? error.message : String(error)}`);
  if (active?.stderr) console.error(`server stderr (last 800 chars):\n${active.stderr.slice(-800)}`);
  process.exitCode = 1;
} finally {
  active?.close();
  rmSync(canaryPath, { force: true });
}
